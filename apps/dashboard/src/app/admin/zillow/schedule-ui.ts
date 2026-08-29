/**
 * Pure logic for the schedule editor in AutomationPanel — presets, chip
 * toggling, summaries, request bodies. Kept free of React so it is unit-tested
 * without a DOM (the dashboard has no component-test harness); the .tsx is a
 * thin renderer over these functions.
 */
import {
  describeSchedule,
  nextRunLabelFor,
  runsPerDay,
  monthlyFireEstimate,
  hourLabel,
  type ScheduleShape,
  type SendChannel,
} from "@tenant-ai/shared";

export interface ScheduleDraft {
  mode: "fixed" | "hourly";
  hours: number[];
  startHour: number;
  endHour: number;
  broadcastHour: number;
}

export interface Preset {
  id: string;
  label: string;
  hours: number[];
  recommended?: boolean;
}

/** Fixed-mode presets; 3×/day stays under the monthly broadcast cap (96) in a 31-day month. */
export const PRESETS: Preset[] = [
  { id: "1x", label: "1×/day", hours: [10] },
  { id: "2x", label: "2×/day", hours: [10, 16] },
  { id: "3x", label: "3×/day", hours: [10, 16, 22], recommended: true },
  { id: "4x", label: "4×/day", hours: [9, 12, 16, 20] },
];

export const ALL_HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Hours when this Mac is usually asleep — a run there will be skipped. */
export const SLEEPY_HOURS = new Set([0, 1, 2, 3, 4, 5, 6]);

export function draftFromStatus(s: {
  mode?: "fixed" | "hourly";
  hours?: number[];
  startHour?: number;
  endHour?: number;
  runHours?: number[] | null;
  broadcastHour?: number;
}): ScheduleDraft {
  const hours = s.hours ?? s.runHours ?? [];
  const mode = s.mode ?? (hours.length ? "fixed" : "hourly");
  return {
    mode,
    hours: [...hours].sort((a, b) => a - b),
    startHour: s.startHour ?? 8,
    endHour: s.endHour ?? 22,
    broadcastHour: s.broadcastHour ?? 12,
  };
}

export function applyPreset(d: ScheduleDraft, preset: Preset): ScheduleDraft {
  return { ...d, mode: "fixed", hours: [...preset.hours] };
}

export function toggleHour(d: ScheduleDraft, hour: number): ScheduleDraft {
  const set = new Set(d.hours);
  if (set.has(hour)) set.delete(hour);
  else set.add(hour);
  return { ...d, mode: "fixed", hours: [...set].sort((a, b) => a - b) };
}

/** Which preset (if any) exactly matches the draft's hours. */
export function matchingPreset(d: ScheduleDraft): Preset | null {
  if (d.mode !== "fixed") return null;
  const key = d.hours.join(",");
  return PRESETS.find((p) => p.hours.join(",") === key) ?? null;
}

export function shapeOf(d: ScheduleDraft): ScheduleShape {
  return { mode: d.mode, hours: d.hours, startHour: d.startHour, endHour: d.endHour };
}

export interface DraftSummary {
  label: string;
  runsPerDay: number;
  nextRunLabel: string | null;
  monthlyEstimate: number;
  capWarning: boolean;
  /** Chosen hours when this Mac is usually asleep (fixed mode only). */
  sleepyHours: number[];
  /** Blocking validation problems (Save disabled). */
  problems: string[];
}

export function summaryFor(
  d: ScheduleDraft,
  ctx: { channel: SendChannel; monthlyCap: number; nowHour: number; enabled: boolean },
): DraftSummary {
  const shape = shapeOf(d);
  const perDay = runsPerDay(shape);
  const estimate = monthlyFireEstimate(perDay);
  const problems: string[] = [];
  if (d.mode === "fixed" && !d.hours.length) problems.push("pick at least one hour");
  if (d.mode === "hourly" && d.startHour > d.endHour) problems.push("the window must start before it ends");
  return {
    label: describeSchedule(shape),
    runsPerDay: perDay,
    nextRunLabel: nextRunLabelFor(shape, ctx.nowHour, ctx.enabled),
    monthlyEstimate: estimate,
    capWarning: ctx.channel === "textemall" && estimate > ctx.monthlyCap,
    sleepyHours: d.mode === "fixed" ? d.hours.filter((h) => SLEEPY_HOURS.has(h)) : [],
    problems,
  };
}

/** Request body for POST /api/admin/zillow/schedule. */
export function bodyFor(d: ScheduleDraft, opts: { acknowledgeCap?: boolean; includeBroadcastHour: boolean }) {
  if (d.mode === "fixed") {
    return { mode: "fixed" as const, hours: d.hours, acknowledgeCap: opts.acknowledgeCap === true };
  }
  return {
    mode: "hourly" as const,
    startHour: d.startHour,
    endHour: d.endHour,
    ...(opts.includeBroadcastHour ? { broadcastHour: d.broadcastHour } : {}),
    acknowledgeCap: opts.acknowledgeCap === true,
  };
}

export function sameSchedule(a: ScheduleDraft, b: ScheduleDraft): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "fixed") return a.hours.join(",") === b.hours.join(",");
  return a.startHour === b.startHour && a.endHour === b.endHour && a.broadcastHour === b.broadcastHour;
}

export const fmtHour = hourLabel;
