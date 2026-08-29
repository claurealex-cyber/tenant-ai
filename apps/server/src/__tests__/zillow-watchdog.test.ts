import { describe, it, expect } from "vitest";
import {
  decideWatchdog,
  initialWatchdogState,
  isSchedulerOnline,
  slotKey,
  slotStart,
  type WatchdogInput,
  type WatchdogSchedule,
} from "../services/zillow-watchdog.js";

// Fixed local-time fixtures (the watchdog works in server-local hours).
const D = (h: number, m = 0, day = 15) => new Date(2001, 5, day, h, m, 0, 0);
const S = (h: number, day = 15) => slotKey(D(h, 0, day));
const fixed: WatchdogSchedule = { enabled: true, runHours: [10, 16, 22], startHour: 8, endHour: 22, channel: "textemall", broadcastHour: 12 };
const hourly: WatchdogSchedule = { enabled: true, runHours: null, startHour: 8, endHour: 22, channel: "textemall", broadcastHour: 12 };
const online = (now: Date) => ({ registered: true, registeredAt: D(0), lastRunAt: new Date(now.getTime() - 10 * 60_000), lastError: null });
const row = (h: number, status: string, extra: Partial<{ error: string | null; startedAt: Date; day: number }> = {}) => ({
  slot: S(h, extra.day ?? 15), status, error: extra.error ?? null, startedAt: extra.startedAt ?? D(h, 0, extra.day ?? 15),
});
function run(over: Partial<WatchdogInput> & { now: Date }) {
  return decideWatchdog({ schedule: fixed, scheduler: online(over.now), rows: [], batches: [], state: initialWatchdogState(), ...over });
}

describe("slot helpers", () => {
  it("round-trips local slots", () => {
    expect(slotKey(D(9, 30))).toBe("2001-06-15T09");
    expect(slotStart("2001-06-15T09").getTime()).toBe(D(9).getTime());
  });
});

describe("scheduler liveness", () => {
  it("unregistered → offline; fresh registration → online; stale lastRunAt → offline", () => {
    const now = D(12);
    expect(isSchedulerOnline({ registered: false, registeredAt: null, lastRunAt: null, lastError: null }, now)).toBe(false);
    expect(isSchedulerOnline({ registered: true, registeredAt: D(11, 30), lastRunAt: null, lastError: null }, now)).toBe(true);
    expect(isSchedulerOnline({ registered: true, registeredAt: D(0), lastRunAt: D(10, 56), lastError: null }, now)).toBe(true); // 64 min
    expect(isSchedulerOnline({ registered: true, registeredAt: D(0), lastRunAt: D(10, 54), lastError: null }, now)).toBe(false); // 66 min
  });
  it("offline → one notification; stays silent while offline; one 'back online' on recovery", () => {
    const off = { registered: false, registeredAt: null, lastRunAt: null, lastError: null };
    const a = run({ now: D(12, 20), scheduler: off, rows: [row(10, "done")] });
    expect(a.notifications.filter((n) => n.includes("OFFLINE"))).toHaveLength(1);
    const b = run({ now: D(12, 21), scheduler: off, state: a.state });
    expect(b.notifications.filter((n) => n.includes("OFFLINE"))).toHaveLength(0);
    const c = run({ now: D(12, 22), state: b.state });
    expect(c.notifications.some((n) => n.includes("back online"))).toBe(true);
    expect(c.state.schedulerOfflineNotified).toBe(false);
  });
});

