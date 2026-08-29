import { describe, it, expect, vi, beforeEach } from "vitest";
const cfg: Record<string, string | null> = {};
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return { ...actual, resolveConfig: async (ns: string, k: string) => cfg[`${ns}.${k}`] ?? null };
});
import { resolveRoutingStatus } from "../services/routing-status.js";
beforeEach(() => { for (const k of Object.keys(cfg)) delete cfg[k]; cfg["sms_relay.enabled"] = "true"; });

describe("resolveRoutingStatus (M1 effective path + caveats)", () => {
  it("defaults: both lanes = iMessage relay", async () => {
    const s = await resolveRoutingStatus();
    expect(s.zillow.effective).toBe("Apple iMessage relay");
    expect(s.individual.effective).toBe("Apple iMessage relay");
  });

  it("zillow api + auto on → direct API, no blocker caveats", async () => {
    cfg["zillow.send_channel"] = "textemall"; cfg["zillow.broadcast_method"] = "api"; cfg["zillow.auto_enabled"] = "true";
    const s = await resolveRoutingStatus();
    expect(s.zillow.effective).toBe("Text-Em-All (direct API)");
    expect(s.zillow.caveats).toEqual([]);
  });

  it("zillow FORM + not armed → Zapier with 'not armed' caveat", async () => {
    cfg["zillow.send_channel"] = "textemall"; cfg["zillow.broadcast_method"] = "form"; cfg["zillow.auto_enabled"] = "true";
    const s = await resolveRoutingStatus();
    expect(s.zillow.effective).toContain("Zapier");
    expect(s.zillow.caveats.join(" ")).toContain("NOT armed");
  });

  it("zillow api does NOT show 'not armed' (arming is form-path only, P3)", async () => {
    cfg["zillow.send_channel"] = "textemall"; cfg["zillow.broadcast_method"] = "api";
    cfg["zillow.auto_enabled"] = "true"; cfg["textemall.trigger_armed"] = "false";
    const s = await resolveRoutingStatus();
    expect(s.zillow.caveats.join(" ")).not.toContain("armed");
  });

  it("zillow auto OFF → idle caveat", async () => {
    cfg["zillow.send_channel"] = "textemall"; cfg["zillow.broadcast_method"] = "api"; cfg["zillow.auto_enabled"] = "false";
    const s = await resolveRoutingStatus();
    expect(s.zillow.caveats.join(" ")).toContain("auto-run is OFF");
  });

  it("individual on+armed+api → direct API with iMessage-fallback caveat (calls & texts)", async () => {
    cfg["sms_relay.individual_channel"] = "textemall"; cfg["textemall.individual_trigger_armed"] = "true";
    cfg["sms_relay.broadcast_method"] = "api";
    const s = await resolveRoutingStatus();
    expect(s.individual.effective).toBe("Text-Em-All (direct API)");
    expect(s.individual.caveats.join(" ")).toContain("guaranteed fallback");
  });

  it("individual on but NOT armed → relay + caveat", async () => {
    cfg["sms_relay.individual_channel"] = "textemall"; cfg["textemall.individual_trigger_armed"] = "false";
    const s = await resolveRoutingStatus();
    expect(s.individual.effective).toBe("Apple iMessage relay");
    expect(s.individual.caveats.join(" ")).toContain("NOT armed");
  });

  it("individual whitelist set → RESTRICTED caveat (P4)", async () => {
    cfg["sms_relay.individual_channel"] = "textemall"; cfg["textemall.individual_trigger_armed"] = "true";
    cfg["sms_relay.broadcast_method"] = "api"; cfg["textemall.individual_test_numbers"] = "+13125550001,+13125550002";
    const s = await resolveRoutingStatus();
    expect(s.individual.caveats.join(" ")).toContain("RESTRICTED to 2");
  });

  it("relay disabled → label is Telnyx SMS, not iMessage (S5)", async () => {
    cfg["sms_relay.enabled"] = "false";
    const s = await resolveRoutingStatus();
    expect(s.zillow.effective).toContain("Telnyx");
    expect(s.individual.effective).toContain("Telnyx");
  });

  it("survey_mode/message mismatch flagged on api (S6)", async () => {
    cfg["zillow.send_channel"] = "textemall"; cfg["zillow.broadcast_method"] = "api"; cfg["zillow.auto_enabled"] = "true";
    cfg["sms_relay.survey_mode"] = "google_form"; cfg["textemall.broadcast_message"] = "Apply here: https://example.com/apply";
    const s = await resolveRoutingStatus();
    expect(s.zillow.caveats.join(" ")).toContain("survey mode");
  });
});
