/**
 * Iris-cron supervisor for the Zillow automation (09:30 daily). Zero-token,
 * LIVENESS + DIGEST ONLY — it never triggers a run. Convention for
 * iris-cron.py's script-job wrapper: print "all clear…" → silent; anything
 * else → macOS notification with the output as the message.
 *
 * In-hour reporting (missed / failed / crashed scheduled runs, scheduler
 * offline) is done by the in-process watchdog (src/services/zillow-watchdog.ts).
 * All decisions live in src/services/zillow-supervisor-report.ts (tested).
 *
 * Usage: tsx scripts/zillow-auto-supervise.ts  (from apps/server)
 */
import { initConfigResolver, resolveConfig } from "@tenant-ai/shared";
import { prismaConfigStore } from "../src/lib/config-store.js";
import { buildSupervisorReport, type SupervisorStatus } from "../src/services/zillow-supervisor-report.js";

initConfigResolver(prismaConfigStore);

const secret = await resolveConfig("sms_relay", "internal_secret");
if (!secret) {
  console.log("Zillow automation supervisor: no internal secret configured — cannot check.");
  process.exit(0);
}
const base = `http://localhost:${process.env.SERVER_PORT || "3005"}`;

let status: SupervisorStatus | null = null;
try {
  const r = await fetch(`${base}/internal/zillow/auto-status`, {
    headers: { "x-relay-secret": secret, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (r.ok) status = (await r.json()) as SupervisorStatus;
} catch {
  status = null;
}

console.log(buildSupervisorReport(status, new Date(), base).message);
process.exit(0);
