import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseIrisResult, type IrisUploadResult } from "./textemall-iris.js";

const pExecFile = promisify(execFile);

const IRIS_MAX_TURNS = Number(process.env.IRIS_MAX_TURNS) || 500;
const IRIS_TIMEOUT_MS = Number(process.env.IRIS_TIMEOUT_MS) || 40 * 60_000;

/**
 * Goal for the INDIVIDUAL relay: set a Text-Em-All group to exactly one number,
 * using **Add Contact** (typing the number) — NOT the CSV file-import (R3). This
 * avoids the fragile macOS file picker entirely and is far fewer turns.
 */
export function buildSetGroupToNumberGoal(opts: { group: string; phone: string; groupUrl?: string }): string {
  return [
    "You are driving the Mac GUI (Safari) in Text-Em-All. The app is already open. Do EXACTLY these steps and nothing else — do NOT click Create Broadcast/Send or message anyone.",
    "1. Make sure Safari is on https://app.text-em-all.com . If you see a sign-in / login screen, STOP and make your FINAL line exactly: RESULT: needs-login",
    opts.groupUrl
      ? `2. Navigate Safari DIRECTLY to this exact URL (type it in the address bar) so you land on the right group without hunting the sidebar: ${opts.groupUrl} . This IS the group "${opts.group}". If you see a sign-in screen, STOP and print exactly: RESULT: needs-login. Do NOT open any other group.`
      : `2. Open the group named exactly "${opts.group}" (Contacts → click it). Do NOT open any other group (e.g. "Everyone" or the Zillow group).`,
    "3. If the group has any contacts, remove them one by one (click a contact → More Actions → Remove From Group → confirm) until it shows 0. There is no select-all — do not look for one.",
    `4. Click "Add Contact" and add a single contact with the phone number ${opts.phone} (type it into the phone field; a name is optional). Save/confirm.`,
    "5. Read the group's contact count and IMMEDIATELY print: RESULT: count=<N> (the exact integer shown).",
    "6. If <N> equals 1, make your FINAL line exactly: RESULT: ok . Otherwise make your FINAL line exactly: RESULT: failed",
    "Rules: print 'RESULT: count=<N>' the instant you read the count; the FINAL RESULT line is ok / failed / needs-login. Never invent a count you did not read on screen.",
  ].join("\n");
}

/**
 * Drive Text-Em-All via Iris to set `group` to exactly `phone`. MUST run inside
 * withGuiLock(). Never throws — returns a status. `expectedCount` is always 1.
 * `deps.run` injectable for tests.
 */
export async function irisSetGroupToNumber(
  opts: { group: string; phone: string; groupUrl?: string; timeoutMs?: number },
  deps: { run?: (goal: string) => Promise<string> } = {},
): Promise<IrisUploadResult> {
  const goal = buildSetGroupToNumberGoal(opts);
  try {
    const run =
      deps.run ??
      (async (g: string) => {
        const { stdout, stderr } = await pExecFile(
          process.env.IRIS_BIN || "iris",
          ["-p", g, "--permission-mode", "dangerFullAccess", "--max-turns", String(IRIS_MAX_TURNS)],
          { timeout: opts.timeoutMs ?? IRIS_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
        );
        return (stdout || "") + "\n" + (stderr || "");
      });
    return parseIrisResult(await run(goal), 1);
  } catch (err) {
    return { status: "failed", detail: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
}
