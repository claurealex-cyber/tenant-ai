import { describe, it, expect, vi, beforeEach } from "vitest";

const cfg: Record<string, string | null> = {};
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return { ...actual, resolveConfig: async (ns: string, k: string) => cfg[`${ns}.${k}`] ?? null };
});
import { resolveBroadcastMethod, resolveZillowDelivery } from "../services/delivery-method.js";

beforeEach(() => { for (const k of Object.keys(cfg)) delete cfg[k]; });

describe("resolveBroadcastMethod (M0 per-lane + legacy fallback)", () => {
  it("defaults to form when nothing is set", async () => {
    expect(await resolveBroadcastMethod("zillow")).toBe("form");
    expect(await resolveBroadcastMethod("individual")).toBe("form");
  });
  it("lane key wins: zillow.broadcast_method=api", async () => {
    cfg["zillow.broadcast_method"] = "api";
    expect(await resolveBroadcastMethod("zillow")).toBe("api");
    expect(await resolveBroadcastMethod("individual")).toBe("form"); // independent lane
  });
  it("individual lane reads sms_relay.broadcast_method independently", async () => {
    cfg["sms_relay.broadcast_method"] = "api";
    expect(await resolveBroadcastMethod("individual")).toBe("api");
    expect(await resolveBroadcastMethod("zillow")).toBe("form");
  });
  it("falls back to legacy global when lane key absent", async () => {
    cfg["textemall.broadcast_method"] = "api";
    expect(await resolveBroadcastMethod("zillow")).toBe("api");
    expect(await resolveBroadcastMethod("individual")).toBe("api");
  });
  it("lane override beats legacy: lane=form, legacy=api → form", async () => {
    cfg["zillow.broadcast_method"] = "form";
    cfg["textemall.broadcast_method"] = "api";
    expect(await resolveBroadcastMethod("zillow")).toBe("form");
  });
  it("lanes can diverge: zillow=api, individual falls to legacy=form", async () => {
    cfg["zillow.broadcast_method"] = "api";
    cfg["textemall.broadcast_method"] = "form";
    expect(await resolveBroadcastMethod("zillow")).toBe("api");
    expect(await resolveBroadcastMethod("individual")).toBe("form");
  });
});

describe("resolveZillowDelivery", () => {
  it("relay transport when send_channel unset", async () => {
    expect(await resolveZillowDelivery()).toEqual({ transport: "relay", method: "form" });
  });
  it("textemall + api", async () => {
    cfg["zillow.send_channel"] = "textemall"; cfg["zillow.broadcast_method"] = "api";
    expect(await resolveZillowDelivery()).toEqual({ transport: "textemall", method: "api" });
  });
});
