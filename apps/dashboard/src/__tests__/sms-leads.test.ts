import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { getSmsLeads } from "../lib/sms-leads";

/**
 * Real-DB tests for the SMS Leads view. All rows carry TEST_PREFIX phones and
 * a dedicated property; getSmsLeads is global, so assertions always filter to
 * this test's phone space before judging.
 */

const prisma = new PrismaClient();
const TEST_PREFIX = `test_smsleads_${Date.now()}`;
const P = (n: number) => `+1872555${String(n).padStart(4, "0")}`; // fake but E.164-shaped

let userId: string;
let propertyId: string;
let zillowRunId: string;

function invite(phone: string, data: Record<string, unknown> = {}) {
  return prisma.surveyInvite.create({
    data: {
      token: `${TEST_PREFIX}_${Math.random().toString(36).slice(2, 12)}`.padEnd(24, "x"),
      propertyId,
      phone,
      channel: "sms",
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      ...data,
    },
  });
}

async function rowsForOurPhones(filters: Parameters<typeof getSmsLeads>[0] = {}) {
  const { rows, counts } = await getSmsLeads(filters);
  return { rows: rows.filter((r) => r.phone.startsWith("+1872555")), counts };
}

beforeAll(async () => {
  await prisma.$connect();
  const user = await prisma.user.create({
    data: {
      email: `${TEST_PREFIX}@test.com`,
      name: "SMS Leads Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;
  const property = await prisma.property.create({
    data: {
      name: `${TEST_PREFIX}_prop`,
      address: "9901 Leadview Ln, Zzville IL",
      userId,
      isActive: true,
      smsIntakeEnabled: true,
    },
  });
  propertyId = property.id;
  const run = await prisma.zillowImportRun.create({ data: { status: "done" } });
  zillowRunId = run.id;
});

afterAll(async () => {
  // Resilient, FK-ordered cleanup: every step runs even if an earlier one
  // fails. A stranded test PROPERTY here is not cosmetic — a leftover
  // smsIntakeEnabled row broke live Zillow property-matching once (2026-08-26,
  // 115 duplicate leads). Children first, property/user last, nothing skipped.
  const step = (p: Promise<unknown>) => p.catch((e) => console.warn("cleanup step failed:", e));
  await step(prisma.outboundRelayMessage.deleteMany({ where: { to: { startsWith: "+1872555" } } }));
  await step(prisma.zillowLead.deleteMany({ where: { importRunId: zillowRunId } }));
  await step(prisma.zillowImportRun.delete({ where: { id: zillowRunId } }));
  await step(prisma.smsConversation.deleteMany({ where: { propertyId } }));
  await step(prisma.smsOptOut.deleteMany({ where: { propertyId } }));
  await step(
    (async () => {
      const invites = await prisma.surveyInvite.findMany({ where: { propertyId } });
      for (const i of invites) {
        if (i.applicationId) {
          await prisma.surveyInvite.update({ where: { id: i.id }, data: { applicationId: null } }).catch(() => undefined);
          await prisma.application.delete({ where: { id: i.applicationId } }).catch(() => undefined);
        }
      }
    })(),
  );
  await step(prisma.surveyInvite.deleteMany({ where: { propertyId } }));
  await step(prisma.application.deleteMany({ where: { propertyId } }));
  await step(prisma.tenant.deleteMany({ where: { userId } }));
  await step(prisma.property.delete({ where: { id: propertyId } }));
  await step(prisma.user.delete({ where: { id: userId } }));
  await prisma.$disconnect();
});

describe("getSmsLeads", () => {
  it("durable universe: a texted-in invite row survives the conversation purge", async () => {
    const phone = P(1);
    await invite(phone, { inboundMessage: "Hi, is the 2br still available?" });
    await prisma.smsConversation.create({
      data: {
        callerPhone: phone,
        propertyId,
        messages: [{ role: "user", content: "Hi, is the 2br still available?" }],
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    let { rows } = await rowsForOurPhones();
    let row = rows.find((r) => r.phone === phone)!;
    expect(row.origins).toEqual(["texted_in"]);
    expect(row.transcript).not.toBeNull();

    // Simulate the 24h purge
    await prisma.smsConversation.deleteMany({ where: { callerPhone: phone, propertyId } });
    ({ rows } = await rowsForOurPhones());
    row = rows.find((r) => r.phone === phone)!;
    expect(row).toBeDefined();
    expect(row.origins).toEqual(["texted_in"]); // durable via inboundMessage
    expect(row.inboundMessage).toBe("Hi, is the 2br still available?");
    expect(row.transcript).toBeNull();
  });

  it("origin chips: zillow-only, and BOTH when a blast recipient texts in (reused invite)", async () => {
    const zPhone = P(2);
    const zInvite = await invite(zPhone);
    await prisma.zillowLead.create({
      data: {
        name: "Zed Blast",
        nameKey: "zed blast",
        phone: zPhone,
        propertyText: "9901 Leadview",
        propertyId,
        status: "invited",
        inviteId: zInvite.id,
        lastMessage: "Interested in your listing",
        importRunId: zillowRunId,
      },
    });

    let { rows } = await rowsForOurPhones();
    let row = rows.find((r) => r.phone === zPhone)!;
    expect(row.origins).toEqual(["zillow"]);
    expect(row.name).toBe("Zed Blast");
    expect(row.inboundMessage).toBe("Interested in your listing"); // zillow fallback

    // They text in later: intake reuses the SAME invite and snapshots the text
    await prisma.surveyInvite.update({
      where: { id: zInvite.id },
      data: { inboundMessage: "Got your text — how do I apply?" },
    });
    ({ rows } = await rowsForOurPhones());
    row = rows.find((r) => r.phone === zPhone)!;
    expect(row.origins).toEqual(["texted_in", "zillow"]);
    expect(row.inboundMessage).toBe("Got your text — how do I apply?");
  });

  it("link kind: google_form vs hosted from the latest invite channel", async () => {
    const gPhone = P(3);
    await invite(gPhone, { channel: "google_form", inboundMessage: "info please" });
    const { rows } = await rowsForOurPhones();
    expect(rows.find((r) => r.phone === gPhone)!.linkKind).toBe("google_form");
    expect(rows.find((r) => r.phone === P(1))!.linkKind).toBe("hosted");
  });

  it("delivery comes from the latest ledger row of the latest invite", async () => {
    const dPhone = P(4);
    const dInvite = await invite(dPhone, { inboundMessage: "hello" });
    await prisma.outboundRelayMessage.create({
      data: { to: dPhone, body: "link text", kind: "link", status: "deferred", inviteId: dInvite.id },
    });
    const { rows } = await rowsForOurPhones();
    const row = rows.find((r) => r.phone === dPhone)!;
    expect(row.delivery).toMatchObject({ status: "deferred" });
    expect(row.state).toBe("invited");
  });

  it("contacted-but-no-link: live conversation without any invite", async () => {
    const cPhone = P(5);
    await prisma.smsConversation.create({
      data: {
        callerPhone: cPhone,
        propertyId,
        messages: [{ role: "user", content: "what are the requirements?" }],
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const { rows } = await rowsForOurPhones();
    const row = rows.find((r) => r.phone === cPhone)!;
    expect(row.linkKind).toBe("none");
    expect(row.state).toBe("contacted");
    expect(row.inboundMessage).toBe("what are the requirements?");
  });

  it("applied state + name via invite→application", async () => {
    const aPhone = P(6);
    const app = await prisma.application.create({
      data: {
        propertyId,
        channel: "sms_link",
        status: "completed",
        completedAt: new Date(),
        callerPhone: aPhone,
        fullName: "Applied Person",
      },
    });
    await invite(aPhone, { applicationId: app.id, usedAt: new Date(), inboundMessage: "applying!" });
    const { rows } = await rowsForOurPhones();
    const row = rows.find((r) => r.phone === aPhone)!;
    expect(row.state).toBe("applied");
    expect(row.name).toBe("Applied Person");
  });

  it("opted_out state", async () => {
    const oPhone = P(7);
    await invite(oPhone, { inboundMessage: "hi" });
    await prisma.smsOptOut.create({ data: { phone: oPhone, propertyId } });
    const { rows } = await rowsForOurPhones();
    expect(rows.find((r) => r.phone === oPhone)!.state).toBe("opted_out");
  });

  it("tenant exclusion by default, revealable with includeTenants", async () => {
    const tPhone = P(8);
    await invite(tPhone, { inboundMessage: "my sink leaks" });
    await prisma.tenant.create({
      data: {
        firstName: "Terry",
        lastName: "Tenant",
        email: `${TEST_PREFIX}_t@test.com`,
        phone: tPhone,
        userId,
        passwordHash: await bcrypt.hash("password123", 12),
      },
    });
    const { rows } = await rowsForOurPhones();
    expect(rows.find((r) => r.phone === tPhone)).toBeUndefined();

    const { rows: withTenants } = await rowsForOurPhones({ includeTenants: true });
    const row = withTenants.find((r) => r.phone === tPhone)!;
    expect(row.isTenant).toBe(true);
  });

  it("filters: origin, linkKind, state", async () => {
    const { rows: zillowOnly } = await rowsForOurPhones({ origin: "zillow" });
    expect(zillowOnly.every((r) => r.origins.includes("zillow"))).toBe(true);
    expect(zillowOnly.some((r) => r.phone === P(2))).toBe(true);

    const { rows: forms } = await rowsForOurPhones({ linkKind: "google_form" });
    expect(forms.map((r) => r.phone)).toContain(P(3));
    expect(forms.every((r) => r.linkKind === "google_form")).toBe(true);

    const { rows: applied } = await rowsForOurPhones({ state: "applied" });
    expect(applied.map((r) => r.phone)).toContain(P(6));
  });
  it("a caller (kind 'caller' ledger row) gets origin 'called' + the caller message", async () => {
    const phone = P(90);
    const inv = await invite(phone, { channel: "google_form" });
    await prisma.outboundRelayMessage.create({
      data: { to: phone, kind: "caller", status: "sent", sentAt: new Date(), body: "Ghem (you called): apply here docs.google.com/forms/x", inviteId: inv.id } as any,
    });
    const { rows } = await rowsForOurPhones();
    const row = rows.find((r) => r.phone === phone)!;
    expect(row.origins).toContain("called");
    expect(row.linkKind).toBe("google_form");
    expect(row.callerMessage).toContain("you called");
  });

  it("a caller who LATER texted still shows 'called' (not overwritten by the newer text row)", async () => {
    const phone = P(91);
    const inv = await invite(phone, { channel: "google_form", inboundMessage: "hi" });
    // caller send first, then a later intake text send (newer createdAt) on the SAME invite
    await prisma.outboundRelayMessage.create({ data: { to: phone, kind: "caller", status: "sent", sentAt: new Date(Date.now() - 60000), createdAt: new Date(Date.now() - 60000), body: "call msg", inviteId: inv.id } as any });
    await prisma.outboundRelayMessage.create({ data: { to: phone, kind: "intake", status: "sent", sentAt: new Date(), createdAt: new Date(), body: "text msg", inviteId: inv.id } as any });
    const { rows } = await rowsForOurPhones();
    const row = rows.find((r) => r.phone === phone)!;
    expect(row.origins).toContain("called");   // rev.2a: full scan, not latest-row map
    expect(row.origins).toContain("texted_in");
    expect(row.callerMessage).toBe("call msg"); // rev.2b: caller row body, not the newer text
  });

  it("a text-only lead has NO 'called' origin, and the called count reflects callers", async () => {
    const phone = P(92);
    await invite(phone, { inboundMessage: "just texting" });
    const { rows, counts } = await rowsForOurPhones();
    const row = rows.find((r) => r.phone === phone)!;
    expect(row.origins).not.toContain("called");
    expect(counts.called).toBeGreaterThanOrEqual(1); // P(90)+P(91) called
    // origin filter narrows to callers
    const { rows: calledOnly } = await rowsForOurPhones({ origin: "called" });
    expect(calledOnly.every((r) => r.origins.includes("called"))).toBe(true);
    expect(calledOnly.find((r) => r.phone === phone)).toBeUndefined();
  });
});
