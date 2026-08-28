import { spawn } from "node:child_process";
import { buildIrisUploadGoal, parseIrisResult } from "../services/textemall-iris.js";

const csvPath = process.argv[2];
const group = process.argv[3] || "1. Leads 08/27/2026";
const expectedCount = parseInt(process.argv[4] || "2", 10);
const goal = buildIrisUploadGoal({ csvPath, group, expectedCount, groupUrl: process.env.TEA_GROUP_URL });

console.log(`[upload] group="${group}" csv=${csvPath} expect=${expectedCount}`);
const iris = process.env.IRIS_BIN || "iris";
const child = spawn(iris, ["-p", goal, "--permission-mode", "dangerFullAccess", "--max-turns", String(Number(process.env.IRIS_MAX_TURNS)||500)], { stdio: ["ignore", "pipe", "pipe"] });
let buf = "";
child.stdout.on("data", (d) => { const s = String(d); buf += s; process.stdout.write(s); });
child.stderr.on("data", (d) => { const s = String(d); buf += s; process.stderr.write(s); });
child.on("close", (code) => {
  const r = parseIrisResult(buf, expectedCount);
  console.log(`\n========== PARSED ==========`);
  console.log("UPLOAD RESULT:", JSON.stringify(r), "(iris exit", code + ")");
  process.exit(0);
});
