import { prisma } from "../lib/prisma.js";
import { resolveConfig, ZILLOW_POLL_FLOOR_SEC } from "@tenant-ai/shared";
import { isGuiBusy } from "../lib/gui-lock.js";
import { runExclusiveCycle, isCycleSkipped } from "./zillow-cycle.js";
import {
  autoConfig,
  localDay,
  localSlot,
  runZillowCycle,
  type AutoRunResult,
  type RunRecorder,
} from "./zillow-auto.js";
import { resolveZillowDelivery } from "./delivery-method.js";
import { notifyOnMac } from "./messages-relay.js";

/**
 * Fast-poll driver (rev.5 M3): when the Zillow lane is textemall + direct API,
 * run a Zillow cycle every ~fast_poll_sec seconds so new leads / applicant
 * transitions broadcast within minutes instead of waiting for 10/16/22.
 *
 * Deliberately a plain setInterval (like the watchdog/sweep — NOT BullMQ, so it
 * survives Redis being down). Every 30 s it EVALUATES cheaply; a cycle actually
 * runs only when every gate passes. Config is read per evaluation, so dashboard
 * changes apply within the 60 s config-cache TTL — no restart (S6).
 *
 * Gates (each with its own reason, for tests and status):
 *  - lane is textemall + api and zillow.auto_enabled (mode gate)
 *  - zillow.fast_poll_sec > 0 (0 = polling off; floor 120 — anti-bot, R3)
 *  - hour within [auto_start_hour, auto_end_hour] — NO scraping and NO texting
 *    outside human hours (U1; TEA's own calling window is disabled in the
 *    broadcast payload, so this gate is the only quiet-hours protection)
 *  - process uptime ≥ 120 s (T4 — a crash-relaunch rebuilds the live tree;
 *    never poll into a possibly mid-deploy process)
 *  - elapsed since last cycle end ≥ fast_poll_sec + jitter (0–20 s)
 *  - daily ceiling: today's sent+ambiguous batches < max_broadcasts_per_day
 *    (U3; poll-only — scheduled cycles are exempt, so worst case = ceiling+3)
 *  - GUI not busy (politeness peek — never queue a scrape behind a send; the
 *    benign TOCTOU just means the scrape briefly waits like any caller today)
 *  - cycle mutex free (try-mode — a busy cycle skips the tick, never queues)
 */

export const POLL_EVAL_MS = 30_000;
/** Re-export of the shared floor (rev.2 P4) — ONE source of truth; the shared
 *  copy exists so the dashboard's validation can never drift from the engine. */
export const POLL_FLOOR_SEC = ZILLOW_POLL_FLOOR_SEC;
export const POLL_MIN_UPTIME_SEC = 120;

export interface PollState {
  /** ms epoch of the last cycle END (0 = never — first in-window poll runs). */
  lastCycleEndMs: number;
  /** Jitter (ms) added to the NEXT gap — re-rolled after every cycle. */
  jitterMs: number;
  /** Last evaluation's outcome reason (for status/watchdog). */
  lastReason: string;
  /** ms epoch of the last completed poll cycle (any outcome). */
  lastPollAtMs: number;
  /** Last poll cycle outcome ("ran", "failed", "needs_login", …). */
  lastOutcome: string | null;
  /** ms epoch since polls have been eligible-but-blocked (gui/cycle/error); null when flowing. */
  blockedSinceMs: number | null;
  /** One stall notification per blocked streak (M5). */
  stallNotified: boolean;
}

export const initialPollState = (): PollState => ({
  lastCycleEndMs: 0,
  jitterMs: Math.floor(Math.random() * 20_000),
  lastReason: "not_evaluated",
  lastPollAtMs: 0,
  lastOutcome: null,
  blockedSinceMs: null,
  stallNotified: false,
});

export interface PollDecisionInput {
  now: Date;
  uptimeSec: number;
  transport: "textemall" | "relay";
  method: "api" | "form";
  enabled: boolean;
  fastPollSec: number; // raw config (0 = off); floor applied here
  startHour: number;
  endHour: number;
  broadcastsToday: number; // sent + ambiguous batches today
  maxPerDay: number; // 0 = unlimited
  guiBusy: boolean;
  state: Pick<PollState, "lastCycleEndMs" | "jitterMs">;
}

/** Pure gate decision — one reason per gate, in priority order. */
export function decidePoll(input: PollDecisionInput): { due: boolean; reason: string } {
  const { now, state } = input;
  if (input.transport !== "textemall" || input.method !== "api") return { due: false, reason: "mode_not_api" };
  if (!input.enabled) return { due: false, reason: "auto_disabled" };
  if (input.fastPollSec <= 0) return { due: false, reason: "poll_off" };
  const hour = now.getHours();
  if (hour < input.startHour || hour > input.endHour) return { due: false, reason: "outside_window" };
  if (input.uptimeSec < POLL_MIN_UPTIME_SEC) return { due: false, reason: "warming_up" };
  const gapMs = Math.max(input.fastPollSec, POLL_FLOOR_SEC) * 1000 + state.jitterMs;
  if (now.getTime() - state.lastCycleEndMs < gapMs) return { due: false, reason: "not_due" };
  if (input.maxPerDay > 0 && input.broadcastsToday >= input.maxPerDay)
    return { due: false, reason: "daily_ceiling" };
  if (input.guiBusy) return { due: false, reason: "gui_busy" };
  return { due: true, reason: "due" };
}

