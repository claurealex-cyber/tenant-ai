import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import {
  saveApplicationField,
  completeApplication,
  getPropertyInfo,
  findOrCreateApplication,
  getFilledFields,
} from "../handlers/application-builder.js";
import { decrypt } from "@tenant-ai/shared";

// Set PII encryption key for tests (64-char hex = 32 bytes)
const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.PII_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

const prisma = new PrismaClient();

const TEST_PREFIX = `test_appbuild_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;
let applicationId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "App Builder Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "Test Property",
      address: "100 Test Ave, Chicago IL 60601",
      description: "Great place with nice views",
      amenities: ["Parking", "Laundry"],
      userId,
    },
  });
  propertyId = property.id;

  // Create a vacant unit for property info tests
  await prisma.unit.create({
    data: {
      propertyId,
      unitNumber: "101",
      bedrooms: 2,
      bathrooms: 1,
      sqft: 850,
      monthlyRent: 150000,
      status: "vacant",
    },
  });

  const app = await prisma.application.create({
    data: {
      propertyId,
      callerPhone: "+13125550001",
      channel: "voice",
      status: "in_progress",
    },
  });
  applicationId = app.id;
});

afterAll(async () => {
  await prisma.application.deleteMany({
    where: { propertyId },
  });
  await prisma.unit.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── save_application_field ──

describe("saveApplicationField", () => {
  it("saves a plain text field (fullName)", async () => {
    const result = await saveApplicationField(
      applicationId,
      "fullName",
      "John Smith",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    expect(app!.fullName).toBe("John Smith");
  });

  it("validates and saves SSN — encrypts before storage", async () => {
    const result = await saveApplicationField(
      applicationId,
      "ssn",
      "123-45-6789",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    // Value should be encrypted (starts with v1:)
    expect(app!.ssn).toMatch(/^v1:/);
    // Decrypt should return the formatted SSN
    expect(decrypt(app!.ssn!)).toBe("123-45-6789");
  });

  it("validates and auto-formats SSN (no dashes)", async () => {
    const result = await saveApplicationField(
      applicationId,
      "ssn",
      "123456789",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    expect(decrypt(app!.ssn!)).toBe("123-45-6789");
  });

  it("rejects invalid SSN (too few digits)", async () => {
    const result = await saveApplicationField(
      applicationId,
      "ssn",
      "12345",
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("9 digits");
  });

  it("validates and encrypts date of birth", async () => {
    const result = await saveApplicationField(
      applicationId,
      "dateOfBirth",
      "March 5, 1990",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    expect(app!.dateOfBirth).toMatch(/^v1:/);
    expect(decrypt(app!.dateOfBirth!)).toBe("1990-03-05");
  });

  it("rejects future date of birth", async () => {
    const result = await saveApplicationField(
      applicationId,
      "dateOfBirth",
      "March 5, 2030",
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("validates email", async () => {
    const result = await saveApplicationField(
      applicationId,
      "email",
      "John@Example.com",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    // Email should be normalized to lowercase
    expect(app!.email).toBe("john@example.com");
  });

  it("rejects invalid email", async () => {
    const result = await saveApplicationField(
      applicationId,
      "email",
      "notanemail",
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("valid email");
  });

  it("validates and formats employer phone", async () => {
    const result = await saveApplicationField(
      applicationId,
      "employerPhone",
      "(312) 555-0100",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    expect(app!.employerPhone).toBe("+13125550100");
  });

  it("parses and saves monthly income", async () => {
    const result = await saveApplicationField(
      applicationId,
      "monthlyIncome",
      "about 5k",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    expect(app!.monthlyIncome).toBe("5000");
  });

  it("parses income with dollar sign and commas", async () => {
    const result = await saveApplicationField(
      applicationId,
      "monthlyIncome",
      "$3,500/month",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    expect(app!.monthlyIncome).toBe("3500");
  });

  it("saves move-in date (future date)", async () => {
    // Always ~60 days out so the test never rots into the past. Build the ISO
    // string from LOCAL date parts — toISOString() is UTC and disagrees with
    // toLocaleDateString for a few hours every evening (UTC-boundary flake).
    const future = new Date(Date.now() + 60 * 86_400_000);
    const iso = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
    const pretty = future.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const result = await saveApplicationField(applicationId, "moveInDate", pretty);
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    expect(app!.moveInDate).toBe(iso);
  });

  it("rejects past move-in date", async () => {
    const result = await saveApplicationField(
      applicationId,
      "moveInDate",
      "January 1, 2020",
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("future");
  });

  it("saves hasPets as boolean true", async () => {
    const result = await saveApplicationField(
      applicationId,
      "hasPets",
      "yes, I have a dog",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    expect(app!.hasPets).toBe(true);
  });

  it("saves hasPets as boolean false", async () => {
    const result = await saveApplicationField(
      applicationId,
      "hasPets",
      "no",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    expect(app!.hasPets).toBe(false);
  });

  it("saves custom field to customResponses JSON", async () => {
    const result = await saveApplicationField(
      applicationId,
      "felonies",
      "no",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    const custom = app!.customResponses as Record<string, string>;
    expect(custom.felonies).toBe("no");
  });

  it("saves plain text field without validator (currentAddress)", async () => {
    const result = await saveApplicationField(
      applicationId,
      "currentAddress",
      "123 Main St, Chicago IL",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    expect(app!.currentAddress).toBe("123 Main St, Chicago IL");
  });

  it("saves plain text field without validator (employer)", async () => {
    const result = await saveApplicationField(
      applicationId,
      "employer",
      "Acme Corp",
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    expect(app!.employer).toBe("Acme Corp");
  });
});

// ── complete_application ──

describe("completeApplication", () => {
  it("marks application as completed with summary", async () => {
    // Create a fresh application for this test
    const app = await prisma.application.create({
      data: {
        propertyId,
        callerPhone: "+13125550099",
        channel: "voice",
        status: "in_progress",
      },
    });

    await completeApplication(
      app.id,
      "Good candidate with stable income.",
    );

    const updated = await prisma.application.findUnique({
      where: { id: app.id },
    });
    expect(updated!.status).toBe("completed");
    expect(updated!.completedAt).toBeDefined();
    expect(updated!.reviewNotes).toBe(
      "Good candidate with stable income.",
    );
  });
});

// ── get_property_info ──

describe("getPropertyInfo", () => {
  it("returns property name and address", async () => {
    const info = await getPropertyInfo(propertyId);
    expect(info).toContain("Test Property");
    expect(info).toContain("100 Test Ave");
  });

  it("includes description", async () => {
    const info = await getPropertyInfo(propertyId);
    expect(info).toContain("Great place with nice views");
  });

  it("includes amenities", async () => {
    const info = await getPropertyInfo(propertyId);
    expect(info).toContain("Parking");
    expect(info).toContain("Laundry");
  });

  it("includes vacant units with rent", async () => {
    const info = await getPropertyInfo(propertyId);
    expect(info).toContain("Unit 101");
    expect(info).toContain("$1,500.00");
    expect(info).toContain("2BR");
  });

  it("returns fallback for non-existent property", async () => {
    const info = await getPropertyInfo("nonexistent_id");
    expect(info).toContain("not available");
  });
});

// ── findOrCreateApplication ──

describe("findOrCreateApplication", () => {
  it("creates a new application if none exists", async () => {
    const result = await findOrCreateApplication(
      propertyId,
      "+13125559999",
      "sms",
    );
    expect(result.isResume).toBe(false);
    expect(result.application.channel).toBe("sms");
    expect(result.application.status).toBe("in_progress");
  });

  it("resumes existing in-progress application", async () => {
    // The one we just created
    const result = await findOrCreateApplication(
      propertyId,
      "+13125559999",
      "sms",
    );
    expect(result.isResume).toBe(true);
    expect(result.application.status).toBe("in_progress");
  });

  it("creates new if existing app is too old", async () => {
    // Create an old in-progress app
    const oldApp = await prisma.application.create({
      data: {
        propertyId,
        callerPhone: "+13125558888",
        channel: "voice",
        status: "in_progress",
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      },
    });

    const result = await findOrCreateApplication(
      propertyId,
      "+13125558888",
      "voice",
    );
    expect(result.isResume).toBe(false);
    expect(result.application.id).not.toBe(oldApp.id);
  });
});

// ── getFilledFields ──

describe("getFilledFields", () => {
  it("returns filled standard fields", async () => {
    const fields = await getFilledFields(applicationId);
    expect(fields.fullName).toBe("John Smith");
    expect(fields.email).toBe("john@example.com");
    expect(fields.employer).toBe("Acme Corp");
    expect(fields.currentAddress).toBe("123 Main St, Chicago IL");
  });

  it("shows encrypted fields as [provided]", async () => {
    const fields = await getFilledFields(applicationId);
    expect(fields.ssn).toBe("[provided]");
    expect(fields.dateOfBirth).toBe("[provided]");
  });

  it("includes hasPets as Yes/No", async () => {
    const fields = await getFilledFields(applicationId);
    // We last set it to false
    expect(fields.hasPets).toBe("No");
  });

  it("includes custom responses", async () => {
    const fields = await getFilledFields(applicationId);
    expect(fields.felonies).toBe("no");
  });

  it("returns empty object for non-existent application", async () => {
    const fields = await getFilledFields("nonexistent_id");
    expect(Object.keys(fields).length).toBe(0);
  });
});

// ── AI Answer Validation integration ──

describe("saveApplicationField with AI validation", () => {
  it("does NOT call AI validator when questionContext is omitted (backward compat)", async () => {
    const { validateFieldWithAI } = await import("../services/ai-field-validator.js");
    const spy = vi.spyOn(
      await import("../services/ai-field-validator.js"),
      "validateFieldWithAI",
    );

    const result = await saveApplicationField(
      applicationId,
      "fullName",
      "Jane Doe",
    );
    expect(result.success).toBe(true);
    // No questionContext → AI validator should not be called
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("calls AI validator when questionContext is provided and field is eligible", async () => {
    const mod = await import("../services/ai-field-validator.js");
    const spy = vi.spyOn(mod, "validateFieldWithAI").mockResolvedValue({ valid: true });

    const result = await saveApplicationField(
      applicationId,
      "fullName",
      "Jane Doe",
      { questionText: "What is your full name?", questionType: "text" },
    );
    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalledWith({
      fieldKey: "fullName",
      value: "Jane Doe",
      questionText: "What is your full name?",
      questionType: "text",
    });
    spy.mockRestore();
  });

  it("returns AI validation error when validator rejects", async () => {
    const mod = await import("../services/ai-field-validator.js");
    const spy = vi.spyOn(mod, "validateFieldWithAI").mockResolvedValue({
      valid: false,
      reason: "Please provide your last name as well.",
    });

    const result = await saveApplicationField(
      applicationId,
      "fullName",
      "John",
      { questionText: "What is your full name?", questionType: "text" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("Please provide your last name as well.");
    spy.mockRestore();
  });

  it("saves normally when AI validator approves", async () => {
    const mod = await import("../services/ai-field-validator.js");
    const spy = vi.spyOn(mod, "validateFieldWithAI").mockResolvedValue({ valid: true });

    const result = await saveApplicationField(
      applicationId,
      "currentAddress",
      "456 Oak St, Chicago IL 60602",
      { questionText: "What is your current address?", questionType: "text" },
    );
    expect(result.success).toBe(true);

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });
    expect(app!.currentAddress).toBe("456 Oak St, Chicago IL 60602");
    spy.mockRestore();
  });
});
