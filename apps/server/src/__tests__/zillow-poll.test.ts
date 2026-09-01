import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

/** Fast-poll driver tests (rev.5 M3). Real DB rows live on synthetic 2003 days. */

const cfg = {
  fastPollSec: "180" as string | null,
  maxPerDay: null as string | null,
  enabled: "true" as string | null,
  startHour: "8" as string | null,
  endHour: "22" as string | null,
};
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tenant-ai/shared")>();
  return {
    ...original,
    resolveConfig: async (ns: string, key: string) => {
      if (ns === "zillow" && key === "fast_poll_sec") return cfg.fastPollSec;
      if (ns === "zillow" && key === "max_broadcasts_per_day") return cfg.maxPerDay;
      if (ns === "zillow" && key === "auto_enabled") return cfg.enabled;
      if (ns === "zillow" && key === "auto_hour") return null;
      if (ns === "zillow" && key === "auto_start_hour") return cfg.startHour;
      if (ns === "zillow" && key === "auto_end_hour") return cfg.endHour;
      if (ns === "zillow" && key === "auto_run_hours") return null;
      if (ns === "zillow" && key === "auto_baseline") return null;
      return original.resolveConfig(ns, key);
    },
  };
});

const mockDelivery = vi.fn();
vi.mock("../services/delivery-method.js", () => ({
  resolveZillowDelivery: (...a: unknown[]) => mockDelivery(...a),
  resolveBroadcastMethod: async () => "api",
}));

import {
  decidePoll,
  runPollTick,
  lazyRecorder,
  pollSlot,
  initialPollState,
  getPollStatus,
  POLL_FLOOR_SEC,
  type PollState,
} from "../services/zillow-poll.js";
import { runExclusiveCycle } from "../services/zillow-cycle.js";
import { localDay } from "../services/zillow-auto.js";

const prisma = new PrismaClient();

// In-window synthetic clock: 2003-03-XX 12:30 local.
let daySeq = 1;
function nextNow(hour = 12, minute = 30): Date {
  daySeq++;
  return new Date(2003, 2, daySeq, hour, minute, 0);
}

const RAN = { outcome: "ran" as const };
const mockCycle = vi.fn();

function baseInput(now: Date, state: PollState) {
  return {
    now,
    uptimeSec: 999,
    transport: "textemall" as const,
    method: "api" as const,
    enabled: true,
    fastPollSec: 180,
    startHour: 8,
    endHour: 22,
    broadcastsToday: 0,
    maxPerDay: 50,
    guiBusy: false,
    state: { lastCycleEndMs: state.lastCycleEndMs, jitterMs: state.jitterMs },
  };
}

function freshState(): PollState {
  const s = initialPollState();
  s.jitterMs = 0; // deterministic
  return s;
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.zillowAutoRun.deleteMany({ where: { day: { startsWith: "2003-" } } });
  await prisma.textEmAllBatch.deleteMany({ where: { day: { startsWith: "2003-" } } });
  await prisma.$disconnect();
});
beforeEach(() => {
  cfg.fastPollSec = "180";
  cfg.maxPerDay = null;
  cfg.enabled = "true";
  cfg.startHour = "8";
  cfg.endHour = "22";
  mockDelivery.mockReset().mockResolvedValue({ transport: "textemall", method: "api" });
  mockCycle.mockReset().mockResolvedValue(RAN);
});

describe("decidePoll — gate priority and reasons", () => {
  it("walks every gate in order", () => {
    const state = freshState();
    const now = nextNow();
    const base = baseInput(now, state);
    expect(decidePoll({ ...base, method: "form" })).toMatchObject({ due: false, reason: "mode_not_api" });
    expect(decidePoll({ ...base, transport: "relay" })).toMatchObject({ reason: "mode_not_api" });
    expect(decidePoll({ ...base, enabled: false })).toMatchObject({ reason: "auto_disabled" });
    expect(decidePoll({ ...base, fastPollSec: 0 })).toMatchObject({ reason: "poll_off" });
    expect(decidePoll({ ...base, now: new Date(2003, 2, daySeq, 23, 0) })).toMatchObject({ reason: "outside_window" }); // U1
    expect(decidePoll({ ...base, now: new Date(2003, 2, daySeq, 7, 59) })).toMatchObject({ reason: "outside_window" });
    expect(decidePoll({ ...base, uptimeSec: 30 })).toMatchObject({ reason: "warming_up" }); // T4
    expect(decidePoll({ ...base, state: { lastCycleEndMs: now.getTime() - 60_000, jitterMs: 0 } })).toMatchObject({ reason: "not_due" });
    expect(decidePoll({ ...base, broadcastsToday: 50 })).toMatchObject({ reason: "daily_ceiling" }); // S8/U3
    expect(decidePoll({ ...base, guiBusy: true })).toMatchObject({ reason: "gui_busy" });
    expect(decidePoll(base)).toMatchObject({ due: true, reason: "due" });
  });

  it("window edges are INCLUSIVE (matches the scheduled window semantics)", () => {
    const state = freshState();
    const at8 = new Date(2003, 2, daySeq, 8, 0);
    const at22 = new Date(2003, 2, daySeq, 22, 59);
    expect(decidePoll({ ...baseInput(at8, state), now: at8 }).due).toBe(true);
    expect(decidePoll({ ...baseInput(at22, state), now: at22 }).due).toBe(true);
  });

  it("floor: fast_poll_sec below 120 behaves as 120 (anti-bot)", () => {
    const state = freshState();
    const now = nextNow();
    const base = { ...baseInput(now, state), fastPollSec: 30, state: { lastCycleEndMs: now.getTime() - 60_000, jitterMs: 0 } };
    expect(decidePoll(base)).toMatchObject({ reason: "not_due" }); // 60s < floor 120s
    expect(POLL_FLOOR_SEC).toBe(120);
    const later = { ...base, state: { lastCycleEndMs: now.getTime() - 121_000, jitterMs: 0 } };
    expect(decidePoll(later).due).toBe(true);
  });

  it("jitter extends the gap", () => {
    const state = freshState();
    const now = nextNow();
    const base = { ...baseInput(now, state), state: { lastCycleEndMs: now.getTime() - 185_000, jitterMs: 10_000 } };
    expect(decidePoll(base)).toMatchObject({ reason: "not_due" }); // 185s < 180s + 10s jitter
    expect(decidePoll({ ...base, state: { ...base.state, jitterMs: 0 } }).due).toBe(true);
  });
});

