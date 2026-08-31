/**
 * Zillow schedule watchdog — reports (never triggers) scheduled runs that did
 * not happen, failed, crashed, or need a Safari login, and whether the hourly
 * scheduler tick is alive at all.
 *
 * Design (zillow-schedule-editor-plan.md M0, rev. 4):
 *  - Plain setInterval, deliberately NOT a BullMQ job: without Redis the server
 *    stays up (index.ts degrades registration to a warning) and the tick silently
 *    never fires — that is precisely when this must still report.
 *  - A slot is judged only once its hour has FULLY passed (+ grace), so a run
 *    that BullMQ promoted late (Mac woke at 10:38 → 10:00 job runs at 10:38) is
 *    never reported as missed.
 *  - Every unevaluated scheduled slot since the last verdict is judged on each
 *    tick (bounded to 24 h), so a sleep of any length yields exactly one verdict
 *    per slot. Consecutive misses collapse into one notification per streak.
 *  - Never calls runDailyAutomation: missed slots are accepted (no catch-up —
 *    decided 2026-08-27).
 */
import { resolveConfig } from "@tenant-ai/shared";
import { prisma } from "../lib/prisma.js";
import { getJobState, jobStateAlive, JOB_STALE_MS, type JobState } from "../jobs/scheduler.js";
import { notifyOnMac } from "./messages-relay.js";
import { pruneZillowArtifacts } from "./zillow-import.js";
import { autoConfig, STALE_RUNNING_MS } from "./zillow-auto.js";

/** The hourly tick stamps lastRunAt every hour (run hour or not); older = dead. */
export const SCHEDULER_STALE_MS = JOB_STALE_MS;
/** A slot is judged once its hour ended this long ago (late-in-hour runs settle). */
export const SLOT_GRACE_MS = 5 * 60_000;
/** Never judge slots older than this (bounded catch-up after long sleeps). */
export const LOOKBACK_MS = 24 * 3600_000;
export const WATCHDOG_TITLE = "Tenant AI Zillow";

export interface WatchdogSchedule {
  enabled: boolean;
  runHours: number[] | null;
  startHour: number;
  endHour: number;
  channel: "relay" | "textemall";
  broadcastHour: number;
}
export interface WatchdogRow {
  slot: string | null;
  status: string;
  error: string | null;
  startedAt: Date;
}
export interface WatchdogBatch {
  slot: string | null; // legacy per-day rows have no slot
  status: string;
  error: string | null;
}
export interface WatchdogState {
  lastEvaluatedSlot: string | null;
  missStreakOpen: boolean;
  schedulerOfflineNotified: boolean;
}
export interface WatchdogInput {
  now: Date;
  schedule: WatchdogSchedule;
  scheduler: JobState;
  rows: WatchdogRow[];
  batches: WatchdogBatch[];
  state: WatchdogState;
  staleRunningMs?: number;
}
export interface WatchdogDecision {
  schedulerOnline: boolean;
  notifications: string[];
  state: WatchdogState;
  evaluatedSlots: string[];
}

export const initialWatchdogState = (): WatchdogState => ({
  lastEvaluatedSlot: null,
  missStreakOpen: false,
  schedulerOfflineNotified: false,
});

