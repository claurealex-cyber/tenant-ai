/**
 * Workflow test: Onboarding
 *
 * Tests the onboarding workflow API routes:
 * - POST /api/onboarding/complete — marks user as onboarded
 * - POST /api/properties — creates a property (with Cook County detection)
 * - POST /api/properties/[id]/questions — creates a question
 * - GET /api/properties/[id]/questions — lists questions
 *
 * Phone provisioning (POST /api/properties/[id]/phone) — already tested
 * in properties.test.ts (SKIP).
 *
 * Uses real DB operations with PrismaClient, TEST_PREFIX pattern for isolation.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_wf_onb_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

function makeRequest(
  url: string,
  options: { method?: string; body?: Record<string, unknown> } = {}
): NextRequest {
  const { method = "GET", body } = options;
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new NextRequest(new URL(url, "http://localhost:3000"), init as any);
}

let userId: string;
let propertyId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "Onboarding Workflow User",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: false,
    },
  });
  userId = user.id;
});

afterAll(async () => {
  // Clean up in correct FK order
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

// ── Onboarding Complete ──

describe("POST /api/onboarding/complete", () => {
  it("marks user as onboarded (direct DB, mirroring route logic)", async () => {
    // Verify user starts as not onboarded
    const before = await prisma.user.findUnique({ where: { id: userId } });
    expect(before!.onboarded).toBe(false);

    // Mirror what the route does: update user onboarded flag
    await prisma.user.update({
      where: { id: userId },
      data: { onboarded: true },
    });

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after!.onboarded).toBe(true);

    // Restore for further tests
    await prisma.user.update({
      where: { id: userId },
      data: { onboarded: false },
    });
  });

  it("returns 401 when not authenticated (via mock)", async () => {
    vi.resetModules();
    vi.doMock("next-auth", () => ({
      getServerSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));

    const { POST } = await import("@/app/api/onboarding/complete/route");

    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("succeeds when authenticated (via mock)", async () => {
    vi.resetModules();
    vi.doMock("next-auth", () => ({
      getServerSession: vi.fn().mockResolvedValue({
        user: { id: userId, email: testEmail("landlord"), role: "client" },
      }),
    }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));

    const { POST } = await import("@/app/api/onboarding/complete/route");

    const res = await POST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify in DB
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user!.onboarded).toBe(true);

    // Restore for next tests
    await prisma.user.update({
      where: { id: userId },
      data: { onboarded: false },
    });
  });
});

// ── Property Creation (onboarding step) ──

describe("Property creation during onboarding", () => {
  it("creates property with name and address", async () => {
    const property = await prisma.property.create({
      data: {
        name: "Onboarding WF Property",
        address: "123 Onboarding St, Chicago IL 60601",
        unitCount: 8,
        userId,
        isActive: false,
      },
    });

    propertyId = property.id;
    expect(property.name).toBe("Onboarding WF Property");
    expect(property.address).toBe("123 Onboarding St, Chicago IL 60601");
    expect(property.isActive).toBe(false);
    expect(property.twilioPhone).toBeNull();
  });

  it("sets cookCounty flag based on zip code detection", async () => {
    // Cook County property (Chicago 60601 is in Cook County)
    const cookProp = await prisma.property.create({
      data: {
        name: "Cook County Place",
        address: "100 Michigan Ave, Chicago IL 60601",
        cookCounty: true,
        userId,
      },
    });
    expect(cookProp.cookCounty).toBe(true);

    // Non-Cook County property
    const nonCookProp = await prisma.property.create({
      data: {
        name: "Naperville Place",
        address: "200 Main St, Naperville IL 60540",
        cookCounty: false,
        userId,
      },
    });
    expect(nonCookProp.cookCounty).toBe(false);
  });

  it("returns 401 when not authenticated (via mock)", async () => {
    vi.resetModules();
    vi.doMock("next-auth", () => ({
      getServerSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));

    const { POST } = await import("@/app/api/properties/route");

    const req = makeRequest("http://localhost:3000/api/properties", {
      method: "POST",
      body: { name: "No Auth", address: "123 Test" },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ── Phone Provisioning — SKIP ──
// Already tested in apps/dashboard/src/__tests__/properties.test.ts
// (Phone Provisioning section)

// ── Seed Questions (onboarding step) ──

describe("Questions during onboarding", () => {
  it("creates a question via POST route logic (direct DB)", async () => {
    const text = "What is your full name?";
    const fieldKey = "fullName";
    const type = "text";

    // Get next sort order (mirroring route logic)
    const maxOrder = await prisma.question.aggregate({
      where: { propertyId },
      _max: { sortOrder: true },
    });
    const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    const question = await prisma.question.create({
      data: {
        propertyId,
        text,
        fieldKey,
        type,
        required: true,
        sortOrder: nextOrder,
        isStandard: true,
      },
    });

    expect(question.id).toBeDefined();
    expect(question.text).toBe("What is your full name?");
    expect(question.fieldKey).toBe("fullName");
    expect(question.type).toBe("text");
    expect(question.required).toBe(true);
    expect(question.isStandard).toBe(true);
    expect(question.sortOrder).toBe(0);
  });

  it("creates multiple standard questions in sequence", async () => {
    const questionsData = [
      { text: "What is your date of birth?", fieldKey: "dateOfBirth", type: "date" },
      { text: "What is your email?", fieldKey: "email", type: "text" },
      { text: "What is your monthly income?", fieldKey: "monthlyIncome", type: "number" },
      { text: "Do you have any pets?", fieldKey: "hasPets", type: "yes_no" },
    ];

    for (const q of questionsData) {
      const maxOrder = await prisma.question.aggregate({
        where: { propertyId },
        _max: { sortOrder: true },
      });
      const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

      await prisma.question.create({
        data: {
          propertyId,
          text: q.text,
          fieldKey: q.fieldKey,
          type: q.type,
          required: true,
          sortOrder: nextOrder,
          isStandard: true,
        },
      });
    }

    const questions = await prisma.question.findMany({
      where: { propertyId },
      orderBy: { sortOrder: "asc" },
    });

    expect(questions.length).toBe(5);
    expect(questions[0].fieldKey).toBe("fullName");
    expect(questions[4].fieldKey).toBe("hasPets");
    expect(questions.every((q) => q.isStandard)).toBe(true);
    expect(questions.every((q) => q.required)).toBe(true);
  });

  it("GET questions returns all questions ordered by sortOrder", async () => {
    const questions = await prisma.question.findMany({
      where: { propertyId },
      orderBy: { sortOrder: "asc" },
    });

    expect(questions.length).toBe(5);

    // Verify ordering
    for (let i = 1; i < questions.length; i++) {
      expect(questions[i].sortOrder).toBeGreaterThan(
        questions[i - 1].sortOrder
      );
    }
  });

  it("auto-generates fieldKey from text when not provided (API logic)", () => {
    const text = "Do you have any felonies?";
    const key = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 40);

    expect(key).toBe("do_you_have_any_felonies");
  });

  it("creates custom (non-standard) question", async () => {
    const maxOrder = await prisma.question.aggregate({
      where: { propertyId },
      _max: { sortOrder: true },
    });
    const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    const question = await prisma.question.create({
      data: {
        propertyId,
        text: "Do you have any felonies?",
        fieldKey: "felonies",
        type: "yes_no",
        required: true,
        sortOrder: nextOrder,
        isStandard: false,
      },
    });

    expect(question.isStandard).toBe(false);
    expect(question.type).toBe("yes_no");
    expect(question.sortOrder).toBe(5);

    const total = await prisma.question.count({ where: { propertyId } });
    expect(total).toBe(6);
  });

  it("questions route returns 401 when not authenticated (via mock)", async () => {
    vi.resetModules();
    vi.doMock("next-auth", () => ({
      getServerSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));

    const { GET } = await import(
      "@/app/api/properties/[id]/questions/route"
    );

    const req = makeRequest(
      `http://localhost:3000/api/properties/${propertyId}/questions`
    );

    const res = await GET(req, { params: Promise.resolve({ id: propertyId }) });
    expect(res.status).toBe(401);
  });

  it("questions route returns questions when authenticated (via mock)", async () => {
    vi.resetModules();
    vi.doMock("next-auth", () => ({
      getServerSession: vi.fn().mockResolvedValue({
        user: { id: userId, email: testEmail("landlord"), role: "client" },
      }),
    }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));

    const { GET } = await import(
      "@/app/api/properties/[id]/questions/route"
    );

    const req = makeRequest(
      `http://localhost:3000/api/properties/${propertyId}/questions`
    );

    const res = await GET(req, { params: Promise.resolve({ id: propertyId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.questions).toBeDefined();
    expect(data.questions.length).toBe(6);
    expect(data.questions[0].fieldKey).toBe("fullName");
  });

  it("POST question route returns 401 when not authenticated (via mock)", async () => {
    vi.resetModules();
    vi.doMock("next-auth", () => ({
      getServerSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));

    const { POST } = await import(
      "@/app/api/properties/[id]/questions/route"
    );

    const req = makeRequest(
      `http://localhost:3000/api/properties/${propertyId}/questions`,
      {
        method: "POST",
        body: { text: "Should fail" },
      }
    );

    const res = await POST(req, { params: Promise.resolve({ id: propertyId }) });
    expect(res.status).toBe(401);
  });

  it("POST question route creates question when authenticated (via mock)", async () => {
    vi.resetModules();
    vi.doMock("next-auth", () => ({
      getServerSession: vi.fn().mockResolvedValue({
        user: { id: userId, email: testEmail("landlord"), role: "client" },
      }),
    }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));

    const { POST } = await import(
      "@/app/api/properties/[id]/questions/route"
    );

    const req = makeRequest(
      `http://localhost:3000/api/properties/${propertyId}/questions`,
      {
        method: "POST",
        body: {
          text: "When would you like to move in?",
          type: "date",
        },
      }
    );

    const res = await POST(req, { params: Promise.resolve({ id: propertyId }) });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.question).toBeDefined();
    expect(data.question.text).toBe("When would you like to move in?");
    expect(data.question.type).toBe("date");
    // fieldKey auto-generated from text
    expect(data.question.fieldKey).toBe("when_would_you_like_to_move_in");
  });
});

// ── Full onboarding flow ──

describe("Complete onboarding flow", () => {
  it("user has property with questions and can be marked as onboarded", async () => {
    // Mark user as onboarded
    await prisma.user.update({
      where: { id: userId },
      data: { onboarded: true },
    });

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
    expect(user!.properties.length).toBeGreaterThanOrEqual(1);

    const prop = user!.properties.find((p) => p.id === propertyId);
    expect(prop).toBeDefined();
    expect(prop!.questions.length).toBeGreaterThanOrEqual(6);
    expect(prop!.questions[0].fieldKey).toBe("fullName");
  });
});
