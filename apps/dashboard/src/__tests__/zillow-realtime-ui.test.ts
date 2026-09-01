import { describe, it, expect } from "vitest";
import {
  realtimeStateFor,
  presetChips,
  isCustomInterval,
  saveMessage,
  realtimeHeadline,
} from "../app/admin/zillow/realtime-ui";

/** Interval-editor plan rev.2 M3 gate — the four-state machine + chips. */

const base = { autoEnabled: true, transport: "textemall" as const, method: "api" as const, configuredSec: 180, floorSec: 120 };

describe("realtimeStateFor — four states, priority order (P1/P3)", () => {
  it("active when lane api + automation on + interval > 0", () => {
    expect(realtimeStateFor(base)).toBe("active");
  });
  it("off when interval 0 (editor must still render — the rev.1 bug)", () => {
    expect(realtimeStateFor({ ...base, configuredSec: 0 })).toBe("off");
  });
  it("dormant_lane when delivery isn't textemall+api", () => {
    expect(realtimeStateFor({ ...base, method: "form" })).toBe("dormant_lane");
    expect(realtimeStateFor({ ...base, transport: "relay" })).toBe("dormant_lane");
  });
  it("dormant_auto outranks everything (master switch first)", () => {
    expect(realtimeStateFor({ ...base, autoEnabled: false, method: "form", configuredSec: 0 })).toBe("dormant_auto");
  });
  it("lane outranks off (fix the lane before the interval matters)", () => {
    expect(realtimeStateFor({ ...base, method: "form", configuredSec: 0 })).toBe("dormant_lane");
  });
});

describe("presetChips", () => {
  it("locks 1 min below the floor; selects from the EFFECTIVE interval", () => {
    const chips = presetChips({ configuredSec: 180, floorSec: 120 });
    expect(chips.map((c) => c.label)).toEqual(["Off", "1 min", "2 min", "3 min", "5 min", "10 min"]);
    expect(chips.find((c) => c.label === "1 min")).toMatchObject({ locked: true, selected: false });
    expect(chips.find((c) => c.label === "3 min")).toMatchObject({ locked: false, selected: true });
  });
  it("a sub-floor config (60s) selects the 2-min chip — that's what actually runs", () => {
    const chips = presetChips({ configuredSec: 60, floorSec: 120 });
    expect(chips.find((c) => c.label === "2 min")?.selected).toBe(true);
    expect(chips.find((c) => c.label === "Off")?.selected).toBe(false);
  });
  it("Off selected at 0; nothing else", () => {
    const chips = presetChips({ configuredSec: 0, floorSec: 120 });
    expect(chips.filter((c) => c.selected).map((c) => c.label)).toEqual(["Off"]);
  });
  it("custom value selects no minute chip and isCustomInterval flags it", () => {
    const chips = presetChips({ configuredSec: 240, floorSec: 120 });
    expect(chips.filter((c) => c.selected)).toHaveLength(0);
    expect(isCustomInterval({ configuredSec: 240, floorSec: 120 })).toBe(true);
    expect(isCustomInterval({ configuredSec: 180, floorSec: 120 })).toBe(false);
    expect(isCustomInterval({ configuredSec: 0, floorSec: 120 })).toBe(false);
  });
});

describe("saveMessage — clamps are NAMED, never silent (rev.2)", () => {
  it("clamped 1 min → says raised to 2 min", () => {
    expect(saveMessage({ fastPollSec: 120, clamped: true, serverRefreshed: true }, 120)).toBe(
      "Polling every 2 min (raised to 2 min — the minimum) — live now.",
    );
  });
  it("normal save, refresh fallback wording", () => {
    expect(saveMessage({ fastPollSec: 180, clamped: false, serverRefreshed: false }, 120)).toBe(
      "Polling every 3 min — applies within a minute.",
    );
  });
  it("off wording", () => {
    expect(saveMessage({ fastPollSec: 0, clamped: false, serverRefreshed: true }, 120)).toContain("OFF");
  });
});

describe("realtimeHeadline", () => {
  const rt = { fastPollSec: 180, windowStartHour: 8, windowEndHour: 22 };
  it("one headline per state", () => {
    expect(realtimeHeadline("active", rt)).toBe("Real-time: Zillow scrape every ~3 min, 08:00–22:59");
    expect(realtimeHeadline("off", rt)).toContain("OFF");
    expect(realtimeHeadline("dormant_lane", rt)).toContain("Direct API");
    expect(realtimeHeadline("dormant_auto", rt)).toContain("Automation");
  });
});
