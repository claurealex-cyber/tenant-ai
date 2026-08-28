import { describe, it, expect, vi, beforeEach } from "vitest";
process.env.PII_ENCRYPTION_KEY = "a".repeat(64);

const cfg: Record<string, string | null> = {};
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return { ...actual, resolveConfig: async (ns: string, k: string) => cfg[`${ns}.${k}`] ?? null };
});

import { buildIndividualBody, loadIndividualTriggerConfig, fireIndividualTrigger } from "../services/individual-trigger.js";
import { buildSetGroupToNumberGoal, irisSetGroupToNumber } from "../services/individual-iris.js";

beforeEach(() => { for (const k of Object.keys(cfg)) delete cfg[k]; vi.restoreAllMocks(); });

describe("buildIndividualBody", () => {
  it("sets ready=Yes, the phone, and submit params", async () => {
    const b = buildIndividualBody(await loadIndividualTriggerConfig(), { phone: "+13125550123" });
    expect(b.get("entry.2069978510")).toBe("Yes");
    expect(b.get("entry.766759466")).toBe("+13125550123");
    expect(b.get("submit")).toBe("Submit");
  });
});

describe("fireIndividualTrigger safety", () => {
  it("dry-run by default → no network", async () => {
    const r = await fireIndividualTrigger({ phone: "+13125550123" });
    expect(r).toMatchObject({ fired: false, reason: "dry_run" });
  });
  it("dryRun:false but NOT armed → not_armed, no network", async () => {
    const r = await fireIndividualTrigger({ phone: "+13125550123", dryRun: false });
    expect(r).toMatchObject({ fired: false, reason: "not_armed" });
  });
  it("empty phone → no_phone", async () => {
    const r = await fireIndividualTrigger({ phone: "  " });
    expect(r).toMatchObject({ fired: false, reason: "no_phone" });
  });
  it("armed + dryRun:false → POSTs (mocked fetch)", async () => {
    cfg["textemall.individual_trigger_armed"] = "true";
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const r = await fireIndividualTrigger({ phone: "+13125550123", dryRun: false });
    expect(r).toEqual({ fired: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe("buildSetGroupToNumberGoal", () => {
  it("uses Add Contact (no file picker), targets the group + number, count==1", () => {
    const g = buildSetGroupToNumberGoal({ group: "2. leads 08-28-2026", phone: "+13125550123" });
    expect(g).toContain('"2. leads 08-28-2026"');
    expect(g).toContain("+13125550123");
    expect(g).toContain("Add Contact");
    expect(g).not.toContain("Command-Shift-G"); // NOT the CSV import path
    expect(g).toContain("equals 1");
  });
});

describe("irisSetGroupToNumber (injected run)", () => {
  it("count==1 → ok; needs-login; failure never throws", async () => {
    expect((await irisSetGroupToNumber({ group: "g", phone: "+1" }, { run: async () => "RESULT: count=1" })).status).toBe("ok");
    expect((await irisSetGroupToNumber({ group: "g", phone: "+1" }, { run: async () => "RESULT: needs-login" })).status).toBe("needs_login");
    expect((await irisSetGroupToNumber({ group: "g", phone: "+1" }, { run: async () => { throw new Error("x"); } })).status).toBe("failed");
    expect((await irisSetGroupToNumber({ group: "g", phone: "+1" }, { run: async () => "RESULT: count=3" })).status).toBe("failed");
  });
});
