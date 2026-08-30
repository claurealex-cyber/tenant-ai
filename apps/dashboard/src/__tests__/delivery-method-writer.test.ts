import { describe, it, expect, vi, beforeEach } from "vitest";

const upserts: { key: string; value: string }[] = [];
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemConfig: { upsert: (arg: any) => { const key = arg.where.key; const value = arg.create.value; const p = Promise.resolve({ key, value }); (p as any)._rec = { key, value }; upserts.push({ key, value }); return p; } },
    $transaction: (arr: any[]) => Promise.all(arr),
    auditLog: { create: () => Promise.resolve({}) },
  },
}));
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return { ...actual, encrypt: (v: string) => v, clearConfigCache: () => {} };
});
const mockProxy = vi.fn(async (..._a: any[]) => ({ ok: true }));
vi.mock("@/lib/zillow-admin", () => ({ proxyToServer: (...a: unknown[]) => mockProxy(...a) }));

import { setLaneDeliveryMethod } from "../lib/delivery-method";

function keys() { return Object.fromEntries(upserts.map((u) => [u.key, u.value])); }
beforeEach(() => { upserts.length = 0; mockProxy.mockClear(); });

describe("setLaneDeliveryMethod — exact key mapping (M9 + arming fix)", () => {
  it("zillow api → textemall + api, NO arming (api path returns before the arm gate)", async () => {
    await setLaneDeliveryMethod("zillow", "api", "u");
    const k = keys();
    expect(k["zillow.send_channel"]).toBe("textemall");
    expect(k["zillow.broadcast_method"]).toBe("api");
    expect(k["textemall.trigger_armed"]).toBeUndefined();
  });

  it("zillow zapier → textemall + form + ARM trigger (else it uploads but never sends)", async () => {
    await setLaneDeliveryMethod("zillow", "zapier", "u");
    const k = keys();
    expect(k["zillow.send_channel"]).toBe("textemall");
    expect(k["zillow.broadcast_method"]).toBe("form");
    expect(k["textemall.trigger_armed"]).toBe("true");
  });

  it("zillow imessage → send_channel relay only", async () => {
    await setLaneDeliveryMethod("zillow", "imessage", "u");
    const k = keys();
    expect(k["zillow.send_channel"]).toBe("relay");
    expect(k["zillow.broadcast_method"]).toBeUndefined();
  });

  it("individual api → textemall + armed + api", async () => {
    await setLaneDeliveryMethod("individual", "api", "u");
    const k = keys();
    expect(k["sms_relay.individual_channel"]).toBe("textemall");
    expect(k["textemall.individual_trigger_armed"]).toBe("true");
    expect(k["sms_relay.broadcast_method"]).toBe("api");
  });

  it("individual zapier → textemall + armed + form", async () => {
    await setLaneDeliveryMethod("individual", "zapier", "u");
    const k = keys();
    expect(k["sms_relay.individual_channel"]).toBe("textemall");
    expect(k["textemall.individual_trigger_armed"]).toBe("true");
    expect(k["sms_relay.broadcast_method"]).toBe("form");
  });

  it("individual imessage → channel relay only (does NOT clear the whitelist, P4)", async () => {
    await setLaneDeliveryMethod("individual", "imessage", "u");
    const k = keys();
    expect(k["sms_relay.individual_channel"]).toBe("relay");
    expect(k["textemall.individual_test_numbers"]).toBeUndefined();
  });

  it("lanes are independent: zillow write never touches individual keys", async () => {
    await setLaneDeliveryMethod("zillow", "api", "u");
    for (const u of upserts) expect(u.key.startsWith("sms_relay.individual") || u.key === "sms_relay.broadcast_method").toBe(false);
  });

  it("every write hops to the server config refresh", async () => {
    await setLaneDeliveryMethod("individual", "api", "u");
    expect(mockProxy).toHaveBeenCalledWith("/internal/config/refresh", expect.objectContaining({ method: "POST" }));
  });
});
