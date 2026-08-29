import { describe, it, expect } from "vitest";
import { buildSupervisorReport, type SupervisorStatus } from "../services/zillow-supervisor-report.js";

const now = new Date(2001, 5, 16, 9, 30); // 2001-06-16 09:30 → yesterday = 2001-06-15
const run = (slot: string, status: string, error: string | null = null) => ({ day: slot.slice(0, 10), slot, status, error, leadsNew: 0, queuedSends: 0 });
const base = (over: Partial<SupervisorStatus> = {}): SupervisorStatus => ({
  enabled: true, runHours: [10, 16, 22], startHour: 8, endHour: 22, today: null,
  last30Days: [run("2001-06-15T10", "done"), run("2001-06-15T16", "done"), run("2001-06-15T22", "done")],
  deferredQueue: { depth: 0, oldestAgeDays: null }, schedulerOnline: true, ...over,
});

describe("buildSupervisorReport", () => {
  it("server unreachable", () => {
    const r = buildSupervisorReport(null, now, "http://localhost:3005");
    expect(r.allClear).toBe(false); expect(r.message).toMatch(/unreachable/);
  });
  it("automation off → all clear", () => {
    expect(buildSupervisorReport(base({ enabled: false }), now).message).toBe("all clear (automation off)");
  });
  it("all scheduled runs done yesterday → all clear with the count", () => {
    const r = buildSupervisorReport(base(), now);
    expect(r.allClear).toBe(true); expect(r.message).toBe("all clear (yesterday 3/3 scheduled runs ok)");
  });
  it("missed and failed slots yesterday are listed by hour", () => {
    const r = buildSupervisorReport(base({ last30Days: [run("2001-06-15T10", "done"), run("2001-06-15T16", "failed", "group-set failed")] }), now);
    expect(r.allClear).toBe(false);
    expect(r.message).toMatch(/missed 22:00/); expect(r.message).toMatch(/16:00 failed \(group-set failed\)/);
  });
  it("hourly window mode expects every hour of the window", () => {
    const r = buildSupervisorReport(base({ runHours: null, startHour: 20, endHour: 22, last30Days: [run("2001-06-15T20", "done"), run("2001-06-15T22", "done")] }), now);
    expect(r.message).toMatch(/missed 21:00/);
  });
  it("old server without per-slot status: judged by day, never a false 'missed'", () => {
    const legacy = (status: string) => ({ day: "2001-06-15", slot: null, status, error: null, leadsNew: 0, queuedSends: 0 });
    expect(buildSupervisorReport(base({ last30Days: [legacy("done"), legacy("failed")] }), now).message).toBe("all clear (yesterday 1 run(s) ok)");
    expect(buildSupervisorReport(base({ last30Days: [legacy("failed")] }), now).message).toMatch(/all failed \(failed\)/);
    expect(buildSupervisorReport(base({ last30Days: [] }), now).message).toMatch(/no runs at all/);
  });
  it("scheduler offline and today's needs_login / deferred queue are reported; it never suggests triggering", () => {
    const r = buildSupervisorReport(base({ schedulerOnline: false, today: run("2001-06-16T08", "needs_login"), deferredQueue: { depth: 4, oldestAgeDays: 5 } }), now);
    expect(r.message).toMatch(/OFFLINE/); expect(r.message).toMatch(/Safari login/); expect(r.message).toMatch(/4 queued survey texts/);
    expect(r.message).not.toMatch(/trigger/i);
  });
});
