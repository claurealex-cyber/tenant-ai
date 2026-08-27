import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const TEST_PREFIX = `test_zsend_${Date.now()}`;

// Transport mock: relay guard logic runs for real; only the AppleScript send
// is stubbed. Config mock: relay forced ON with generous caps so cap state in
// the shared dev DB can't flake these tests.
const mockSend = vi.fn(async () => undefined);
vi.mock("../services/messages-relay.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/messages-relay.js")>();
  return {
    ...original,
    sendViaMessagesRelay: (...args: unknown[]) => (mockSend as (...a: unknown[]) => Promise<void>)(...args),
    notifyOnMac: vi.fn(),
  };
});
// Mutable survey-link mode for the Google-Form case below.
const surveyCfg: { mode: string | null; url: string | null } = { mode: null, url: null };
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tenant-ai/shared")>();
  return {
    ...original,
    resolveConfig: async (ns: string, key: string) => {
      if (ns === "sms_relay") {
        if (key === "enabled") return "true";
        if (key === "hourly_cap") return "10000";
        if (key === "daily_cap") return "10000";
        if (key === "cooldown_minutes") return "60";
        if (key === "survey_base_url") return "https://test-tunnel.example.com";
        if (key === "survey_mode") return surveyCfg.mode;
        if (key === "google_form_url") return surveyCfg.url;
      }
      return original.resolveConfig(ns, key);
    },
  };
});

import { sendSurveyToLead, sendSurveyBatch, zillowLeadCopy, BATCH_MAX_AGE_DAYS } from "../services/zillow-send.js";

const prisma = new PrismaClient();

let userId: string;
let propertyId: string;
let runId: string;
let leadSeq = 0;

function testPhone(): string {
  // unique per test run AND per lead — avoids relay cooldown collisions
  return `+1847${String(Date.now() % 1000000).padStart(6, "0").slice(0, 3)}${String(leadSeq++).padStart(4, "0")}`;
}

async function makeLead(overrides: Record<string, unknown> = {}) {
  return prisma.zillowLead.create({
    data: {
      name: `${TEST_PREFIX} lead`,
      nameKey: `${TEST_PREFIX} lead`,
      phone: testPhone(),
      propertyText: "7302 Sendberry Ln",
      propertyId,
      firstContactAt: new Date(),
      status: "new",
      importRunId: runId,
      ...overrides,
    },
  });
}

