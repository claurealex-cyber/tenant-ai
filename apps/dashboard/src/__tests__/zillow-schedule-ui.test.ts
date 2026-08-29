import { describe, it, expect } from "vitest";
import {
  PRESETS, applyPreset, toggleHour, matchingPreset, summaryFor, bodyFor, draftFromStatus, sameSchedule,
} from "../app/admin/zillow/schedule-ui";

const ctx = { channel: "textemall" as const, monthlyCap: 96, nowHour: 11, enabled: true };
const three = draftFromStatus({ mode: "fixed", hours: [10, 16, 22], startHour: 8, endHour: 22, broadcastHour: 12 });

describe("schedule-ui", () => {
  it("draftFromStatus: from the schedule block, or from legacy runHours/window fields", () => {
    expect(three).toEqual({ mode: "fixed", hours: [10, 16, 22], startHour: 8, endHour: 22, broadcastHour: 12 });
    expect(draftFromStatus({ runHours: [22, 10], startHour: 9, endHour: 21 })).toMatchObject({ mode: "fixed", hours: [10, 22], startHour: 9 });
    expect(draftFromStatus({ runHours: null, startHour: 9, endHour: 21 })).toMatchObject({ mode: "hourly", hours: [] });
  });
  it("presets: 3×/day is recommended; applying one switches to fixed mode; matchingPreset round-trips", () => {
    expect(PRESETS.find((p) => p.recommended)?.hours).toEqual([10, 16, 22]);
    const hourly = { ...three, mode: "hourly" as const, hours: [] };
    const d = applyPreset(hourly, PRESETS[3]);
    expect(d).toMatchObject({ mode: "fixed", hours: [9, 12, 16, 20] });
    expect(matchingPreset(d)?.id).toBe("4x");
    expect(matchingPreset(toggleHour(d, 7))).toBeNull();
    expect(matchingPreset(hourly)).toBeNull();
  });
  it("toggleHour adds/removes and keeps hours sorted; runs/day is derived from the chips", () => {
    const d = toggleHour(toggleHour(three, 7), 16);
    expect(d.hours).toEqual([7, 10, 22]);
    expect(summaryFor(d, ctx).runsPerDay).toBe(3);
    expect(summaryFor(toggleHour(d, 7), ctx).runsPerDay).toBe(2);
  });
  it("summary: label, next run, Zapier estimate; 4×/day warns on Text-Em-All but not on relay", () => {
    expect(summaryFor(three, ctx)).toMatchObject({ label: "3×/day at 10:00, 16:00, 22:00", nextRunLabel: "16:00", monthlyEstimate: 93, capWarning: false, sleepyHours: [], problems: [] });
    const four = applyPreset(three, PRESETS[3]);
    expect(summaryFor(four, ctx)).toMatchObject({ monthlyEstimate: 124, capWarning: true });
    expect(summaryFor(four, { ...ctx, channel: "relay" }).capWarning).toBe(false);
    expect(summaryFor(four, { ...ctx, monthlyCap: 130 }).capWarning).toBe(false);
  });
  it("sleepy-hour hint and blocking problems", () => {
    expect(summaryFor(toggleHour(three, 3), ctx).sleepyHours).toEqual([3]);
    expect(summaryFor({ ...three, hours: [] }, ctx).problems).toEqual(["pick at least one hour"]);
    expect(summaryFor({ ...three, mode: "hourly", startHour: 20, endHour: 8 }, ctx).problems).toEqual(["the window must start before it ends"]);
  });
  it("bodyFor: fixed sends hours; hourly sends the window and the broadcast hour only for Text-Em-All", () => {
    expect(bodyFor(three, { includeBroadcastHour: true })).toEqual({ mode: "fixed", hours: [10, 16, 22], acknowledgeCap: false });
    const hourly = { ...three, mode: "hourly" as const };
    expect(bodyFor(hourly, { includeBroadcastHour: true, acknowledgeCap: true })).toEqual({ mode: "hourly", startHour: 8, endHour: 22, broadcastHour: 12, acknowledgeCap: true });
    expect(bodyFor(hourly, { includeBroadcastHour: false })).toEqual({ mode: "hourly", startHour: 8, endHour: 22, acknowledgeCap: false });
  });
  it("sameSchedule detects a no-op save", () => {
    expect(sameSchedule(three, { ...three, hours: [22, 16, 10].sort((a, b) => a - b) })).toBe(true);
    expect(sameSchedule(three, toggleHour(three, 7))).toBe(false);
    expect(sameSchedule(three, { ...three, mode: "hourly" })).toBe(false);
  });
});
