/**
 * Zillow automation schedule — ONE source of truth for validation, labels and
 * free-tier math, shared by the engine (`apps/server` zillow-auto.ts), the
 * dashboard schedule route and the Automation panel, so they can never
 * disagree. Hours are server-local (America/Chicago on the Mac mini), :00 only
 * (the engine ticks hourly).
 */

/** Monthly broadcast cap (textemall.monthly_fire_cap default). Originally the Zapier free tier
 * (100 tasks/month, 1 broadcast = 1 task); with broadcast_method=api it still caps Text-Em-All
 * broadcasts per month — the engine checks it before EITHER send path. */
export const DEFAULT_MONTHLY_FIRE_CAP = 96;
export const SCHEDULE_TIMEZONE = "America/Chicago";

export type ScheduleMode = "fixed" | "hourly";
export type SendChannel = "relay" | "textemall";

export interface NormalizedHours {
  /** Sorted, de-duplicated integer hours 0–23. Empty when nothing valid. */
  hours: number[];
  errors: string[];
}

/**
 * Accepts an array (numbers or numeric strings) or a CSV string. Invalid
 * entries are reported, not silently dropped (unlike the engine's lenient
 * parseRunHours, which must keep running on a bad config).
 */
export function normalizeRunHours(input: unknown): NormalizedHours {
  const errors: string[] = [];
  let raw: unknown[];
  if (Array.isArray(input)) raw = input;
  else if (typeof input === "string") raw = input.split(",").map((s) => s.trim()).filter((s) => s.length);
  else return { hours: [], errors: ["hours must be a list of hours (0–23)"] };

  const set = new Set<number>();
  for (const v of raw) {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,2}$/.test(v.trim()) ? parseInt(v.trim(), 10) : NaN;
    if (!Number.isInteger(n) || n < 0 || n > 23) {
      errors.push(`"${String(v)}" is not an hour between 0 and 23`);
      continue;
    }
    set.add(n);
  }
  const hours = [...set].sort((a, b) => a - b);
  if (!hours.length && !errors.length) errors.push("pick at least one hour");
  return { hours, errors };
}

export function clampWindowHour(v: unknown, def: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isInteger(n) ? Math.min(23, Math.max(0, n)) : def;
}

export const hourLabel = (h: number): string => `${String(h).padStart(2, "0")}:00`;

export interface ScheduleShape {
  mode: ScheduleMode;
  /** fixed mode only */
  hours: number[];
  /** hourly mode only (inclusive window) */
  startHour: number;
  endHour: number;
}

export function runsPerDay(s: ScheduleShape): number {
  return s.mode === "fixed" ? s.hours.length : Math.max(0, s.endHour - s.startHour + 1);
}

/** Conservative: a 31-day month at full utilisation (empty batches fire nothing). */
export function monthlyFireEstimate(perDay: number, daysInMonth = 31): number {
  return perDay * daysInMonth;
}

export function describeSchedule(s: ScheduleShape): string {
  if (s.mode === "fixed") {
    const n = s.hours.length;
    return n ? `${n}×/day at ${s.hours.map(hourLabel).join(", ")}` : "no run hours selected";
  }
  return `hourly from ${hourLabel(s.startHour)} to ${hourLabel(s.endHour)}`;
}

/** Next run "HH:00" or "HH:00 (tomorrow)"; null when disabled. Same rule the engine used. */
export function nextRunLabelFor(s: ScheduleShape, nowHour: number, enabled = true): string | null {
  if (!enabled) return null;
  if (s.mode === "fixed") {
    if (!s.hours.length) return null;
    const next = s.hours.find((h) => h > nowHour);
    return next !== undefined ? hourLabel(next) : `${hourLabel(s.hours[0])} (tomorrow)`;
  }
  if (nowHour < s.startHour) return hourLabel(s.startHour);
  if (nowHour >= s.endHour) return `${hourLabel(s.startHour)} (tomorrow)`;
  return hourLabel(nowHour + 1);
}

export interface ScheduleSummaryInput {
  enabled: boolean;
  /** null → hourly window mode */
  runHours: number[] | null;
  startHour: number;
  endHour: number;
  channel: SendChannel;
  /** effective monthly fire cap (Text-Em-All only) */
  monthlyCap: number;
  nowHour: number;
}
export interface ScheduleSummary extends ScheduleShape {
  enabled: boolean;
  runsPerDay: number;
  label: string;
  nextRunLabel: string | null;
  channel: SendChannel;
  monthlyEstimate: number;
  monthlyCap: number;
  /** Text-Em-All channel and the 31-day estimate exceeds the monthly broadcast cap → broadcasts would stop mid-month. */
  capWarning: boolean;
  timezone: string;
}

export function scheduleSummary(i: ScheduleSummaryInput): ScheduleSummary {
  const shape: ScheduleShape = i.runHours
    ? { mode: "fixed", hours: [...i.runHours].sort((a, b) => a - b), startHour: i.startHour, endHour: i.endHour }
    : { mode: "hourly", hours: [], startHour: i.startHour, endHour: i.endHour };
  const perDay = runsPerDay(shape);
  const estimate = monthlyFireEstimate(perDay);
  return {
    ...shape,
    enabled: i.enabled,
    runsPerDay: perDay,
    label: describeSchedule(shape),
    nextRunLabel: nextRunLabelFor(shape, i.nowHour, i.enabled),
    channel: i.channel,
    monthlyEstimate: estimate,
    monthlyCap: i.monthlyCap,
    capWarning: i.channel === "textemall" && estimate > i.monthlyCap,
    timezone: SCHEDULE_TIMEZONE,
  };
}
