import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { handleIncomingSms } from "../handlers/sms-handler.js";
import {
  createOrReuseSurveyInvite,
  handleSurveyIntake,
} from "../handlers/survey-intake.js";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_survey_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;
const twilioPhone = `+1312777${Date.now().toString().slice(-4)}`;
const callerPhone = "+13125559099";

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "Survey Test Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "Survey Test Property",
      address: "500 Survey Ave, Chicago IL 60601",
      userId,
      isActive: true,
      twilioPhone,
      twilioPhoneSid: `PN_survey_${Date.now()}`,
      smsIntakeEnabled: true,
    },
  });
  propertyId = property.id;
});

afterAll(async () => {
  await prisma.surveyInvite.deleteMany({ where: { propertyId } });
  await prisma.smsConversation.deleteMany({ where: { propertyId } });
  await prisma.smsOptOut.deleteMany({ where: { propertyId } });
  await prisma.application.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("survey-intake", () => {
  it("createOrReuseSurveyInvite creates then reuses the same unused invite", async () => {
    const first = await createOrReuseSurveyInvite(propertyId, callerPhone);
    expect(first.token).toBeTruthy();
    expect(first.usedAt).toBeNull();

    const second = await createOrReuseSurveyInvite(propertyId, callerPhone);
    expect(second.id).toBe(first.id); // reused, not a new invite

    const count = await prisma.surveyInvite.count({
      where: { propertyId, phone: callerPhone },
    });
    expect(count).toBe(1);
  });

  it("handleSurveyIntake replies with the survey link and opt-out notice", async () => {
    const phone = "+13125559100";
    const res = await handleSurveyIntake(
      { id: propertyId, userId, name: "Survey Test Property", intakeAutoReply: null },
      phone
    );
    expect(res.shouldRespond).toBe(true);
    expect(res.replies).toHaveLength(1);

    const invite = await prisma.surveyInvite.findFirst({
      where: { propertyId, phone },
    });
    expect(invite).not.toBeNull();
    expect(res.replies[0]).toContain(`/survey/${invite!.token}`);
    expect(res.replies[0].toLowerCase()).toContain("stop");
  });

  it("handleIncomingSms returns the survey link when intake is enabled", async () => {
    const res = await handleIncomingSms(
      "+13125559200",
      twilioPhone,
      "Hi, I'd like to apply"
    );
    expect(res.shouldRespond).toBe(true);
    expect(res.replies[0]).toContain("/survey/");
  });

  it("honors STOP opt-out even with intake enabled", async () => {
    const optOutPhone = "+13125559300";
    const stop = await handleIncomingSms(optOutPhone, twilioPhone, "STOP");
    expect(stop.replies[0].toLowerCase()).toContain("unsubscribed");

    const after = await handleIncomingSms(optOutPhone, twilioPhone, "Hello");
    expect(after.shouldRespond).toBe(false); // silenced — no link sent
  });
});
