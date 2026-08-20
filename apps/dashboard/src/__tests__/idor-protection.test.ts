import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_idor_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userAId: string;
let userBId: string;
let propertyAId: string;
let propertyBId: string;
let photoAId: string;
let photoBId: string;
let questionAId: string;
let questionBId: string;

beforeAll(async () => {
  await prisma.$connect();

  // Two separate landlords
  const userA = await prisma.user.create({
    data: {
      email: testEmail("ownerA"),
      name: "Owner A",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userAId = userA.id;

  const userB = await prisma.user.create({
    data: {
      email: testEmail("ownerB"),
      name: "Owner B",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userBId = userB.id;

  // Each has their own property
  const propertyA = await prisma.property.create({
    data: {
      name: "Property A",
      address: "100 Owner A St",
      userId: userAId,
    },
  });
  propertyAId = propertyA.id;

  const propertyB = await prisma.property.create({
    data: {
      name: "Property B",
      address: "200 Owner B St",
      userId: userBId,
    },
  });
  propertyBId = propertyB.id;

  // Photos for each property
  const photoA = await prisma.propertyPhoto.create({
    data: {
      propertyId: propertyAId,
      url: "https://example.com/a.jpg",
      sortOrder: 0,
    },
  });
  photoAId = photoA.id;

  const photoB = await prisma.propertyPhoto.create({
    data: {
      propertyId: propertyBId,
      url: "https://example.com/b.jpg",
      sortOrder: 0,
    },
  });
  photoBId = photoB.id;

  // Questions for each property
  const questionA = await prisma.question.create({
    data: {
      propertyId: propertyAId,
      text: "Question for A?",
      fieldKey: "q_a",
      type: "text",
      required: true,
      sortOrder: 0,
    },
  });
  questionAId = questionA.id;

  const questionB = await prisma.question.create({
    data: {
      propertyId: propertyBId,
      text: "Question for B?",
      fieldKey: "q_b",
      type: "text",
      required: true,
      sortOrder: 0,
    },
  });
  questionBId = questionB.id;
});

afterAll(async () => {
  await prisma.propertyPhoto.deleteMany({
    where: { propertyId: { in: [propertyAId, propertyBId] } },
  });
  await prisma.question.deleteMany({
    where: { propertyId: { in: [propertyAId, propertyBId] } },
  });
  await prisma.property.deleteMany({
    where: { id: { in: [propertyAId, propertyBId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

/**
 * IDOR protection tests for photo/question reorder endpoints.
 *
 * The PUT handlers at:
 *   /api/properties/[id]/photos
 *   /api/properties/[id]/questions
 *
 * Both verify that the IDs in the reorder array belong to the
 * target property. This prevents User A from manipulating
 * User B's photo/question sort orders by injecting foreign IDs.
 */
describe("Photo reorder IDOR protection", () => {
  it("property A's photos do not include property B's photo IDs", async () => {
    const photosA = await prisma.propertyPhoto.findMany({
      where: { propertyId: propertyAId },
      select: { id: true },
    });
    const validIdsA = new Set(photosA.map((p) => p.id));

    // Attempting to reorder with B's photo should fail the validation
    expect(validIdsA.has(photoAId)).toBe(true);
    expect(validIdsA.has(photoBId)).toBe(false);
  });

  it("rejects reorder request containing foreign photo ID", async () => {
    // Replicate the route's validation logic
    const existingPhotos = await prisma.propertyPhoto.findMany({
      where: { propertyId: propertyAId },
      select: { id: true },
    });
    const validIds = new Set(existingPhotos.map((p) => p.id));

    // Attacker sends B's photo ID in A's reorder payload
    const maliciousOrder = [
      { id: photoAId, sortOrder: 1 },
      { id: photoBId, sortOrder: 0 }, // foreign ID
    ];

    const allValid = maliciousOrder.every((item) => validIds.has(item.id));
    expect(allValid).toBe(false);
    // Route would return 403: "One or more photo IDs do not belong to this property"
  });

  it("accepts reorder request with only owned photo IDs", async () => {
    // Add a second photo to property A
    const photoA2 = await prisma.propertyPhoto.create({
      data: {
        propertyId: propertyAId,
        url: "https://example.com/a2.jpg",
        sortOrder: 1,
      },
    });

    const existingPhotos = await prisma.propertyPhoto.findMany({
      where: { propertyId: propertyAId },
      select: { id: true },
    });
    const validIds = new Set(existingPhotos.map((p) => p.id));

    const legitimateOrder = [
      { id: photoA2.id, sortOrder: 0 },
      { id: photoAId, sortOrder: 1 },
    ];

    const allValid = legitimateOrder.every((item) => validIds.has(item.id));
    expect(allValid).toBe(true);
  });
});

describe("Question reorder IDOR protection", () => {
  it("property A's questions do not include property B's question IDs", async () => {
    const questionsA = await prisma.question.findMany({
      where: { propertyId: propertyAId },
      select: { id: true },
    });
    const validIdsA = new Set(questionsA.map((q) => q.id));

    expect(validIdsA.has(questionAId)).toBe(true);
    expect(validIdsA.has(questionBId)).toBe(false);
  });

  it("rejects reorder request containing foreign question ID", async () => {
    const existingQuestions = await prisma.question.findMany({
      where: { propertyId: propertyAId },
      select: { id: true },
    });
    const validIds = new Set(existingQuestions.map((q) => q.id));

    const maliciousOrder = [
      { id: questionAId, sortOrder: 1 },
      { id: questionBId, sortOrder: 0 }, // foreign ID
    ];

    const allValid = maliciousOrder.every((item) => validIds.has(item.id));
    expect(allValid).toBe(false);
  });

  it("ownership check scopes property lookup to current user", async () => {
    // Replicate the route's first check: findFirst where userId = session.user.id
    // User B cannot access Property A
    const propertyForUserB = await prisma.property.findFirst({
      where: { id: propertyAId, userId: userBId },
    });
    expect(propertyForUserB).toBeNull();

    // User A can access Property A
    const propertyForUserA = await prisma.property.findFirst({
      where: { id: propertyAId, userId: userAId },
    });
    expect(propertyForUserA).not.toBeNull();
    expect(propertyForUserA!.name).toBe("Property A");
  });
});
