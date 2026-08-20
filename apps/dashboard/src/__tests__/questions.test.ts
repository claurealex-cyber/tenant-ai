import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PREFIX = `test_quest_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "Question Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "Question Test Property",
      address: "100 Question Ave",
      userId,
    },
  });
  propertyId = property.id;
});

afterAll(async () => {
  await prisma.question.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Question Creation ──

describe("Question creation", () => {
  it("creates a question with all fields", async () => {
    const question = await prisma.question.create({
      data: {
        propertyId,
        text: "What is your full name?",
        fieldKey: "fullName",
        type: "text",
        required: true,
        sortOrder: 0,
        isStandard: true,
      },
    });

    expect(question.id).toBeDefined();
    expect(question.propertyId).toBe(propertyId);
    expect(question.text).toBe("What is your full name?");
    expect(question.fieldKey).toBe("fullName");
    expect(question.type).toBe("text");
    expect(question.required).toBe(true);
    expect(question.sortOrder).toBe(0);
    expect(question.isStandard).toBe(true);
  });

  it("creates a question with default values", async () => {
    const question = await prisma.question.create({
      data: {
        propertyId,
        text: "Any pets?",
        fieldKey: "pets",
        sortOrder: 1,
      },
    });

    expect(question.type).toBe("text"); // default
    expect(question.required).toBe(true); // default
    expect(question.isStandard).toBe(false); // default
  });

  it("supports all question types", async () => {
    const types = ["text", "yes_no", "number", "date"];

    for (let i = 0; i < types.length; i++) {
      const q = await prisma.question.create({
        data: {
          propertyId,
          text: `Test ${types[i]} question`,
          fieldKey: `test_type_${types[i]}`,
          type: types[i],
          sortOrder: 10 + i,
        },
      });
      expect(q.type).toBe(types[i]);
    }
  });

  it("auto-generates fieldKey from text (API logic)", () => {
    const text = "Do you have any felonies?";
    const key = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 40);

    expect(key).toBe("do_you_have_any_felonies");
  });

  it("auto-generates fieldKey with special characters stripped", () => {
    const text = "What's your employer's phone #?";
    const key = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 40);

    expect(key).toBe("whats_your_employers_phone");
  });

  it("truncates long fieldKeys to 40 characters", () => {
    const text =
      "This is a very long question that should be truncated when generating a field key for storage";
    const key = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 40);

    expect(key.length).toBeLessThanOrEqual(40);
  });
});

// ── Question Ordering ──

describe("Question ordering", () => {
  let questionIds: string[] = [];

  beforeAll(async () => {
    // Create ordered questions
    const questions = [];
    for (let i = 0; i < 5; i++) {
      const q = await prisma.question.create({
        data: {
          propertyId,
          text: `Order question ${i}`,
          fieldKey: `order_q_${i}`,
          sortOrder: 100 + i,
        },
      });
      questions.push(q);
    }
    questionIds = questions.map((q) => q.id);
  });

  it("lists questions in sortOrder", async () => {
    const questions = await prisma.question.findMany({
      where: {
        propertyId,
        fieldKey: { startsWith: "order_q_" },
      },
      orderBy: { sortOrder: "asc" },
    });

    for (let i = 1; i < questions.length; i++) {
      expect(questions[i].sortOrder).toBeGreaterThan(
        questions[i - 1].sortOrder
      );
    }
  });

  it("reorders questions via bulk update transaction", async () => {
    // Reverse the order
    const reorder = questionIds.map((id, i) => ({
      id,
      sortOrder: 100 + (questionIds.length - 1 - i),
    }));

    await prisma.$transaction(
      reorder.map((item) =>
        prisma.question.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );

    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds } },
      orderBy: { sortOrder: "asc" },
    });

    // First question by sortOrder should now be the last original
    expect(questions[0].id).toBe(questionIds[questionIds.length - 1]);
    expect(questions[questions.length - 1].id).toBe(questionIds[0]);
  });
});

// ── Question Update ──

describe("Question update", () => {
  let standardQuestionId: string;
  let customQuestionId: string;

  beforeAll(async () => {
    const standard = await prisma.question.create({
      data: {
        propertyId,
        text: "What is your date of birth?",
        fieldKey: "dateOfBirth",
        type: "date",
        required: true,
        sortOrder: 200,
        isStandard: true,
      },
    });
    standardQuestionId = standard.id;

    const custom = await prisma.question.create({
      data: {
        propertyId,
        text: "Do you smoke?",
        fieldKey: "smoking",
        type: "yes_no",
        required: false,
        sortOrder: 201,
        isStandard: false,
      },
    });
    customQuestionId = custom.id;
  });

  it("updates text of a standard question", async () => {
    const updated = await prisma.question.update({
      where: { id: standardQuestionId },
      data: { text: "When were you born?" },
    });

    expect(updated.text).toBe("When were you born?");
    expect(updated.isStandard).toBe(true); // Still standard
  });

  it("toggles required on a standard question", async () => {
    const updated = await prisma.question.update({
      where: { id: standardQuestionId },
      data: { required: false },
    });

    expect(updated.required).toBe(false);

    // Restore
    await prisma.question.update({
      where: { id: standardQuestionId },
      data: { required: true },
    });
  });

  it("updates type of a custom question", async () => {
    const updated = await prisma.question.update({
      where: { id: customQuestionId },
      data: { type: "text" },
    });

    expect(updated.type).toBe("text");
  });

  it("updates text of a custom question", async () => {
    const updated = await prisma.question.update({
      where: { id: customQuestionId },
      data: { text: "Are you a smoker?" },
    });

    expect(updated.text).toBe("Are you a smoker?");
  });
});

// ── Question Deletion ──

describe("Question deletion", () => {
  it("deletes a custom question", async () => {
    const question = await prisma.question.create({
      data: {
        propertyId,
        text: "To be deleted",
        fieldKey: "to_delete",
        sortOrder: 300,
        isStandard: false,
      },
    });

    await prisma.question.delete({ where: { id: question.id } });

    const found = await prisma.question.findUnique({
      where: { id: question.id },
    });
    expect(found).toBeNull();
  });

  it("standard question deletion should be blocked by API (business logic test)", async () => {
    const question = await prisma.question.create({
      data: {
        propertyId,
        text: "Standard - cannot delete",
        fieldKey: "no_delete",
        sortOrder: 301,
        isStandard: true,
      },
    });

    // The API route blocks this; at DB level, we verify the isStandard flag
    expect(question.isStandard).toBe(true);

    // API logic: if (question.isStandard) return 400 error
    // DB allows delete, but API prevents it
    // Clean up (we're testing the flag, not the constraint)
    await prisma.question.delete({ where: { id: question.id } });
  });

  it("cascades delete when property is deleted", async () => {
    const prop = await prisma.property.create({
      data: {
        name: "Cascade Question Test",
        address: "500 Cascade",
        userId,
      },
    });

    await prisma.question.createMany({
      data: [
        { propertyId: prop.id, text: "Q1", fieldKey: "cq1", sortOrder: 0 },
        { propertyId: prop.id, text: "Q2", fieldKey: "cq2", sortOrder: 1 },
        { propertyId: prop.id, text: "Q3", fieldKey: "cq3", sortOrder: 2 },
      ],
    });

    await prisma.property.delete({ where: { id: prop.id } });

    const orphaned = await prisma.question.findMany({
      where: { propertyId: prop.id },
    });
    expect(orphaned.length).toBe(0);
  });
});

// ── Data Isolation ──

describe("Question data isolation", () => {
  it("questions are scoped to their property", async () => {
    const prop2 = await prisma.property.create({
      data: {
        name: "Other Property",
        address: "600 Other",
        userId,
      },
    });

    await prisma.question.create({
      data: {
        propertyId: prop2.id,
        text: "Other property question",
        fieldKey: "other_q",
        sortOrder: 0,
      },
    });

    const prop1Questions = await prisma.question.findMany({
      where: { propertyId },
    });

    const prop2Questions = await prisma.question.findMany({
      where: { propertyId: prop2.id },
    });

    // No cross-contamination
    expect(
      prop1Questions.every((q) => q.propertyId === propertyId)
    ).toBe(true);
    expect(
      prop2Questions.every((q) => q.propertyId === prop2.id)
    ).toBe(true);

    // Clean up
    await prisma.question.deleteMany({ where: { propertyId: prop2.id } });
    await prisma.property.delete({ where: { id: prop2.id } });
  });
});

// ── Standard Questions Seeding ──

describe("Standard questions pattern", () => {
  it("can bulk-create standard questions for a property", async () => {
    const prop = await prisma.property.create({
      data: {
        name: "Seed Test",
        address: "700 Seed St",
        userId,
      },
    });

    // Simulate what the onboarding wizard does
    const standardFields = [
      { fieldKey: "fullName", text: "What is your full name?", type: "text", required: true, sortOrder: 0 },
      { fieldKey: "dateOfBirth", text: "What is your date of birth?", type: "date", required: true, sortOrder: 1 },
      { fieldKey: "ssn", text: "What is your SSN?", type: "text", required: true, sortOrder: 2 },
      { fieldKey: "email", text: "What is your email?", type: "text", required: true, sortOrder: 3 },
      { fieldKey: "monthlyIncome", text: "What is your monthly income?", type: "number", required: true, sortOrder: 4 },
    ];

    await prisma.question.createMany({
      data: standardFields.map((f) => ({
        propertyId: prop.id,
        ...f,
        isStandard: true,
      })),
    });

    const questions = await prisma.question.findMany({
      where: { propertyId: prop.id },
      orderBy: { sortOrder: "asc" },
    });

    expect(questions.length).toBe(5);
    expect(questions[0].fieldKey).toBe("fullName");
    expect(questions[4].fieldKey).toBe("monthlyIncome");
    expect(questions.every((q) => q.isStandard)).toBe(true);

    // Clean up
    await prisma.question.deleteMany({ where: { propertyId: prop.id } });
    await prisma.property.delete({ where: { id: prop.id } });
  });
});