beforeAll(async () => {
  await prisma.$connect();
  const user = await prisma.user.create({
    data: {
      email: `${TEST_PREFIX}@test.com`,
      name: "Zillow Send Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;
  const property = await prisma.property.create({
    data: {
      name: `${TEST_PREFIX}_prop`,
      address: "7302 Sendberry Ln, Zzville IL 60999",
      userId,
      isActive: true,
      twilioPhone: `+1312888${Date.now().toString().slice(-4)}`,
      smsIntakeEnabled: true,
    },
  });
  propertyId = property.id;
  const run = await prisma.zillowImportRun.create({ data: { status: "done" } });
  runId = run.id;
});

afterAll(async () => {
  const leads = await prisma.zillowLead.findMany({ where: { importRunId: runId } });
  const phones = leads.map((l) => l.phone).filter((p): p is string => !!p);
  await prisma.outboundRelayMessage.deleteMany({ where: { to: { in: phones } } });
  await prisma.surveyInvite.deleteMany({ where: { propertyId } });
  await prisma.zillowLead.deleteMany({ where: { importRunId: runId } });
  await prisma.zillowImportRun.deleteMany({ where: { id: runId } });
  await prisma.smsOptOut.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  mockSend.mockClear();
  mockSend.mockResolvedValue(undefined);
});

describe("zillowLeadCopy", () => {
  it("says Zillow (never 'you texted'), includes link and STOP at the Telnyx number", () => {
    const text = zillowLeadCopy("Ghem LLC 1", "https://x.example/survey/tok", "+17089070695");
    expect(text).toContain("(you inquired on Zillow)");
    expect(text).not.toContain("you texted");
    expect(text).toContain("https://x.example/survey/tok");
    expect(text).toContain("To opt out, text STOP to (708) 907-0695.");
  });
});

describe("sendSurveyToLead", () => {
  it("honors survey_mode=google_form: texts the form link, records a google_form invite", async () => {
    const FORM = "https://docs.google.com/forms/d/e/1FAIpQLSf4jZ7jYk14CDnRZjZCZPhV6NEhD53sDqfdZp7omfBUe3Vbug/viewform";
    surveyCfg.mode = "google_form";
    surveyCfg.url = FORM;
    try {
      const lead = await makeLead();
      const outcome = await sendSurveyToLead(lead.id);
      expect(outcome.result).toBe("sent");
      const sentText = JSON.stringify(mockSend.mock.calls.at(-1));
      expect(sentText).toContain(FORM);
      expect(sentText).not.toContain("/survey/");
      const updated = await prisma.zillowLead.findUnique({ where: { id: lead.id } });
      const invite = await prisma.surveyInvite.findUnique({ where: { id: updated!.inviteId! } });
      expect(invite!.channel).toBe("google_form");
    } finally {
      surveyCfg.mode = null;
      surveyCfg.url = null;
    }
  });

  it("sends, mints an invite, flips the lead to invited", async () => {
    const lead = await makeLead();
    const outcome = await sendSurveyToLead(lead.id);
    expect(outcome.result).toBe("sent");

    const updated = await prisma.zillowLead.findUnique({ where: { id: lead.id } });
    expect(updated!.status).toBe("invited");
    expect(updated!.inviteId).toBeTruthy();

    const invite = await prisma.surveyInvite.findUnique({ where: { id: updated!.inviteId! } });
    expect(invite).toMatchObject({ propertyId, phone: lead.phone });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [to, text] = mockSend.mock.calls[0] as unknown as [string, string];
    expect(to).toBe(lead.phone);
    expect(text).toContain(`/survey/${invite!.token}`);
    expect(text).toContain("(you inquired on Zillow)");

    // ledger row carries the invite id
    const row = await prisma.outboundRelayMessage.findFirst({ where: { to: lead.phone! } });
    expect(row).toMatchObject({ kind: "link", status: "sent", inviteId: invite!.id });
  });

  it("skips every non-sendable state without touching the transport", async () => {
    const invited = await makeLead({ status: "invited" });
    const noPhone = await makeLead({ phone: null, status: "no_phone" });
    const noProp = await makeLead({ propertyId: null });

    expect((await sendSurveyToLead("nonexistent-id")).result).toBe("skipped");
    expect((await sendSurveyToLead(invited.id)).detail).toContain("invited");
    expect((await sendSurveyToLead(noPhone.id)).detail).toContain("no_phone");
    expect((await sendSurveyToLead(noProp.id)).detail).toBe("no matched property");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("flips to opted_out when the guard reports an opt-out", async () => {
    const lead = await makeLead();
    await prisma.smsOptOut.create({ data: { phone: lead.phone!, propertyId } });
    const outcome = await sendSurveyToLead(lead.id);
    expect(outcome).toMatchObject({ result: "skipped", detail: "opted out" });
    const updated = await prisma.zillowLead.findUnique({ where: { id: lead.id } });
    expect(updated!.status).toBe("opted_out");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("keeps the lead sendable with the error recorded when the transport fails", async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error("osascript blew up"), { isTcc: false }));
    const lead = await makeLead();
    const outcome = await sendSurveyToLead(lead.id);
    expect(outcome.result).toBe("failed");
    const updated = await prisma.zillowLead.findUnique({ where: { id: lead.id } });
    expect(updated!.status).toBe("new");
    expect(updated!.sendError).toContain("osascript blew up");
  });

  it("cooldown skip leaves the lead new with the reason visible", async () => {
    const lead = await makeLead();
    // A sent link to this phone inside the cooldown window
    await prisma.outboundRelayMessage.create({
      data: { to: lead.phone!, body: "x", kind: "link", status: "sent", sentAt: new Date() },
    });
    const outcome = await sendSurveyToLead(lead.id);
    expect(outcome).toMatchObject({ result: "skipped", detail: "cooldown" });
    const updated = await prisma.zillowLead.findUnique({ where: { id: lead.id } });
    expect(updated!.status).toBe("new");
    expect(updated!.sendError).toBe("cooldown");
  });
});

describe("STOP reflection (M4)", () => {
  it("an inbound STOP flips the matching lead to opted_out", async () => {
    const { handleIncomingSms } = await import("../handlers/sms-handler.js");
    const lead = await makeLead({ status: "invited" });
    const property = await prisma.property.findUnique({ where: { id: propertyId } });

    const result = await handleIncomingSms(lead.phone!, property!.twilioPhone!, "STOP");
    expect(result.replyKind).toBe("confirmation");

    const updated = await prisma.zillowLead.findUnique({ where: { id: lead.id } });
    expect(updated!.status).toBe("opted_out");
  });
});

describe("sendSurveyBatch", () => {
  it("targets only new+phone+property leads inside the age window", async () => {
    const recent = await makeLead();
    const old = await makeLead({ firstContactAt: new Date(Date.now() - (BATCH_MAX_AGE_DAYS + 10) * 86_400_000) });
    const undated = await makeLead({ firstContactAt: null });

    const result = await sendSurveyBatch({ propertyId });
    const ids = result.outcomes.map((o) => o.leadId);
    expect(ids).toContain(recent.id);
    expect(ids).toContain(undated.id);
    expect(ids).not.toContain(old.id);

    const oldRow = await prisma.zillowLead.findUnique({ where: { id: old.id } });
    expect(oldRow!.status).toBe("new");

    // includeOlder widens the batch to the old lead too
    const wider = await sendSurveyBatch({ includeOlder: true, propertyId });
    expect(wider.outcomes.map((o) => o.leadId)).toContain(old.id);
  });

  it("sinceDate (automation baseline) excludes leads discovered before it", async () => {
    const baseline = new Date(Date.now() - 2 * 86_400_000);
    const before = await makeLead({ firstContactAt: new Date(Date.now() - 5 * 86_400_000) });
    const after = await makeLead({ firstContactAt: new Date(Date.now() - 86_400_000) });
    // undated lead: falls back to createdAt (now — after the baseline)
    const undated = await makeLead({ firstContactAt: null });

    const result = await sendSurveyBatch({ propertyId, sinceDate: baseline });
    const ids = result.outcomes.map((o) => o.leadId);
    expect(ids).toContain(after.id);
    expect(ids).toContain(undated.id);
    expect(ids).not.toContain(before.id);

    const beforeRow = await prisma.zillowLead.findUnique({ where: { id: before.id } });
    expect(beforeRow!.status).toBe("new"); // untouched, still manually sendable
  });
});
