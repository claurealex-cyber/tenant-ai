import { execFile } from "node:child_process";

const GROUP = "1. Leads 08/27/26";
const goal = [
  `You are inspecting the Text-Em-All web app in Safari. This is a READ-ONLY inspection: do NOT add, edit, delete, import, upload, or send anything. Do not click Send, Broadcast, Delete, Import, or Upload.`,
  `Steps:`,
  `1. Open Safari and go to https://app.text-em-all.com`,
  `2. If you land on a login / sign-in screen (email + password fields, or a "Log In" button and you are NOT already signed in), STOP and make your FINAL line exactly: RESULT: needs-login`,
  `3. If signed in, navigate to Contacts → Groups (or Lists). Find the group named "${GROUP}".`,
  `4. If no group with that exact name exists, make your FINAL line exactly: RESULT: no-group`,
  `5. If it exists, open it and read how many contacts / members it currently has.`,
  `6. Make your FINAL line exactly: RESULT: count=<N>  (replace <N> with the integer contact count you read; if you truly cannot read a count, use RESULT: count-unreadable)`,
  `Only ONE line may start with "RESULT:", and it must be the very last line you output. Take at most a few screenshots to confirm what you see.`,
].join("\n");

const IRIS = process.env.IRIS_BIN || "iris";
console.log(`[inspect] launching Iris (read-only) against group "${GROUP}"...`);
const child = execFile(IRIS, ["-p", goal, "--permission-mode", "dangerFullAccess", "--max-turns", "40"], { timeout: 8 * 60_000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
  const out = (stdout || "") + (stderr || "");
  const lines = out.split(/\r?\n/).filter((l) => /RESULT:/.test(l));
  const result = lines.at(-1)?.trim() || "(no RESULT marker)";
  console.log("\n========== IRIS RAW TAIL ==========");
  console.log(out.split(/\r?\n/).slice(-25).join("\n"));
  console.log("========== PARSED ==========");
  console.log("INSPECT RESULT:", result);
  if (err) console.log("(iris exited with error:", err.message.split("\n")[0], ")");
  process.exit(0);
});
child.stdout?.on("data", (d) => process.stdout.write(String(d)));