describe("runPollTick", () => {
  it("mode form → no cycle, reason mode_not_api (form/Zapier scheduling untouched)", async () => {
    mockDelivery.mockResolvedValue({ transport: "textemall", method: "form" });
    const state = freshState();
    const res = await runPollTick(state, { now: () => nextNow(), uptimeSec: () => 999, guiBusy: () => false, runCycle: mockCycle, broadcastsToday: async () => 0 });
    expect(res.reason).toBe("mode_not_api");
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it("due → runs ONE cycle with trigger 'poll' + minute slot; state advances", async () => {
    const state = freshState();
    const now = nextNow();
    const res = await runPollTick(state, { now: () => now, uptimeSec: () => 999, guiBusy: () => false, runCycle: mockCycle, broadcastsToday: async () => 0 });
    expect(res).toMatchObject({ reason: "ran_cycle", outcome: "ran" });
    expect(mockCycle).toHaveBeenCalledTimes(1);
    const [, ctx] = mockCycle.mock.calls[0];
    expect(ctx).toMatchObject({ trigger: "poll", slot: pollSlot(now), force: false });
    expect(state.lastCycleEndMs).toBeGreaterThan(0);
    expect(state.lastOutcome).toBe("ran");
  });

  it("config flip api→form stops polling on the NEXT evaluation (no restart)", async () => {
    const state = freshState();
    const first = await runPollTick(state, { now: () => nextNow(), uptimeSec: () => 999, guiBusy: () => false, runCycle: mockCycle, broadcastsToday: async () => 0 });
    expect(first.reason).toBe("ran_cycle");
    mockDelivery.mockResolvedValue({ transport: "textemall", method: "form" });
    const second = await runPollTick(state, { now: () => nextNow(), uptimeSec: () => 999, guiBusy: () => false, runCycle: mockCycle, broadcastsToday: async () => 0 });
    expect(second.reason).toBe("mode_not_api");
    expect(mockCycle).toHaveBeenCalledTimes(1);
  });

  it("cycle mutex busy → skipped tick, cycle NOT queued (try-mode)", async () => {
    const state = freshState();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holder = runExclusiveCycle("wait", async () => {
      await gate;
      return "held";
    });
    await new Promise((r) => setTimeout(r, 5));
    const res = await runPollTick(state, { now: () => nextNow(), uptimeSec: () => 999, guiBusy: () => false, runCycle: mockCycle, broadcastsToday: async () => 0 });
    expect(res.reason).toBe("cycle_busy");
    expect(mockCycle).not.toHaveBeenCalled();
    release();
    await holder;
  });

  it("gui busy → polite skip before touching the cycle mutex", async () => {
    const state = freshState();
    const res = await runPollTick(state, { now: () => nextNow(), uptimeSec: () => 999, guiBusy: () => true, runCycle: mockCycle, broadcastsToday: async () => 0 });
    expect(res.reason).toBe("gui_busy");
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it("daily ceiling blocks the poll (counts sent + ambiguous)", async () => {
    cfg.maxPerDay = "2";
    const state = freshState();
    const res = await runPollTick(state, { now: () => nextNow(), uptimeSec: () => 999, guiBusy: () => false, runCycle: mockCycle, broadcastsToday: async () => 2 });
    expect(res.reason).toBe("daily_ceiling");
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it("a throwing cycle NEVER escapes the tick (interval must survive)", async () => {
    const state = freshState();
    mockCycle.mockRejectedValue(new Error("db down"));
    const res = await runPollTick(state, { now: () => nextNow(), uptimeSec: () => 999, guiBusy: () => false, runCycle: mockCycle, broadcastsToday: async () => 0 });
    expect(res.reason).toContain("error: db down");
  });
});

describe("M5 — stall streak + poll status", () => {
  it("blocked polls (> 3× gap) notify ONCE per streak; recovery notifies once more", async () => {
    const state = freshState();
    const notify = vi.fn();
    const deps = { uptimeSec: () => 999, guiBusy: () => true, runCycle: mockCycle, broadcastsToday: async () => 0, notify };
    // First blocked tick opens the streak.
    await runPollTick(state, { ...deps, now: () => nextNow() });
    expect(notify).not.toHaveBeenCalled();
    // Simulate the streak having lasted > 3×180s — on the SAME synthetic clock.
    const t2 = nextNow();
    state.blockedSinceMs = t2.getTime() - 12 * 60_000;
    await runPollTick(state, { ...deps, now: () => t2 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("stalled");
    // Still blocked → no repeat.
    await runPollTick(state, { ...deps, now: () => nextNow() });
    expect(notify).toHaveBeenCalledTimes(1);
    // GUI frees → cycle runs → one recovery note, streak reset.
    await runPollTick(state, { ...deps, guiBusy: () => false, now: () => nextNow() });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1][0]).toContain("recovered");
    expect(state.stallNotified).toBe(false);
    expect(state.blockedSinceMs).toBeNull();
  });

  it("quiet gates (outside window / mode off) never count as a stall", async () => {
    const state = freshState();
    const notify = vi.fn();
    state.blockedSinceMs = Date.now() - 60 * 60_000; // even with an ancient streak marker
    mockDelivery.mockResolvedValue({ transport: "textemall", method: "form" });
    await runPollTick(state, { now: () => nextNow(), uptimeSec: () => 999, guiBusy: () => false, runCycle: mockCycle, broadcastsToday: async () => 0, notify });
    expect(notify).not.toHaveBeenCalled();
  });

  it("getPollStatus reports active + interval + ceiling; inert when fast_poll_sec=0", async () => {
    const s1 = await getPollStatus(nextNow());
    expect(s1).toMatchObject({
      active: true, fastPollSec: 180, configuredSec: 180, floorSec: 120,
      transport: "textemall", method: "api", autoEnabled: true,
      windowStartHour: 8, windowEndHour: 22, inWindow: true, maxPerDay: 50,
    });
    expect(typeof s1.sentToday).toBe("number");
    expect(typeof s1.ambiguousCount).toBe("number");
    // Sub-floor config: effective interval is floored, raw value still reported.
    cfg.fastPollSec = "60";
    const sFloor = await getPollStatus(nextNow());
    expect(sFloor).toMatchObject({ active: true, fastPollSec: 120, configuredSec: 60 });
    cfg.fastPollSec = "0";
    const s2 = await getPollStatus(nextNow());
    expect(s2).toMatchObject({ active: false, fastPollSec: 0, configuredSec: 0 });
    const s3 = await getPollStatus(new Date(2003, 2, daySeq, 23, 30));
    expect(s3.inWindow).toBe(false);
  });
});

describe("lazyRecorder — rows only when something happened (S1)", () => {
  it("done + nothing sent → NO row; done + broadcast → row; failed → row; import-busy → NO row", async () => {
    const now = nextNow();
    const day = localDay(now);
    const emptySlot = `${pollSlot(now)}:e`;
    await lazyRecorder(day, emptySlot).finish("done", { leadsFound: 5 });
    expect(await prisma.zillowAutoRun.findUnique({ where: { slot: emptySlot } })).toBeNull();

    const busySlot = `${pollSlot(now)}:b`;
    await lazyRecorder(day, busySlot).finish("failed", { error: "import busy: an import is already running" });
    expect(await prisma.zillowAutoRun.findUnique({ where: { slot: busySlot } })).toBeNull();

    const sentSlot = `${pollSlot(now)}:s`;
    const summary = await lazyRecorder(day, sentSlot).finish("done", { queuedDelta: 2, sentDelta: 2, leadsFound: 5, leadsNewDelta: 2 });
    expect(summary).toMatchObject({ day, slot: sentSlot, queuedSends: 2 });
    expect(await prisma.zillowAutoRun.findUnique({ where: { slot: sentSlot } })).toMatchObject({ status: "done", queuedSends: 2, leadsNew: 2 });

    const failSlot = `${pollSlot(now)}:f`;
    await lazyRecorder(day, failSlot).finish("failed", { error: "textemall leads broadcast failed" });
    expect(await prisma.zillowAutoRun.findUnique({ where: { slot: failSlot } })).toMatchObject({ status: "failed" });

    // Same-minute retry upserts (attempts increments) instead of colliding.
    await lazyRecorder(day, failSlot).finish("done", { queuedDelta: 1, sentDelta: 1 });
    expect(await prisma.zillowAutoRun.findUnique({ where: { slot: failSlot } })).toMatchObject({ status: "done", attempts: 2 });
  });
});