describe("slot evaluation timing", () => {
  it("first tick after boot judges only the most recent settled slot", () => {
    const d = run({ now: D(11, 4) }); // 10:00 slot ends 11:00; grace 5 min not yet passed → 09 is latest settled
    expect(d.evaluatedSlots).toEqual([S(9)]);
    expect(d.notifications).toHaveLength(0); // 09 is not a run hour
  });
  it("a scheduled hour is judged only after HH+1:05 — a late-in-hour run is never 'missed'", () => {
    const early = run({ now: D(11, 4), state: { ...initialWatchdogState(), lastEvaluatedSlot: S(9) } });
    expect(early.evaluatedSlots).toEqual([]); // 10 not settled yet
    expect(early.notifications).toHaveLength(0);
    // the run happened at 10:38 (BullMQ promoted the overdue job on wake)
    const late = run({ now: D(11, 6), state: early.state, rows: [row(10, "done", { startedAt: D(10, 38) })] });
    expect(late.evaluatedSlots).toEqual([S(10)]);
    expect(late.notifications).toHaveLength(0);
  });
  it("scheduled hour with no row → exactly one 'did not happen' report", () => {
    const d = run({ now: D(11, 6), state: { ...initialWatchdogState(), lastEvaluatedSlot: S(9) } });
    expect(d.notifications).toHaveLength(1);
    expect(d.notifications[0]).toMatch(/10:00 run did not happen/);
    expect(d.state.missStreakOpen).toBe(true);
    expect(d.state.lastEvaluatedSlot).toBe(S(10));
  });
  it("long sleep: every unevaluated slot is judged once; unscheduled hours stay silent; misses collapse into one streak", () => {
    const d = run({ now: D(23, 30), state: { ...initialWatchdogState(), lastEvaluatedSlot: S(9) } });
    expect(d.evaluatedSlots).toEqual([S(10), S(11), S(12), S(13), S(14), S(15), S(16), S(17), S(18), S(19), S(20), S(21), S(22)]);
    expect(d.notifications).toHaveLength(1); // 10, 16, 22 all missed → one streak notification
    expect(d.notifications[0]).toMatch(/10:00/);
  });
  it("a run closes the miss streak, so the next miss reports again", () => {
    const d = run({
      now: D(23, 30),
      state: { ...initialWatchdogState(), lastEvaluatedSlot: S(9) },
      rows: [row(16, "done")],
    });
    // 10 missed (streak opens) → 16 done (closes) → 22 missed (reports again)
    expect(d.notifications.filter((n) => n.includes("did not happen"))).toHaveLength(2);
  });
  it("catch-up is bounded to 24 h", () => {
    const d = run({ now: D(12, 0, 20), state: { ...initialWatchdogState(), lastEvaluatedSlot: S(9, 10) } });
    const first = slotStart(d.evaluatedSlots[0]);
    expect(D(12, 0, 20).getTime() - first.getTime()).toBeLessThanOrEqual(24 * 3600_000);
  });
  it("disabled automation: slots advance silently", () => {
    const d = run({ now: D(23, 30), schedule: { ...fixed, enabled: false }, state: { ...initialWatchdogState(), lastEvaluatedSlot: S(9) } });
    expect(d.notifications).toHaveLength(0);
    expect(d.state.lastEvaluatedSlot).toBe(S(22));
  });
});

describe("row verdicts", () => {
  const at = () => ({ now: D(11, 6), state: { ...initialWatchdogState(), lastEvaluatedSlot: S(9) } });
  it("failed → error message; needs_login → sign-in message", () => {
    expect(run({ ...at(), rows: [row(10, "failed", { error: "group-set failed" })] }).notifications[0]).toMatch(/10:00 run failed — group-set failed/);
    expect(run({ ...at(), rows: [row(10, "needs_login")] }).notifications[0]).toMatch(/needs a Safari login/);
  });
  it("running: recent → silent; stale → crashed", () => {
    expect(run({ ...at(), rows: [row(10, "running", { startedAt: D(11, 2) })] }).notifications).toHaveLength(0);
    expect(run({ ...at(), rows: [row(10, "running", { startedAt: D(10, 0) })] }).notifications[0]).toMatch(/crashed mid-run/);
  });
  it("hourly window + Text-Em-All: a failed broadcast at the broadcast hour is reported; other hours are not", () => {
    const st = { ...initialWatchdogState(), lastEvaluatedSlot: S(11) };
    const d = run({ now: D(13, 6), schedule: hourly, state: st, rows: [row(12, "done")], batches: [{ slot: S(12), status: "failed", error: "upload" }] });
    expect(d.notifications[0]).toMatch(/12:00 Text-Em-All broadcast failed — upload/);
    const other = run({ now: D(14, 6), schedule: hourly, state: d.state, rows: [row(13, "done")], batches: [{ slot: S(13), status: "failed", error: "x" }] });
    expect(other.notifications).toHaveLength(0);
  });
  it("hourly window: hours outside the window are never judged as missed", () => {
    const d = run({ now: D(8, 6), schedule: hourly, state: { ...initialWatchdogState(), lastEvaluatedSlot: S(5) } });
    expect(d.evaluatedSlots).toEqual([S(6), S(7)]);
    expect(d.notifications).toHaveLength(0);
  });
});
