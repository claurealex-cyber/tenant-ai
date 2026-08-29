import { describe, it, expect, vi, beforeEach } from "vitest";
process.env.PII_ENCRYPTION_KEY = "a".repeat(64);

const cfg: Record<string, string> = {};
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return { ...actual, resolveConfig: async (ns: string, k: string) => cfg[`${ns}.${k}`] ?? null };
});

import { buildBroadcastJs, sendBroadcastViaApi } from "../services/textemall-broadcast-api.js";

beforeEach(() => { for (const k of Object.keys(cfg)) delete cfg[k]; });

describe("buildBroadcastJs", () => {
  it("normalizes to unique 10-digit + embeds message/number/caller/name", () => {
    const js = buildBroadcastJs(["+13125550100", "3125550100", "+17084158984"], "hi <link>", 84582, "(773) 376-0486", "Ghem");
    expect(js).toContain('"3125550100"');
    expect(js).toContain('"7084158984"');
    // deduped: 3125550100 appears once in the phones array literal
    expect((js.match(/3125550100/g) || []).length).toBe(1);
    expect(js).toContain("84582");
    expect(js).toContain("(773) 376-0486");
    expect(js).toContain("/proxy/draft-broadcasts");
    expect(js).toContain("/proxy/broadcasts");
  });
});

describe("sendBroadcastViaApi — sentPhones reflects ACTUAL adds", () => {
  it("ok → returns E.164 sentPhones for exactly who was added", async () => {
    const run = async () => JSON.stringify({ r: "ok", broadcastId: 999, added: ["3125550100", "7084158984"] });
    const r = await sendBroadcastViaApi({ phones: ["+13125550100", "+17084158984"], message: "x" }, { run });
    expect(r).toEqual({ status: "ok", broadcastId: 999, recipients: 2, sentPhones: ["+13125550100", "+17084158984"] });
  });
  it("partial add → sentPhones is ONLY the added (the rest can be retried)", async () => {
    const run = async () => JSON.stringify({ r: "ok", broadcastId: 1, added: ["7084158984"] });
    const r = await sendBroadcastViaApi({ phones: ["+13125550100", "+17084158984"], message: "x" }, { run });
    expect(r.status).toBe("ok");
    expect((r as any).sentPhones).toEqual(["+17084158984"]);
  });
  it("needs_login / failed pass through; never throws", async () => {
    expect((await sendBroadcastViaApi({ phones: ["+1"], message: "x" }, { run: async () => JSON.stringify({ r: "needs_login" }) })).status).toBe("needs_login");
    expect((await sendBroadcastViaApi({ phones: ["+1"], message: "x" }, { run: async () => JSON.stringify({ r: "failed", d: "boom" }) })).status).toBe("failed");
    expect((await sendBroadcastViaApi({ phones: ["+1"], message: "x" }, { run: async () => { throw new Error("x"); } })).status).toBe("failed");
  });
});
