import { describe, it, expect, vi, beforeEach } from "vitest";

const cfg: Record<string, string | null> = {};
vi.mock("@tenant-ai/shared", async (o) => {
  const actual = await o<typeof import("@tenant-ai/shared")>();
  return { ...actual, resolveConfig: async (ns: string, k: string) => (ns === "textemall" && k in cfg ? cfg[k] : null) };
});
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { buildTriggerBody, fireTextEmAllTrigger, loadTriggerConfig } from "../services/textemall-trigger.js";

beforeEach(() => { for (const k of Object.keys(cfg)) delete cfg[k]; mockFetch.mockReset(); });

const NOW = new Date(2026, 7, 27, 12, 0, 0); // Aug 27 2026

describe("buildTriggerBody", () => {
  it("DATE field → _year/_month/_day sub-params; ready + count set", async () => {
    const c = await loadTriggerConfig();
    const b = buildTriggerBody(c, { count: 5, now: NOW });
    expect(b.get("entry.599472758")).toBe("Yes");
    expect(b.get("entry.1082952004_year")).toBe("2026");
    expect(b.get("entry.1082952004_month")).toBe("8");
    expect(b.get("entry.1082952004_day")).toBe("27");
    expect(b.get("entry.1156702036")).toBe("5");
    expect(b.get("fvv")).toBe("1");
  });

  it("short-answer date mode → single value", async () => {
    cfg.date_short_answer = "true";
    const c = await loadTriggerConfig();
    const b = buildTriggerBody(c, { count: 1, now: NOW });
    expect(b.get("entry.1082952004")).toBe("2026-08-27");
    expect(b.get("entry.1082952004_year")).toBeNull();
  });

  it("includes the secret token when configured", async () => {
    cfg.entry_token = "entry.999"; cfg.trigger_token = "s3cr3t";
    const c = await loadTriggerConfig();
    const b = buildTriggerBody(c, { count: 1, now: NOW });
    expect(b.get("entry.999")).toBe("s3cr3t");
  });
});

describe("fireTextEmAllTrigger — safety gates", () => {
  it("dry-run by default → NEVER POSTs, returns the body", async () => {
    const r = await fireTextEmAllTrigger({ count: 3, now: NOW });
    expect(r.fired).toBe(false);
    expect((r as any).reason).toBe("dry_run");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("dryRun:false but NOT armed → refuses to POST", async () => {
    const r = await fireTextEmAllTrigger({ count: 3, now: NOW, dryRun: false });
    expect(r.fired).toBe(false);
    expect((r as any).reason).toBe("not_armed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("dryRun:false AND armed → POSTs once to the endpoint", async () => {
    cfg.trigger_armed = "true";
    mockFetch.mockResolvedValue({ status: 200 });
    const r = await fireTextEmAllTrigger({ count: 3, now: NOW, dryRun: false });
    expect(r.fired).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).toContain("/formResponse");
  });
});
