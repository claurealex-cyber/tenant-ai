import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const mockRelay = vi.fn();
vi.mock("../services/relay-guards.js", async (orig) => {
  const actual = await orig<typeof import("../services/relay-guards.js")>();
  return { ...actual, relaySendWithGuards: (...a: any[]) => mockRelay(...a) };
});
const cfg: Record<string, string | null> = { enabled: "true", survey_mode: "google_form", google_form_url: "https://docs.google.com/forms/d/e/X/viewform", survey_base_url: "https://static.example.test" };
vi.mock("@tenant-ai/shared", async (orig) => {
  const actual = await orig<typeof import("@tenant-ai/shared")>();
  return { ...actual, resolveConfig: async (ns: string, k: string, d?: string) => (ns === "sms_relay" && k in cfg ? cfg[k] : actual.resolveConfig(ns, k, d)) };
});

import { textLinkToCaller } from "../services/caller-link.js";

const prisma = new PrismaClient();
const P = `test_caller_${Date.now()}`;
let userId: string, propertyId: string, seq = 0;
const phone = () => `+1414555${String(seq++).padStart(4, "0")}`;
let TWILIO = "";
const prop = () => ({ id: propertyId, userId, name: `${P} Prop`, twilioPhone: TWILIO });

beforeAll(async () => {
  await prisma.$connect();
  const u = await prisma.user.create({ data: { email: `${P}@t.com`, name: "C", passwordHash: await bcrypt.hash("x", 4), role: "client", onboarded: true } });
  userId = u.id;
  TWILIO = `+1312999${Date.now().toString().slice(-4)}`;
  const pr = await prisma.property.create({ data: { name: `${P} Prop`, address: "1 Call St, Chicago IL", userId, isActive: true, twilioPhone: TWILIO } });
  propertyId = pr.id;
});
afterAll(async () => {
  await prisma.smsOptOut.deleteMany({ where: { propertyId } });
  await prisma.tenant.deleteMany({ where: { userId } });
  await prisma.surveyInvite.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
beforeEach(() => { mockRelay.mockReset(); mockRelay.mockResolvedValue({ status: "sent", id: "r1" }); cfg.enabled = "true"; cfg.survey_mode = "google_form"; });

describe("textLinkToCaller", () => {
  it("texts the toggle's link (Google Form) to a caller, replyKind link, status sent", async () => {
    const res = await textLinkToCaller({ property: prop(), callerPhone: phone(), source: "voice_tool" });
    expect(res.status).toBe("sent");
    const sentText = String(mockRelay.mock.calls[0][1]);
    expect(sentText).toContain("docs.google.com/forms");
    expect(mockRelay.mock.calls[0][2]).toMatchObject({ kind: "caller", inviteId: expect.any(String) });
  });
  it("refuses an anonymous / non-E.164 caller", async () => {
    const res = await textLinkToCaller({ property: prop(), callerPhone: "anonymous", source: "call_end" });
    expect(res).toEqual({ status: "cannot_text", reason: expect.stringContaining("no textable phone") });
    expect(mockRelay).not.toHaveBeenCalled();
  });
  it("refuses a known tenant", async () => {
    const p = phone();
    await prisma.tenant.create({ data: { userId, phone: p, firstName: "T", lastName: "T", email: `${P}_t${seq}@t.com`, passwordHash: "x" } as any });
    const res = await textLinkToCaller({ property: prop(), callerPhone: p, source: "voice_tool" });
    expect(res.status).toBe("cannot_text");
    expect(res).toMatchObject({ reason: expect.stringContaining("tenant") });
  });
  it("refuses an opted-out caller", async () => {
    const p = phone();
    await prisma.smsOptOut.create({ data: { phone: p, propertyId } as any });
    const res = await textLinkToCaller({ property: prop(), callerPhone: p, source: "call_end" });
    expect(res.status).toBe("cannot_text");
  });
  it("maps a relay cooldown to already_sent (idempotent)", async () => {
    mockRelay.mockResolvedValue({ status: "skipped", reason: "cooldown", id: "r2" });
    const res = await textLinkToCaller({ property: prop(), callerPhone: phone(), source: "call_end" });
    expect(res.status).toBe("already_sent");
  });
});
