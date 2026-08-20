import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PREFIX = `test_onb_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "Onboarding Test User",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: false,
    },
  });
  userId = user.id;
});

afterAll(async () => {
  // Clean up in correct order (questions → units → properties → user)
  const properties = await prisma.property.findMany({ where: { userId } });
  const propertyIds = properties.map((p) => p.id);

  if (propertyIds.length > 0) {
    await prisma.question.deleteMany({
      where: { propertyId: { in: propertyIds } },
    });
    await prisma.unit.deleteMany({
      where: { propertyId: { in: propertyIds } },
    });
  }
  await prisma.property.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Onboarding Complete API ──

describe("Onboarding complete", () => {
  it("marks user as onboarded", async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user!.onboarded).toBe(false);

    await prisma.user.update({
      where: { id: userId },
      data: { onboarded: true },
    });

    const updated = await prisma.user.findUnique({ where: { id: userId } });
    expect(updated!.onboarded).toBe(true);

    // Restore for further tests
    await prisma.user.update({
      where: { id: userId },
      data: { onboarded: false },
    });
  });
});

// ── Onboarding Flow: Property → Phone → Questions ──

describe("Onboarding flow simulation", () => {
  let propertyId: string;

  it("Step 1: creates a property during onboarding", async () => {
    const property = await prisma.property.create({
      data: {
        name: "Onboarding Property",
        address: "123 Onboarding St, Chicago IL 60601",
        unitCount: 10,
        description: "A nice property for testing onboarding",
        userId,
      },
    });

    propertyId = property.id;
    expect(property.name).toBe("Onboarding Property");
    expect(property.isActive).toBe(false); // Not active until phone provisioned
    expect(property.twilioPhone).toBeNull();
  });

  it("Step 2: provisions a phone number for the property", async () => {
    const uniquePhone = `+1312555${Date.now().toString().slice(-4)}`;

    const updated = await prisma.property.update({
      where: { id: propertyId },
      data: {
        twilioPhone: uniquePhone,
        twilioPhoneSid: "PN_test_sid_onboarding",
        isActive: true,
      },
    });

    expect(updated.twilioPhone).toBe(uniquePhone);
    expect(updated.twilioPhoneSid).toBe("PN_test_sid_onboarding");
    expect(updated.isActive).toBe(true);
  });

  it("Step 3: seeds standard questions for the property", async () => {
    const standardQuestions = [
      { text: "What is your full name?", fieldKey: "fullName", type: "text" },
      {
        text: "What is your date of birth?",
        fieldKey: "dateOfBirth",
        type: "date",
      },
      {
        text: "What is your Social Security Number?",
        fieldKey: "ssn",
        type: "text",
      },
      {
        text: "What is your email address?",
        fieldKey: "email",
        type: "text",
      },
      {
        text: "What is your phone number?",
        fieldKey: "phone",
        type: "text",
      },
      {
        text: "What is your current address?",
        fieldKey: "currentAddress",
        type: "text",
      },
      {
        text: "What is your monthly income?",
        fieldKey: "monthlyIncome",
        type: "number",
      },
      {
        text: "Who is your current employer?",
        fieldKey: "employer",
        type: "text",
      },
      {
        text: "What is your employer's phone number?",
        fieldKey: "employerPhone",
        type: "text",
      },
      { text: "Do you have any pets?", fieldKey: "hasPets", type: "yes_no" },
      {
        text: "When would you like to move in?",
        fieldKey: "moveInDate",
        type: "date",
      },
    ];

    await prisma.question.createMany({
      data: standardQuestions.map((q, i) => ({
        propertyId,
        text: q.text,
        fieldKey: q.fieldKey,
        type: q.type,
        required: true,
        sortOrder: i,
        isStandard: true,
      })),
    });

    const questions = await prisma.question.findMany({
      where: { propertyId },
      orderBy: { sortOrder: "asc" },
    });

    expect(questions.length).toBe(11);
    expect(questions[0].fieldKey).toBe("fullName");
    expect(questions[10].fieldKey).toBe("moveInDate");
    expect(questions.every((q) => q.isStandard)).toBe(true);
    expect(questions.every((q) => q.required)).toBe(true);
  });

  it("Step 3: allows adding custom questions during onboarding", async () => {
    const maxOrder = await prisma.question.findFirst({
      where: { propertyId },
      orderBy: { sortOrder: "desc" },
    });

    const customQuestion = await prisma.question.create({
      data: {
        propertyId,
        text: "Do you have any felonies?",
        fieldKey: "felonies",
        type: "yes_no",
        required: true,
        sortOrder: (maxOrder?.sortOrder ?? -1) + 1,
        isStandard: false,
      },
    });

    expect(customQuestion.isStandard).toBe(false);
    expect(customQuestion.type).toBe("yes_no");
    expect(customQuestion.sortOrder).toBe(11);

    const total = await prisma.question.count({ where: { propertyId } });
    expect(total).toBe(12);
  });

  it("Step 3: allows toggling required on standard questions", async () => {
    const petsQ = await prisma.question.findFirst({
      where: { propertyId, fieldKey: "hasPets" },
    });

    const updated = await prisma.question.update({
      where: { id: petsQ!.id },
      data: { required: false },
    });

    expect(updated.required).toBe(false);
  });

  it("completes onboarding by marking user as onboarded", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { onboarded: true },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user!.onboarded).toBe(true);
  });

  it("user has a property with phone, questions, and is onboarded", async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        properties: {
          include: {
            questions: { orderBy: { sortOrder: "asc" } },
          },
        },
      },
    });

    expect(user!.onboarded).toBe(true);
    expect(user!.properties.length).toBe(1);

    const prop = user!.properties[0];
    expect(prop.isActive).toBe(true);
    expect(prop.twilioPhone).toBeTruthy();
    expect(prop.questions.length).toBe(12); // 11 standard + 1 custom
  });
});

// ── Mock phone numbers ──

describe("Available numbers mock", () => {
  it("generates mock numbers for a given area code", () => {
    const areaCode = "720";
    const mockNumbers = Array.from({ length: 5 }, (_, i) => ({
      phoneNumber: `+1${areaCode}555${String(1000 + i).slice(-4)}`,
      friendlyName: `(${areaCode}) 555-${String(1000 + i).slice(-4)}`,
      locality: "Chicago",
      region: "IL",
    }));

    expect(mockNumbers.length).toBe(5);
    expect(mockNumbers[0].phoneNumber).toBe("+17205551000");
    expect(mockNumbers[0].friendlyName).toBe("(720) 555-1000");
    expect(mockNumbers[4].phoneNumber).toBe("+17205551004");
  });

  it("generates mock numbers for default area code 312", () => {
    const areaCode = "312";
    const mockNumbers = Array.from({ length: 5 }, (_, i) => ({
      phoneNumber: `+1${areaCode}555${String(1000 + i).slice(-4)}`,
      friendlyName: `(${areaCode}) 555-${String(1000 + i).slice(-4)}`,
    }));

    expect(mockNumbers[0].phoneNumber).toBe("+13125551000");
    expect(mockNumbers[2].friendlyName).toBe("(312) 555-1002");
  });
});
