/**
 * Pure report builder for the Iris-cron Zillow supervisor (09:30 daily).
 *
 * The supervisor is LIVENESS + DIGEST only: it never triggers a run (its old
 * `POST /internal/zillow/auto-run` bypassed the run-hours gate and produced an
 * unscheduled 09:30 run on 2026-08-28). In-hour reporting lives in the
 * in-process watchdog (zillow-watchdog.ts); this summarises YESTERDAY per
 * scheduled slot plus anything already wrong today.
 */

export interface SupervisorRun {
  day: string;
  slot: string | null;
  status: string;
  error: string | null;
  leadsNew: number;
  queuedSends: number;
}
export interface SupervisorStatus {
  enabled: boolean;
  runHours?: number[] | null;
  startHour?: number;
  endHour?: number;
  today: SupervisorRun | null;
  last30Days: SupervisorRun[];
  deferredQueue: { depth: number; oldestAgeDays: number | null };
  schedulerOnline?: boolean;
}
export interface SupervisorReport {
  allClear: boolean;
  /** Single message for the notification (or "all clear…"). */
  message: string;
}

export const DEFER_ALERT_DAYS = 3;
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (h: number) => `${pad(h)}:00`;

export function localDayOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function scheduledHours(s: SupervisorStatus): number[] {
  if (s.runHours && s.runHours.length) return [...s.runHours].sort((a, b) => a - b);
  const start = s.startHour ?? 8;
  const end = s.endHour ?? 22;
  const out: number[] = [];
  for (let h = start; h <= end; h++) out.push(h);
  return out;
}

export function buildSupervisorReport(status: SupervisorStatus | null, now: Date, base = ""): SupervisorReport {
  if (!status) {
    return { allClear: false, message: `Zillow automation: tenant-ai server unreachable at ${base} — is it running?` };
  }
  if (!status.enabled) return { allClear: true, message: "all clear (automation off)" };

  const problems: string[] = [];
  if (status.schedulerOnline === false) {
    problems.push("scheduler is OFFLINE (Redis) — no scheduled runs will fire until Tenant AI restarts with Redis up");
  }

  const yesterday = localDayOf(new Date(now.getTime() - 86_400_000));
  const hours = scheduledHours(status);
  const yRows = status.last30Days.filter((r) => r.day === yesterday);
  const slotAware = status.last30Days.some((r) => typeof r.slot === "string" && r.slot.length > 0);
  let ok = 0;
  if (slotAware) {
    const bySlot = new Map<string, SupervisorRun>();
    for (const r of yRows) if (r.slot) bySlot.set(r.slot, r);
    const missed: number[] = [];
    const failed: string[] = [];
    for (const h of hours) {
      const r = bySlot.get(`${yesterday}T${pad(h)}`);
      if (!r) missed.push(h);
      else if (r.status === "done") ok++;
      else failed.push(`${hhmm(h)} ${r.status}${r.error ? ` (${r.error.slice(0, 80)})` : ""}`);
    }
    if (missed.length) problems.push(`yesterday missed ${missed.map(hhmm).join(", ")} (Mac asleep or scheduler offline)`);
    if (failed.length) problems.push(`yesterday failed: ${failed.join("; ")}`);
  } else {
    // Server predates per-slot status (no `slot` in last30Days): judge the day
    // as a whole so an un-restarted server never produces a false "missed".
    ok = yRows.filter((r) => r.status === "done").length;
    if (!yRows.length) problems.push("yesterday had no runs at all (Mac asleep or scheduler offline)");
    else if (!ok) problems.push(`yesterday's runs all failed (${yRows[0].status}${yRows[0].error ? `: ${yRows[0].error.slice(0, 80)}` : ""})`);
  }

  const today = status.today;
  if (today?.status === "needs_login") problems.push("today's run needs a Safari login — sign in; it retries at the next scheduled run");
  if (today?.status === "failed") problems.push(`today's run failed — ${today.error ?? "no error recorded"}; it retries at the next scheduled run`);

  if (status.deferredQueue.oldestAgeDays !== null && status.deferredQueue.oldestAgeDays > DEFER_ALERT_DAYS) {
    problems.push(
      `${status.deferredQueue.depth} queued survey texts, oldest waiting ${status.deferredQueue.oldestAgeDays} days — the send caps may be starved`,
    );
  }

  if (!problems.length) {
    return { allClear: true, message: slotAware ? `all clear (yesterday ${ok}/${hours.length} scheduled runs ok)` : `all clear (yesterday ${ok} run(s) ok)` };
  }
  return { allClear: false, message: `Zillow automation: ${problems.join(" · ")}.` };
}
