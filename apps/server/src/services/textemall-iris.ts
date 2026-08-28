import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

export type IrisUploadResult =
  | { status: "ok" }
  | { status: "needs_login" }
  | { status: "failed"; detail: string };

/** Iris turn budget. The Text-Em-All contact-list dropdown isn't in the AX tree,
 * so iris re-observes per contact and the one-by-one clear is turn-hungry; the
 * group must stay the same (Zapier is bound to it), so we give iris a large
 * budget to fully clear + import rather than change the group. Overridable via
 * IRIS_MAX_TURNS. */
const IRIS_MAX_TURNS = Number(process.env.IRIS_MAX_TURNS) || 500;
/** Match the timeout to the larger turn budget (default 40 min). */
const IRIS_TIMEOUT_MS = Number(process.env.IRIS_TIMEOUT_MS) || 40 * 60_000;

/**
 * The natural-language goal handed to Iris to drive the Text-Em-All GUI.
 *
 * Hardening (2026-08-27, rev.2 after a live run):
 *  - LEAN one-by-one clear. Text-Em-All's group view has NO select-all here, so
 *    a "prefer bulk" instruction just sent Iris hunting (even into the 771-contact
 *    Everyone group) and burned the whole budget before the import. The group only
 *    ever holds the previous run's small new-lead batch, so per-contact remove is
 *    both correct and cheap. Stay on THIS group; never open Everyone/Unfiled.
 *  - Skip the delete entirely when the group is already empty.
 *  - Emit `RESULT: count=<N>` the instant the post-import count is read, so success
 *    is detectable from a verified count even if the final marker is never reached
 *    (see parseIrisResult). Import is the priority — do not linger on the clear.
 */
export function buildIrisUploadGoal(opts: { csvPath: string; group: string; expectedCount: number }): string {
  return [
    "You are driving the Mac GUI (Safari) to load contacts into Text-Em-All. The app is already open. Do EXACTLY these steps and nothing else — do NOT click Create Broadcast, Send, or anything that messages people. The IMPORT is the priority; do not spend the whole session on the delete step.",
    "1. Make sure Safari is on https://app.text-em-all.com . If you see a sign-in / login screen (email + password, not the app), STOP and make your FINAL line exactly: RESULT: needs-login",
    `2. Open the group named exactly "${opts.group}" (Contacts → click it in the group list, or it may already be open). Do NOT open any other group such as "Everyone" or "Unfiled" — work ONLY in "${opts.group}".`,
    "3. Read how many contacts the group currently has. If it is already 0 (empty / 'This group is empty'), skip straight to step 5.",
    "4. Otherwise remove the contacts one by one: click a contact → 'More Actions' → 'Remove From Group' → confirm; you return to the group. Repeat for each remaining contact until the group shows 0. (There is no select-all here — do not look for one.) When empty, print: RESULT: cleared",
    `5. Import the CSV into this SAME group: click 'Upload File'. In the macOS Open dialog press Command-Shift-G, type this exact path: ${opts.csvPath} , press Return, then double-click the file (or Open).`,
    "6. On the column-mapping / preview screen, map the columns to Name and Phone, then click Import to finish INTO this same group.",
    `7. Wait briefly for the count to settle, then READ the group's contact count and IMMEDIATELY print a line of the form: RESULT: count=<N>  (where <N> is the exact integer shown). Print this the instant you read it, before anything else.`,
    `8. If <N> equals ${opts.expectedCount}, make your FINAL line exactly: RESULT: ok . Otherwise make your FINAL line exactly: RESULT: failed`,
    "Rules: print 'RESULT: count=<N>' the instant you read the post-import count; the FINAL RESULT line is ok / failed / needs-login. Never invent a count you did not read on screen.",
  ].join("\n");
}

/**
 * Interpret Iris output. Resilient to turn-exhaustion: if Iris printed a
 * post-import `RESULT: count=<N>` that matches the expected count, we treat the
 * upload as OK even when it never reached the final `RESULT: ok` line (the exact
 * false-negative that made a completed upload look failed). Precedence:
 *   needs-login (anywhere)  → needs_login
 *   final marker ok         → ok
 *   count=<expected>        → ok
 *   count=<other>           → failed (count mismatch)
 *   final marker failed / none → failed
 */
export function parseIrisResult(output: string, expectedCount?: number): IrisUploadResult {
  if (/RESULT:\s*needs-login/i.test(output)) return { status: "needs_login" };

  const terminal = [...output.matchAll(/RESULT:\s*(ok|failed)\b/gi)].at(-1)?.[1]?.toLowerCase();
  if (terminal === "ok") return { status: "ok" };

  // Verified-count fallback — the load-bearing robustness fix.
  const counts = [...output.matchAll(/RESULT:\s*count\s*=\s*(\d+)/gi)].map((m) => parseInt(m[1], 10));
  const lastCount = counts.at(-1);
  if (lastCount !== undefined && expectedCount !== undefined) {
    if (lastCount === expectedCount) return { status: "ok" };
    return { status: "failed", detail: `post-import count ${lastCount} ≠ expected ${expectedCount}` };
  }

  if (terminal === "failed") return { status: "failed", detail: "iris reported failed" };
  return { status: "failed", detail: "no usable RESULT marker in Iris output" };
}

/**
 * Drive Text-Em-All via Iris to empty the group and upload the CSV. Must be
 * called INSIDE withGuiLock(). Never throws for a domain failure — returns a
 * recorded status. `deps.run` is injectable for tests.
 */
export async function irisUploadToGroup(
  opts: { csvPath: string; group: string; expectedCount: number; timeoutMs?: number },
  deps: { run?: (goal: string) => Promise<string> } = {},
): Promise<IrisUploadResult> {
  const goal = buildIrisUploadGoal(opts);
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
    const output = await run(goal);
    return parseIrisResult(output, opts.expectedCount);
  } catch (err) {
    return { status: "failed", detail: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
}