function clampInt(raw: string | null | undefined, def: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

/** Poll-cycle minute slot, e.g. "2026-08-31T14:23". */
export function pollSlot(now: Date): string {
  return `${localSlot(now)}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/**
 * Lazy recorder (S1): persists a ZillowAutoRun row ONLY when something actually
 * happened — a broadcast went out (queued/sent > 0) or the cycle failed for a
 * reason worth surfacing. Empty polls and import-busy skips leave ZERO rows.
 * Always returns the row-shaped summary so runZillowCycle needs no guards.
 */
export function lazyRecorder(day: string, slot: string): RunRecorder {
  return {
    finish: async (status, patch) => {
      const summary = {
        day,
        slot,
        status,
        attempts: 1,
        leadsFound: patch.leadsFound ?? 0,
        leadsNew: patch.leadsNewDelta ?? 0,
        queuedSends: patch.queuedDelta ?? 0,
        sentImmediate: patch.sentDelta ?? 0,
        error: patch.error ?? null,
      };
      const acted = (patch.queuedDelta ?? 0) > 0 || (patch.sentDelta ?? 0) > 0;
      const importBusy = /import busy/i.test(patch.error ?? "");
      if ((status === "done" && !acted) || importBusy) return summary; // no row
      // Upsert: a same-minute retry after a failure reuses its row.
      await prisma.zillowAutoRun.upsert({
        where: { slot },
        create: { day, slot, status, attempts: 1, leadsFound: summary.leadsFound, leadsNew: summary.leadsNew, queuedSends: summary.queuedSends, sentImmediate: summary.sentImmediate, error: summary.error, finishedAt: new Date() },
        update: { status, attempts: { increment: 1 }, leadsFound: summary.leadsFound, leadsNew: { increment: summary.leadsNew }, queuedSends: { increment: summary.queuedSends }, sentImmediate: { increment: summary.sentImmediate }, error: summary.error, finishedAt: new Date() },
      }).catch((e) => console.error(`[zillow-poll] run-row persist failed (broadcast state already committed, safe): ${e}`));
      return summary;
    },
  };
}

export interface PollTickDeps {
  now?: () => Date;
  uptimeSec?: () => number;
  guiBusy?: () => boolean;
  runCycle?: typeof runZillowCycle;
  broadcastsToday?: (day: string) => Promise<number>;
  notify?: (text: string, title?: string) => void;
}

/** Reasons that mean "polls WANT to run but something is in the way". */
const BLOCKED = (reason: string): boolean =>
  reason === "gui_busy" || reason === "cycle_busy" || reason.startsWith("error:");

/**
 * Stall watch (M5, streak-collapsed): while polls are eligible but blocked for
 * longer than 3× the poll gap, notify the owner ONCE; one recovery note when a
 * cycle finally completes. Quiet-gate reasons (window, mode, not_due…) never
 * count as blocked — they are the poll resting, not failing.
 */
function trackStall(state: PollState, reason: string, gapMs: number, nowMs: number, notify: (t: string, ti?: string) => void): void {
  if (!BLOCKED(reason)) {
    if (reason === "ran_cycle" && state.stallNotified) {
      notify("Zillow real-time polling recovered — cycles are running again.", "Tenant AI Zillow");
    }
    if (reason === "ran_cycle" || !BLOCKED(state.lastReason)) {
      state.blockedSinceMs = null;
      if (reason === "ran_cycle") state.stallNotified = false;
    }
    return;
  }
  state.blockedSinceMs ??= nowMs;
  if (!state.stallNotified && nowMs - state.blockedSinceMs > 3 * gapMs) {
    notify(
      `Zillow real-time polling has been stalled for ${Math.round((nowMs - state.blockedSinceMs) / 60_000)} min (${reason}). New leads wait until it recovers.`,
      "Tenant AI Zillow",
    );
    state.stallNotified = true;
  }
}

async function countBroadcastsToday(day: string): Promise<number> {
  return prisma.textEmAllBatch.count({ where: { day, status: { in: ["sent", "ambiguous"] } } });
}

/**
 * One evaluation → maybe one cycle. Returns the decision reason (and outcome
 * when a cycle ran) — the driver logs it; tests assert on it. Never throws.
 */
export async function runPollTick(state: PollState, deps: PollTickDeps = {}): Promise<{ reason: string; outcome?: string }> {
  try {
    const now = (deps.now ?? (() => new Date()))();
    const delivery = await resolveZillowDelivery();
    const { enabled, startHour, endHour, runHours, baseline } = await autoConfig();
    const fastPollSec = clampInt(await resolveConfig("zillow", "fast_poll_sec"), 0);
    const maxPerDay = clampInt(await resolveConfig("zillow", "max_broadcasts_per_day"), 50);
    const day = localDay(now);
    const broadcastsToday = await (deps.broadcastsToday ?? countBroadcastsToday)(day);

    const decision = decidePoll({
      now,
      uptimeSec: (deps.uptimeSec ?? (() => process.uptime()))(),
      transport: delivery.transport,
      method: delivery.method,
      enabled,
      fastPollSec,
      startHour,
      endHour,
      broadcastsToday,
      maxPerDay,
      guiBusy: (deps.guiBusy ?? isGuiBusy)(),
      state,
    });
    const gapMs = Math.max(fastPollSec, POLL_FLOOR_SEC) * 1000;
    const notify = deps.notify ?? notifyOnMac;
    if (!decision.due) {
      trackStall(state, decision.reason, gapMs, now.getTime(), notify);
      state.lastReason = decision.reason;
      return { reason: decision.reason };
    }
    state.lastReason = decision.reason;

    const slot = pollSlot(now);
    const cycle = await runExclusiveCycle("try", () =>
      (deps.runCycle ?? runZillowCycle)(lazyRecorder(day, slot), {
        trigger: "poll",
        now,
        day,
        slot,
        force: false,
        runHours,
        baseline,
      }),
    );
    if (isCycleSkipped(cycle)) {
      trackStall(state, "cycle_busy", gapMs, now.getTime(), notify);
      state.lastReason = "cycle_busy";
      return { reason: "cycle_busy" };
    }
    const result = cycle as AutoRunResult;
    state.lastCycleEndMs = Date.now();
    state.lastPollAtMs = state.lastCycleEndMs;
    state.jitterMs = Math.floor(Math.random() * 20_000);
    state.lastOutcome = result.outcome;
    trackStall(state, "ran_cycle", gapMs, now.getTime(), notify);
    state.lastReason = "ran_cycle";
    return { reason: "ran_cycle", outcome: result.outcome };
  } catch (err) {
    // Infra-level failure (DB down etc.): record, never crash the interval.
    state.lastReason = `error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200);
    return { reason: state.lastReason };
  }
}

