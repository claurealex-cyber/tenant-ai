import { describe, it, expect } from "vitest";
import {
  normalizeRunHours, describeSchedule, nextRunLabelFor, runsPerDay, monthlyFireEstimate,
  scheduleSummary, DEFAULT_MONTHLY_FIRE_CAP, clampWindowHour,
} from "../zillow-schedule.js";

describe("normalizeRunHours", () => {
  it("accepts arrays and CSV, dedupes and sorts", () => {
    expect(normalizeRunHours([22, 10, "16", 10])).toEqual({ hours: [10, 16, 22], errors: [] });
    expect(normalizeRunHours("22, 10,16")).toEqual({ hours: [10, 16, 22], errors: [] });
  });
  it("reports invalid entries instead of dropping them silently", () => {
    const r = normalizeRunHours([10, 24, -1, "x", 1.5]);
    expect(r.hours).toEqual([10]);
    expect(r.errors).toHaveLength(4);
  });
  it("empty → 'pick at least one hour'; non-list → error", () => {
    expect(normalizeRunHours([]).errors).toEqual(["pick at least one hour"]);
    expect(normalizeRunHours("").errors).toEqual(["pick at least one hour"]);
    expect(normalizeRunHours(42).errors[0]).toMatch(/list of hours/);
  });
  it("clampWindowHour", () => {
    expect(clampWindowHour("25", 8)).toBe(23); expect(clampWindowHour(-3, 8)).toBe(0); expect(clampWindowHour("abc", 8)).toBe(8);
  });
});

describe("labels and counts", () => {
  const fixed = { mode: "fixed" as const, hours: [10, 16, 22], startHour: 8, endHour: 22 };
  const hourly = { mode: "hourly" as const, hours: [], startHour: 8, endHour: 22 };
  it("describeSchedule", () => {
    expect(describeSchedule(fixed)).toBe("3×/day at 10:00, 16:00, 22:00");
    expect(describeSchedule(hourly)).toBe("hourly from 08:00 to 22:00");
    expect(describeSchedule({ ...fixed, hours: [] })).toBe("no run hours selected");
  });
  it("runsPerDay + monthly estimate", () => {
    expect(runsPerDay(fixed)).toBe(3); expect(runsPerDay(hourly)).toBe(15);
    expect(monthlyFireEstimate(3)).toBe(93); expect(monthlyFireEstimate(4)).toBe(124);
  });
  it("nextRunLabelFor matches the engine's rules (fixed: next strictly after, wrap; hourly: window)", () => {
    expect(nextRunLabelFor(fixed, 9)).toBe("10:00");
    expect(nextRunLabelFor(fixed, 10)).toBe("16:00");
    expect(nextRunLabelFor(fixed, 22)).toBe("10:00 (tomorrow)");
    expect(nextRunLabelFor(hourly, 7)).toBe("08:00");
    expect(nextRunLabelFor(hourly, 12)).toBe("13:00");
    expect(nextRunLabelFor(hourly, 22)).toBe("08:00 (tomorrow)");
    expect(nextRunLabelFor(fixed, 9, false)).toBeNull();
  });
});

describe("scheduleSummary", () => {
  const base = { enabled: true, startHour: 8, endHour: 22, channel: "textemall" as const, monthlyCap: DEFAULT_MONTHLY_FIRE_CAP, nowHour: 11 };
  it("3×/day on Text-Em-All is inside the free tier", () => {
    const s = scheduleSummary({ ...base, runHours: [10, 16, 22] });
    expect(s).toMatchObject({ mode: "fixed", runsPerDay: 3, monthlyEstimate: 93, capWarning: false, label: "3×/day at 10:00, 16:00, 22:00", nextRunLabel: "16:00", timezone: "America/Chicago" });
  });
  it("4×/day on Text-Em-All warns; the same on the relay channel does not", () => {
    expect(scheduleSummary({ ...base, runHours: [9, 12, 16, 20] }).capWarning).toBe(true);
    expect(scheduleSummary({ ...base, runHours: [9, 12, 16, 20], channel: "relay" }).capWarning).toBe(false);
  });
  it("hourly mode", () => {
    const s = scheduleSummary({ ...base, runHours: null });
    expect(s).toMatchObject({ mode: "hourly", runsPerDay: 15, monthlyEstimate: 465, capWarning: true, label: "hourly from 08:00 to 22:00" });
  });
  it("unsorted run hours are sorted", () => {
    expect(scheduleSummary({ ...base, runHours: [22, 10] }).hours).toEqual([10, 22]);
  });
});
