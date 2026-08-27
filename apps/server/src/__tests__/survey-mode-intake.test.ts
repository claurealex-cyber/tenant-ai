import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

// Mutable config so each test can flip the mode without touching the shared dev DB.
const cfg: Record<string, string | null> = {
  survey_mode: "hosted",
  google_form_url: null,
  survey_base_url: "https://static.example.test",
  enabled: "true",
  intake_style: "link_only",
  intake_greeting: "",
};
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tenant-ai/shared")>();
  return {
    ...original,
    resolveConfig: async (ns: string, key: string, def?: string) =>
      ns === "sms_relay" && key in cfg ? cfg[key] : original.resolveConfig(ns, key, def),
  };
});

vi.mock("../services/openai-chat.js", () => ({
  callChatAPI: async () => ({ content: "The 2-bedroom is $1,500/mo, available now.", functionCalls: [] }),
  splitSmsResponse: (t: string) => [t],
}));

import {
  handleSurveyIntake,
  resolveSurveyLink,
  buildIntakeReply,
  GOOGLE_FORM_INVITE_CHANNEL,
} from "../handlers/survey-intake.js";
import { rewriteForRelay } from "../routes/telnyx-sms.js";

const FORM = "https://docs.google.com/forms/d/e/1FAIpQLSf4jZ7jYk14CDnRZjZCZPhV6NEhD53sDqfdZp7omfBUe3Vbug/viewform";
const prisma = new PrismaClient();
const TEST_PREFIX = `test_surveymode_${Date.now()}`;
let userId: string;
let propertyId: string;
let seq = 0;
const phone = () => `+1630555${String(seq++).padStart(4, "0")}`;
const property = () => ({ id: propertyId, userId, name: `${TEST_PREFIX} Prop`, intakeAutoReply: null });

