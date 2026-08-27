/**
 * Iris-cron supervisor for the daily Zillow automation. Zero-token: pure
 * deterministic checks, no LLM. Designed for iris-cron.py's script-job
 * wrapper, whose convention is: print "all clear" → silent; print anything
 * else → macOS notification with the output as the message.
 *
 * Checks, in order:
 *  1. server reachable (direct HTTP — works even when Redis/BullMQ is down)
 *  2. automation off → report "all clear (automation off)" — silent, by design
 *  3. today's run missing/unhealed after the window → trigger auto-run
 *     (no force; the claim semantics make this race-safe), re-check
 *  4. needs_login / failed → notify with the fix
 *  5. deferred link queue older than DEFER_ALERT_DAYS → notify
 *
 * Usage: tsx scripts/zillow-auto-supervise.ts  (from apps/server)
 */
import { initConfigResolver, resolveConfig } from "@tenant-ai/shared";
import { prismaConfigStore } from "../src/lib/config-store.js";

const DEFER_ALERT_DAYS = 3;

initConfigResolver(prismaConfigStore);

function out(msg: string): never {
  console.log(msg);
  process.exit(0);
}

const secret = await resolveConfig("sms_relay", "internal_secret");
if (!secret) out("Zillow automation supervisor: no internal secret configured — cannot check.");

const base = `http://localhost:${process.env.SERVER_PORT || "3005"}`;
const headers = { "x-relay-secret": secret!, "Content-Type": "application/json" };

interface Status {
  enabled: boolean;
  autoHour: number;
  today: { status: string; error: string | null; leadsNew: number; queuedSends: number } | null;
  deferredQueue: { depth: number; oldestAgeDays: number | null };
}

async function fetchStatus(): Promise<Status | null> {
  try {
    const r = await fetch(`${base}/internal/zillow/auto-status`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    return (await r.json()) as Status;
  } catch {
    return null;
  }
}

let status = await fetchStatus();
if (!status) out(`Zillow automation: tenant-ai server unreachable at ${base} — is it running?`);

if (!status.enabled) out("all clear (automation off)");

// Missing or unhealed run after the window opened → trigger (claim-safe).
const hour = new Date().getHours();
const needsRun =
  hour >= status.autoHour &&
  (!status.today || status.today.status === "needs_login" || status.today.status === "failed");

if (needsRun) {
  try {
    await fetch(`${base}/internal/zillow/auto-run`, {
      method: "POST",
      headers,
      body: "{}",
      signal: AbortSignal.timeout(300_000),
    });
  } catch {
    // fall through — re-check tells the truth
  }
  status = await fetchStatus();
  if (!status) out("Zillow automation: server became unreachable while triggering the daily run.");
}

const today = status.today;
if (hour >= status.autoHour && !today) {
  out("Zillow automation: today's run is missing and could not be triggered — check the server logs.");
}
if (today?.status === "needs_login") {
  out("Zillow automation: Safari's Zillow session expired. Open Safari, sign into Zillow Rental Manager — the automation retries hourly and will pick itself up.");
}
if (today?.status === "failed") {
  out(`Zillow automation: today's run failed — ${today.error ?? "no error recorded"}. It retries hourly; check the dashboard.`);
}
if (
  status.deferredQueue.oldestAgeDays !== null &&
  status.deferredQueue.oldestAgeDays > DEFER_ALERT_DAYS
) {
  out(
    `Zillow automation: ${status.deferredQueue.depth} queued survey texts, oldest waiting ${status.deferredQueue.oldestAgeDays} days — the send caps may be starved. Check the dashboard.`,
  );
}

out("all clear");