const pad = (n: number) => String(n).padStart(2, "0");
/** "YYYY-MM-DDTHH" for a local Date (same format as ZillowAutoRun.slot). */
export function slotKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`;
}
/** Local Date at the start of a slot. */
export function slotStart(slot: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/.exec(slot);
  if (!m) throw new Error(`bad slot: ${slot}`);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], 0, 0, 0);
}
const hhmm = (h: number) => `${pad(h)}:00`;

/** Registered AND ticked (or freshly registered) within the last 65 minutes. */
export function isSchedulerOnline(state: JobState, now: Date): boolean {
  return jobStateAlive(state, now, SCHEDULER_STALE_MS);
}

export function isScheduledHour(hour: number, s: WatchdogSchedule): boolean {
  return s.runHours ? s.runHours.includes(hour) : hour >= s.startHour && hour <= s.endHour;
}

/** Pure decision: what to report, given the schedule, the run rows and prior state. */
export function decideWatchdog(input: WatchdogInput): WatchdogDecision {
  const { now, schedule, rows, batches } = input;
  const staleMs = input.staleRunningMs ?? STALE_RUNNING_MS;
  const state: WatchdogState = { ...input.state };
  const notifications: string[] = [];

  // 1. Scheduler liveness — one notification per outage, one on recovery.
  const online = isSchedulerOnline(input.scheduler, now);
  if (!online && !state.schedulerOfflineNotified) {
    notifications.push(
      "Zillow scheduler is OFFLINE (Redis) — no scheduled runs will fire until Tenant AI restarts with Redis up.",
    );
    state.schedulerOfflineNotified = true;
  } else if (online && state.schedulerOfflineNotified) {
    notifications.push("Zillow scheduler is back online — scheduled runs will fire again.");
    state.schedulerOfflineNotified = false;
  }

  // 2. Slots whose hour has fully passed (+ grace). Latest judgeable slot start:
  const latest = new Date(now.getTime() - 3600_000 - SLOT_GRACE_MS);
  latest.setMinutes(0, 0, 0);
  let cursor: Date;
  if (state.lastEvaluatedSlot) {
    cursor = new Date(slotStart(state.lastEvaluatedSlot).getTime() + 3600_000);
  } else {
    // First tick after boot: judge only the most recent settled slot (at most
    // one duplicate report after a restart — accepted).
    cursor = new Date(latest);
  }
  const floor = new Date(now.getTime() - LOOKBACK_MS);
  floor.setMinutes(0, 0, 0);
  if (cursor < floor) cursor = floor;

  const rowsBySlot = new Map<string, WatchdogRow>();
  for (const r of rows) if (r.slot) rowsBySlot.set(r.slot, r);
  const batchBySlot = new Map<string, WatchdogBatch>();
  for (const b of batches) if (b.slot) batchBySlot.set(b.slot, b);

  const evaluated: string[] = [];
  for (; cursor <= latest; cursor = new Date(cursor.getTime() + 3600_000)) {
    const slot = slotKey(cursor);
    evaluated.push(slot);
    const hour = cursor.getHours();
    if (!schedule.enabled || !isScheduledHour(hour, schedule)) continue;

    const row = rowsBySlot.get(slot);
    if (!row) {
      if (!state.missStreakOpen) {
        notifications.push(
          `Zillow: the ${hhmm(hour)} run did not happen (Mac asleep at :00, or scheduler offline) — skipped, no catch-up.`,
        );
        state.missStreakOpen = true;
      }
      continue;
    }
    // Any row means the tick fired → the miss streak is over.
    state.missStreakOpen = false;
    if (row.status === "needs_login") {
      notifications.push(
        `Zillow: the ${hhmm(hour)} run needs a Safari login (Zillow Rental Manager or Text-Em-All) — sign in; it retries at the next scheduled run.`,
      );
    } else if (row.status === "failed") {
      notifications.push(
        `Zillow: the ${hhmm(hour)} run failed — ${row.error ?? "no error recorded"}. It retries at the next scheduled run.`,
      );
    } else if (row.status === "running") {
      if (now.getTime() - row.startedAt.getTime() > staleMs) {
        notifications.push(
          `Zillow: the ${hhmm(hour)} run crashed mid-run (still marked running) — the next scheduled run will reclaim it.`,
        );
      }
    } else if (row.status === "done") {
      // Hourly-window + Text-Em-All: the once-a-day broadcast lives on its own key.
      if (!schedule.runHours && schedule.channel === "textemall" && hour === schedule.broadcastHour) {
        const b = batchBySlot.get(slot);
        if (b && b.status === "failed") {
          notifications.push(
            `Zillow: the ${hhmm(hour)} Text-Em-All broadcast failed — ${b.error ?? "no error recorded"}.`,
          );
        }
      }
    }
  }

  if (evaluated.length) state.lastEvaluatedSlot = evaluated[evaluated.length - 1];
  else if (!state.lastEvaluatedSlot) state.lastEvaluatedSlot = slotKey(latest);

  return { schedulerOnline: online, notifications, state, evaluatedSlots: evaluated };
}

// ── Runtime ────────────────────────────────────────────────────────────────

async function readSchedule(): Promise<WatchdogSchedule> {
  const cfg = await autoConfig();
  const channel = (await resolveConfig("zillow", "send_channel")) === "textemall" ? "textemall" : "relay";
  const bhRaw = parseInt((await resolveConfig("zillow", "textemall_broadcast_hour")) ?? "12", 10);
  const broadcastHour = Number.isFinite(bhRaw) ? Math.min(23, Math.max(0, bhRaw)) : 12;
  return {
    enabled: cfg.enabled,
    runHours: cfg.runHours,
    startHour: cfg.startHour,
    endHour: cfg.endHour,
    channel,
    broadcastHour,
  };
}

let state: WatchdogState = initialWatchdogState();
let timer: NodeJS.Timeout | null = null;

/** One watchdog evaluation against the live DB. Exported for tests / manual runs. */
export async function watchdogTick(
  now: Date = new Date(),
  log: (msg: string) => void = () => {},
  notify: (text: string, title: string) => void = notifyOnMac,
): Promise<WatchdogDecision> {
  const since = new Date(now.getTime() - LOOKBACK_MS - 2 * 3600_000);
  const [schedule, rows, batches] = await Promise.all([
    readSchedule(),
    prisma.zillowAutoRun.findMany({
      where: { startedAt: { gte: since } },
      select: { slot: true, status: true, error: true, startedAt: true },
    }),
    prisma.textEmAllBatch.findMany({
      where: { createdAt: { gte: since } },
      select: { slot: true, status: true, error: true },
    }),
  ]);
  const decision = decideWatchdog({
    now,
    schedule,
    scheduler: getJobState("zillow-daily"),
    rows,
    batches,
    state,
  });
  state = decision.state;
  for (const n of decision.notifications) {
    log(`[zillow-watchdog] ${n}`);
    notify(n, WATCHDOG_TITLE);
  }
  return decision;
}

/** Current liveness verdict for status endpoints (same rule as the watchdog). */
export function schedulerOnlineNow(now: Date = new Date()): boolean {
  return isSchedulerOnline(getJobState("zillow-daily"), now);
}

export function startZillowWatchdog(log: (msg: string) => void): void {
  if (timer) return;
  timer = setInterval(() => {
    watchdogTick(new Date(), log).catch((err) => log(`[zillow-watchdog] error: ${err}`));
    // Daily retention prune (rev.5 M6) — piggybacks on the always-alive watchdog
    // interval (NOT inside watchdogTick, which tests invoke against shared-DB
    // fixtures); internally once-per-day, never blocks the watchdog.
    pruneZillowArtifacts(new Date())
      .then((pruned) => {
        if (pruned && (pruned.runs || pruned.files || pruned.batches)) {
          log(`[zillow-watchdog] retention prune: ${pruned.runs} import runs, ${pruned.files} raw files, ${pruned.batches} sent batches`);
        }
      })
      .catch((err) => log(`[zillow-watchdog] retention prune failed: ${err}`));
  }, 60_000);
  timer.unref?.();
}

export function stopZillowWatchdog(): void {
  if (timer) clearInterval(timer);
  timer = null;
  state = initialWatchdogState();
}