beforeAll(async () => {
  await prisma.$connect();
  const user = await prisma.user.create({
    data: {
      email: `${TEST_PREFIX}@test.com`,
      name: "Survey Mode Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;
  const prop = await prisma.property.create({
    data: {
      name: `${TEST_PREFIX} Prop`,
      address: "1 Mode St, Chicago IL 60601",
      userId,
      isActive: true,
      twilioPhone: `+1312666${Date.now().toString().slice(-4)}`,
      smsIntakeEnabled: true,
    },
  });
  propertyId = prop.id;
});

afterAll(async () => {
  await prisma.surveyInvite.deleteMany({ where: { propertyId } });
  await prisma.application.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  cfg.survey_mode = "hosted";
  cfg.google_form_url = null;
  cfg.intake_style = "link_only";
  cfg.intake_greeting = "";
  vi.restoreAllMocks();
});

describe("resolveSurveyLink — the single link decision", () => {
  it("hosted: tokenized link on the static base, channel sms", async () => {
    const p = phone();
    const link = await resolveSurveyLink(property(), p);
    expect(link.kind).toBe("hosted");
    expect(link.url).toBe(`https://static.example.test/survey/${link.invite.token}`);
    expect(link.invite.channel).toBe("sms");
  });

  it("google_form: the form URL, and an audit invite with channel google_form", async () => {
    cfg.survey_mode = "google_form";
    cfg.google_form_url = FORM;
    const p = phone();
    const link = await resolveSurveyLink(property(), p);
    expect(link.kind).toBe("google_form");
    expect(link.url).toBe(FORM);
    expect(link.invite.channel).toBe(GOOGLE_FORM_INVITE_CHANNEL);
    const rows = await prisma.surveyInvite.findMany({ where: { propertyId, phone: p } });
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("google_form");
  });

  it("google_form with a pre-filled URL substitutes {phone} and {property}", async () => {
    cfg.survey_mode = "google_form";
    cfg.google_form_url = `${FORM}?usp=pp_url&entry.9={phone}&entry.8={property}`;
    const p = phone();
    const link = await resolveSurveyLink(property(), p);
    expect(link.url).toBe(
      `${FORM}?usp=pp_url&entry.9=${encodeURIComponent(p)}&entry.8=${encodeURIComponent(`${TEST_PREFIX} Prop`)}`,
    );
  });

  it("google_form without a valid URL falls back to hosted and warns — never texts a broken link", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cfg.survey_mode = "google_form";
    cfg.google_form_url = "https://example.com/not-google";
    const link = await resolveSurveyLink(property(), phone());
    expect(link.kind).toBe("hosted");
    expect(link.url).toContain("/survey/");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[survey-mode]"));
  });

  it("flipping the mode reuses the single outstanding invite and records the latest channel", async () => {
    // One outstanding invite per phone+property is a DB invariant (partial unique
    // index) — the toggle must live inside it, not fight it.
    const p = phone();
    const hosted = await resolveSurveyLink(property(), p);
    expect(hosted.invite.channel).toBe("sms");

    cfg.survey_mode = "google_form";
    cfg.google_form_url = FORM;
    const form = await resolveSurveyLink(property(), p);
    expect(form.invite.id).toBe(hosted.invite.id);
    expect(form.invite.channel).toBe(GOOGLE_FORM_INVITE_CHANNEL);

    cfg.survey_mode = "hosted";
    const back = await resolveSurveyLink(property(), p);
    expect(back.invite.id).toBe(hosted.invite.id);
    expect(back.invite.channel).toBe("sms");
    expect(back.url).toBe(hosted.url); // same token, still valid

    const rows = await prisma.surveyInvite.findMany({ where: { propertyId, phone: p } });
    expect(rows).toHaveLength(1);
  });
});

describe("handleSurveyIntake honors the mode", () => {
  it("hosted reply text is unchanged from before the toggle existed", async () => {
    const p = phone();
    const res = await handleSurveyIntake(property(), p);
    const invite = await prisma.surveyInvite.findFirst({ where: { propertyId, phone: p } });
    expect(res.replies[0]).toBe(
      `Thanks for your interest in ${TEST_PREFIX} Prop! Start your rental application here:\n` +
        `https://static.example.test/survey/${invite!.token}\n\nReply STOP to opt out.`,
    );
    expect(res.replyKind).toBe("link");
  });

  it("google_form reply carries the form link, the intro and the STOP line", async () => {
    cfg.survey_mode = "google_form";
    cfg.google_form_url = FORM;
    const res = await handleSurveyIntake({ ...property(), intakeAutoReply: "Hi from Ghem! Apply here:" }, phone());
    expect(res.replies[0]).toBe(`Hi from Ghem! Apply here:\n${FORM}\n\nReply STOP to opt out.`);
    expect(res.shouldRespond).toBe(true);
  });

  it("a phone that already applied STILL gets the intro + link (ack gate removed)", async () => {
    const p = phone();
    await prisma.application.create({
      data: { propertyId, callerPhone: p, channel: "sms_link", status: "completed", completedAt: new Date() } as any,
    });
    cfg.survey_mode = "google_form";
    cfg.google_form_url = FORM;
    const res = await handleSurveyIntake(property(), p);
    expect(res.replyKind).not.toBe("confirmation");
    expect(res.replies[0]).toContain(FORM);
    expect(res.replies[0]).not.toContain("We received your application");
  });

  it("relay rewrite leaves the Google Form URL byte-for-byte intact", () => {
    const text = buildIntakeReply({ name: "Ghem LLC 1", intakeAutoReply: null }, FORM);
    const out = rewriteForRelay(text, "Ghem LLC 1", "+17089070695");
    expect(out).toContain(FORM);
    expect(out).toContain("To opt out, text STOP to (708) 907-0695.");
    expect(out).not.toContain("Reply STOP to opt out.");
  });
});

describe("intake_style routing (M2)", () => {
  const DEFAULT_GREETING = "Hi! We're sending you an application link — please fill it out and we'll get back to you.";

  it("link_only is unchanged — greeting is the classic intro, not the Q&A greeting", async () => {
    const p = phone();
    const res = await handleSurveyIntake({ ...property(), intakeAutoReply: null }, p, "hi");
    expect(res.replies[0]).toContain("Start your rental application here:");
    expect(res.replies[0]).not.toContain("Have questions about the property");
    expect(res.replyKind).toBe("link");
  });

  it("link_and_qa first contact → greeting + link + offer + STOP (global greeting, NOT intakeAutoReply)", async () => {
    cfg.intake_style = "link_and_qa";
    const p = phone();
    const res = await handleSurveyIntake(
      { ...property(), intakeAutoReply: "PROPERTY-SPECIFIC AUTO REPLY" },
      p,
      "is the 2br available?",
    );
    const invite = await prisma.surveyInvite.findFirst({ where: { propertyId, phone: p } });
    expect(res.replies[0]).toBe(
      `${DEFAULT_GREETING}\nhttps://static.example.test/survey/${invite!.token}\n\n` +
        `Have questions about the property, pricing or availability? Just reply here.\n\nReply STOP to opt out.`,
    );
    expect(res.replies[0]).not.toContain("PROPERTY-SPECIFIC AUTO REPLY");
    expect(res.replyKind).toBe("link");
  });

  it("link_and_qa uses a custom intake_greeting when set", async () => {
    cfg.intake_style = "link_and_qa";
    cfg.intake_greeting = "Welcome to Ghem! Apply below:";
    const p = phone();
    const res = await handleSurveyIntake(property(), p, "hello");
    expect(res.replies[0]).toContain("Welcome to Ghem! Apply below:");
    expect(res.replies[0]).not.toContain(DEFAULT_GREETING);
  });

  it("link_and_qa: a question after first contact is answered by the AI (replyKind ai)", async () => {
    cfg.intake_style = "link_and_qa";
    const p = phone();
    await handleSurveyIntake(property(), p, "hi"); // mints invite (first contact)
    // Seed the greeting into the conversation so the AI turn has history.
    await prisma.smsConversation.upsert({
      where: { callerPhone_propertyId: { callerPhone: p, propertyId } },
      create: { callerPhone: p, propertyId, messages: [{ role: "assistant", content: "greeting" }], expiresAt: new Date(Date.now() + 86400000) },
      update: { messages: [{ role: "assistant", content: "greeting" }] },
    });
    const q = await handleSurveyIntake(property(), p, "how much is rent");
    expect(q.shouldRespond).toBe(true);
    expect(q.replyKind).toBe("ai");
    expect(q.replies[0]).toContain("$1,500/mo");
    await prisma.smsConversation.deleteMany({ where: { propertyId, callerPhone: p } });
  });

  it("link_and_qa: an explicit 'send the link' after first contact resends the greeting", async () => {
    cfg.intake_style = "link_and_qa";
    const p = phone();
    await handleSurveyIntake(property(), p, "hi");
    const again = await handleSurveyIntake(property(), p, "can you resend the link");
    expect(again.shouldRespond).toBe(true);
    expect(again.replies[0]).toContain("Have questions about the property");
    expect(again.replyKind).toBe("link");
  });

  it("completed application → STILL gets the greeting + link in link_and_qa (ack gate removed)", async () => {
    cfg.intake_style = "link_and_qa";
    const p = phone();
    await prisma.application.create({
      data: { propertyId, callerPhone: p, channel: "sms_link", status: "completed", completedAt: new Date() } as any,
    });
    const res = await handleSurveyIntake(property(), p, "hello");
    expect(res.replyKind).toBe("link");
    expect(res.replies[0]).toContain("Have questions about the property");
    expect(res.replies[0]).not.toContain("We received your application");
  });
});
