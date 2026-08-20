import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import {
  recordUsage,
  getUserMonthlyUsage,
  getBillingMonth,
  estimateVoiceCallCostCents,
  estimateSmsCostCents,
} from "../services/usage-tracking.js";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_usage_${Date.now()}`;

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
      name: "Usage Test Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "Usage Test Property",
      address: "400 Usage Ave, Chicago IL 60601",
      userId,
    },
  });
  propertyId = property.id;
});

afterAll(async () => {
  await prisma.usageRecord.deleteMany({
    where: { userId },
  });
  await prisma.property.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── getBillingMonth ──

describe("getBillingMonth", () => {
  it("returns first day of current month", () => {
    const now = new Date();
    const billingMonth = getBillingMonth(now);

    expect(billingMonth.getFullYear()).toBe(now.getFullYear());
    expect(billingMonth.getMonth()).toBe(now.getMonth());
    expect(billingMonth.getDate()).toBe(1);
    expect(billingMonth.getHours()).toBe(0);
    expect(billingMonth.getMinutes()).toBe(0);
  });

  it("works for specific date", () => {
    const date = new Date(2026, 5, 15); // June 15, 2026
    const billingMonth = getBillingMonth(date);

    expect(billingMonth.getFullYear()).toBe(2026);
    expect(billingMonth.getMonth()).toBe(5); // June
    expect(billingMonth.getDate()).toBe(1);
  });
});

// ── Cost Estimation ──

describe("estimateVoiceCallCostCents", () => {
  it("estimates cost for a short call", () => {
    // 1 minute call → ~33 cents
    const cost = estimateVoiceCallCostCents(60);
    expect(cost).toBe(33);
  });

  it("estimates cost for an 8-minute call", () => {
    // 8 minutes → ~264 cents ($2.64)
    const cost = estimateVoiceCallCostCents(8 * 60);
    expect(cost).toBe(264);
  });

  it("estimates cost for a 15-minute call", () => {
    // 15 minutes → ~495 cents ($4.95)
    const cost = estimateVoiceCallCostCents(15 * 60);
    expect(cost).toBe(495);
  });

  it("returns 0 for zero duration", () => {
    const cost = estimateVoiceCallCostCents(0);
    expect(cost).toBe(0);
  });
});

describe("estimateSmsCostCents", () => {
  it("returns minimum 1 cent with defaults", () => {
    const cost = estimateSmsCostCents();
    expect(cost).toBeGreaterThanOrEqual(1);
  });

  it("returns minimum 1 cent for small token counts", () => {
    const cost = estimateSmsCostCents(100, 50);
    expect(cost).toBe(1);
  });

  it("increases with more tokens", () => {
    const small = estimateSmsCostCents(500, 100);
    const large = estimateSmsCostCents(500000, 100000);
    expect(large).toBeGreaterThan(small);
  });
});

// ── recordUsage ──

describe("recordUsage", () => {
  it("creates a voice_call usage record", async () => {
    const id = await recordUsage({
      userId,
      propertyId,
      type: "voice_call",
      costCents: 264,
      durationSeconds: 480,
      metadata: { callSid: "CA_test_1", reconnectCount: 0 },
    });

    expect(id).toBeDefined();

    const record = await prisma.usageRecord.findUnique({
      where: { id },
    });

    expect(record).not.toBeNull();
    expect(record!.userId).toBe(userId);
    expect(record!.propertyId).toBe(propertyId);
    expect(record!.type).toBe("voice_call");
    expect(record!.costCents).toBe(264);
    expect(record!.durationSeconds).toBe(480);
    expect(record!.quantity).toBe(1);
    expect(record!.billingMonth.getDate()).toBe(1);
  });

  it("creates an sms usage record", async () => {
    const id = await recordUsage({
      userId,
      propertyId,
      type: "sms",
      costCents: 1,
      metadata: { callerPhone: "+13125550001" },
    });

    const record = await prisma.usageRecord.findUnique({
      where: { id },
    });

    expect(record!.type).toBe("sms");
    expect(record!.costCents).toBe(1);
    expect(record!.durationSeconds).toBeNull();
  });

  it("creates a web_app usage record with zero cost", async () => {
    const id = await recordUsage({
      userId,
      propertyId,
      type: "web_app",
    });

    const record = await prisma.usageRecord.findUnique({
      where: { id },
    });

    expect(record!.type).toBe("web_app");
    expect(record!.costCents).toBe(0);
  });

  it("creates a website_visit usage record", async () => {
    const id = await recordUsage({
      userId,
      type: "website_visit",
    });

    const record = await prisma.usageRecord.findUnique({
      where: { id },
    });

    expect(record!.type).toBe("website_visit");
    expect(record!.costCents).toBe(0);
    expect(record!.propertyId).toBeNull();
  });

  it("sets billingMonth to first of current month", async () => {
    const id = await recordUsage({
      userId,
      type: "sms",
      costCents: 1,
    });

    const record = await prisma.usageRecord.findUnique({
      where: { id },
    });

    const now = new Date();
    expect(record!.billingMonth.getFullYear()).toBe(now.getFullYear());
    expect(record!.billingMonth.getMonth()).toBe(now.getMonth());
    expect(record!.billingMonth.getDate()).toBe(1);
  });

  it("defaults quantity to 1", async () => {
    const id = await recordUsage({
      userId,
      type: "sms",
      costCents: 1,
    });

    const record = await prisma.usageRecord.findUnique({
      where: { id },
    });

    expect(record!.quantity).toBe(1);
  });
});

// ── getUserMonthlyUsage ──

describe("getUserMonthlyUsage", () => {
  it("returns total cost and breakdown by type", async () => {
    const result = await getUserMonthlyUsage(userId);

    expect(result.totalCostCents).toBeGreaterThan(0);
    expect(result.byType["voice_call"]).toBeDefined();
    expect(result.byType["sms"]).toBeDefined();
  });

  it("returns zero for user with no usage", async () => {
    const result = await getUserMonthlyUsage("nonexistent_user_id");

    expect(result.totalCostCents).toBe(0);
    expect(Object.keys(result.byType).length).toBe(0);
  });

  it("returns zero for different billing month", async () => {
    // Use a past month that should have no records
    const pastMonth = new Date(2020, 0, 1);
    const result = await getUserMonthlyUsage(userId, pastMonth);

    expect(result.totalCostCents).toBe(0);
  });

  it("correctly sums multiple records", async () => {
    // Clear existing records and create known amounts
    await prisma.usageRecord.deleteMany({ where: { userId } });

    await recordUsage({
      userId,
      type: "voice_call",
      costCents: 100,
    });
    await recordUsage({
      userId,
      type: "voice_call",
      costCents: 200,
    });
    await recordUsage({
      userId,
      type: "sms",
      costCents: 5,
    });

    const result = await getUserMonthlyUsage(userId);

    expect(result.totalCostCents).toBe(305);
    expect(result.byType["voice_call"]).toBe(300);
    expect(result.byType["sms"]).toBe(5);
  });
});