/** Module-level state, shared with status/watchdog readers (M5). */
export const pollState: PollState = initialPollState();

export interface PollStatus {
  /** Polling is configured on (mode api + enabled + interval > 0). */
  active: boolean;
  fastPollSec: number;
  /** Raw configured value of zillow.fast_poll_sec (pre-floor). */
  configuredSec: number;
  /** The engine's hard interval floor (UI must not hardcode it). */
  floorSec: number;
  /** Lane state — lets the UI explain WHY polling is dormant (rev.2 P1/P3). */
  transport: "textemall" | "relay";
  method: "api" | "form";
  autoEnabled: boolean;
  windowStartHour: number;
  windowEndHour: number;
  inWindow: boolean;
  lastPollAt: string | null;
  lastOutcome: string | null;
  lastReason: string;
  /** Today's sent + ambiguous batches (both segments) vs the poll ceiling. */
  sentToday: number;
  maxPerDay: number;
  /** Quarantined (ambiguous) batches awaiting resolution — surfaced as a badge. */
  ambiguousCount: number;
}

/** Status block for the dashboard (merged into /internal/zillow/auto-status). */
export async function getPollStatus(now: Date = new Date()): Promise<PollStatus> {
  const delivery = await resolveZillowDelivery();
  const { enabled, startHour, endHour } = await autoConfig();
  const fastPollSec = clampInt(await resolveConfig("zillow", "fast_poll_sec"), 0);
  const maxPerDay = clampInt(await resolveConfig("zillow", "max_broadcasts_per_day"), 50);
  const [sentToday, ambiguousCount] = await Promise.all([
    countBroadcastsToday(localDay(now)),
    prisma.textEmAllBatch.count({ where: { status: "ambiguous" } }),
  ]);
  const hour = now.getHours();
  return {
    active: delivery.transport === "textemall" && delivery.method === "api" && enabled && fastPollSec > 0,
    fastPollSec: fastPollSec > 0 ? Math.max(fastPollSec, POLL_FLOOR_SEC) : 0,
    configuredSec: fastPollSec,
    floorSec: POLL_FLOOR_SEC,
    transport: delivery.transport,
    method: delivery.method,
    autoEnabled: enabled,
    windowStartHour: startHour,
    windowEndHour: endHour,
    inWindow: hour >= startHour && hour <= endHour,
    lastPollAt: pollState.lastPollAtMs ? new Date(pollState.lastPollAtMs).toISOString() : null,
    lastOutcome: pollState.lastOutcome,
    lastReason: pollState.lastReason,
    sentToday,
    maxPerDay,
    ambiguousCount,
  };
}

export function startZillowFastPoll(log: (msg: string) => void): NodeJS.Timeout {
  const timer = setInterval(async () => {
    const before = pollState.lastReason;
    const res = await runPollTick(pollState);
    // Log transitions and actual cycles — not every quiet evaluation.
    if (res.outcome) log(`[zillow-poll] cycle → ${res.outcome}`);
    else if (res.reason !== before && res.reason !== "not_due") log(`[zillow-poll] ${res.reason}`);
  }, POLL_EVAL_MS);
  timer.unref?.();
  return timer;
}
