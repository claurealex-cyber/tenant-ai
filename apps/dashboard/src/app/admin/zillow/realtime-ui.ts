/**
 * Pure state logic for the Real-time polling section (interval-editor plan
 * rev.2 M3) — kept out of the React component so the four-state machine and
 * chip selection are unit-testable, exactly like schedule-ui.ts.
 */

export interface RealtimeBlock {
  active: boolean;
  fastPollSec: number; // effective (floored) interval; 0 = off
  configuredSec: number; // raw config value
  floorSec: number;
  transport: "textemall" | "relay";
  method: "api" | "form";
  autoEnabled: boolean;
  windowStartHour: number;
  windowEndHour: number;
  inWindow: boolean;
  lastPollAt: string | null;
  lastOutcome: string | null;
  lastReason: string;
  sentToday: number;
  maxPerDay: number;
  ambiguousCount: number;
}

/**
 * The four UI states (rev.2 P1) — the editor renders in ALL of them:
 *  dormant_auto  → the Automation master toggle is OFF (it governs everything)
 *  dormant_lane  → delivery isn't Text-Em-All · Direct API
 *  off           → lane ready, interval 0
 *  active        → polling live
 * Order matters: fix the master switch first, then the lane, then the interval.
 */
export type RealtimeUiState = "active" | "off" | "dormant_auto" | "dormant_lane";

export function realtimeStateFor(rt: Pick<RealtimeBlock, "autoEnabled" | "transport" | "method" | "configuredSec">): RealtimeUiState {
  if (!rt.autoEnabled) return "dormant_auto";
  if (rt.transport !== "textemall" || rt.method !== "api") return "dormant_lane";
  if (rt.configuredSec <= 0) return "off";
  return "active";
}

export interface PresetChip {
  label: string;
  /** null = the Off chip. */
  minutes: number | null;
  /** Below the floor — rendered disabled with the anti-bot tooltip. */
  locked: boolean;
  selected: boolean;
}

export const PRESET_MINUTES = [1, 2, 3, 5, 10];

/** Chips with selection derived from the EFFECTIVE interval (a sub-floor
 *  config value like 60 s selects the 2-min chip — that's what actually runs). */
export function presetChips(rt: Pick<RealtimeBlock, "configuredSec" | "floorSec">): PresetChip[] {
  const effective = rt.configuredSec > 0 ? Math.max(rt.configuredSec, rt.floorSec) : 0;
  const chips: PresetChip[] = [
    { label: "Off", minutes: null, locked: false, selected: rt.configuredSec <= 0 },
  ];
  for (const m of PRESET_MINUTES) {
    const locked = m * 60 < rt.floorSec;
    chips.push({
      label: `${m} min`,
      minutes: m,
      locked,
      selected: !locked && effective === m * 60,
    });
  }
  return chips;
}

/** True when the effective interval matches no preset (custom value in play). */
export function isCustomInterval(rt: Pick<RealtimeBlock, "configuredSec" | "floorSec">): boolean {
  if (rt.configuredSec <= 0) return false;
  const effective = Math.max(rt.configuredSec, rt.floorSec);
  return !PRESET_MINUTES.some((m) => m * 60 >= rt.floorSec && m * 60 === effective);
}

/** Post-save feedback: name the clamp instead of clamping silently (rev.2). */
export function saveMessage(res: { fastPollSec: number; clamped: boolean; serverRefreshed: boolean }, floorSec: number): string {
  if (res.fastPollSec === 0) return "Real-time polling turned OFF — leads ride the scheduled runs.";
  const mins = Math.round(res.fastPollSec / 60);
  const clampNote = res.clamped ? ` (raised to ${Math.round(floorSec / 60)} min — the minimum)` : "";
  const liveNote = res.serverRefreshed ? "live now" : "applies within a minute";
  return `Polling every ${mins} min${clampNote} — ${liveNote}.`;
}

/** Banner headline per state. */
export function realtimeHeadline(state: RealtimeUiState, rt: Pick<RealtimeBlock, "fastPollSec" | "windowStartHour" | "windowEndHour">): string {
  const window = `${String(rt.windowStartHour).padStart(2, "0")}:00–${String(rt.windowEndHour).padStart(2, "0")}:59`;
  switch (state) {
    case "active":
      return `Real-time: Zillow scrape every ~${Math.max(1, Math.round(rt.fastPollSec / 60))} min, ${window}`;
    case "off":
      return "Real-time polling is OFF — new leads ride the scheduled runs";
    case "dormant_lane":
      return "Real-time polling is DORMANT — Zillow delivery isn't Text-Em-All · Direct API";
    case "dormant_auto":
      return "Real-time polling is DORMANT — Automation is turned off";
  }
}
