import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import {
  generateFiveDayNotice,
  generateTenDayNotice,
  generateThirtyDayNotice,
  recordNoticeService,
  generateNoticePdf,
} from "../services/notice-generator.js";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_notgen_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;
let unitId: string;
let tenantId: string;
let leaseId: string;
let noOverdueLeaseId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "NotGen Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
      phone: "(312) 555-0100",
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "NotGen Property",
      address: "400 Notice Blvd, Chicago IL 60611",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const unit = await prisma.unit.create({
    data: { propertyId, unitNumber: "NG-101", monthlyRent: 200000 },
  });
  unitId = unit.id;

  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Alex",
      lastName: "Tenant",
      userId,
    },
  });
  tenantId = tenant.id;

  const lease = await prisma.lease.create({
    data: {
      unitId,
      tenantId,
      monthlyRent: 200000,
      startDate: new Date(2025, 6, 1),
      status: "active",
      rentDueDay: 1,
      lateFeeGraceDays: 5,
    },
  });
  leaseId = lease.id;

  // Overdue charge
  await prisma.rentCharge.create({
    data: {
      leaseId,
      amount: 200000,
      type: "rent",
      forMonth: new Date(2025, 11, 1),
      dueDate: new Date(2025, 11, 1),
      status: "unpaid",
      paidAmount: 0,
    },
  });

  // Lease with no overdue charges
  const unit2 = await prisma.unit.create({
    data: { propertyId, unitNumber: "NG-102", monthlyRent: 100000 },
  });
  const noOverdueLease = await prisma.lease.create({
    data: {
      unitId: unit2.id,
      tenantId,
      monthlyRent: 100000,
      startDate: new Date(2026, 0, 1),
      status: "active",
      rentDueDay: 1,
      lateFeeGraceDays: 5,
    },
  });
  noOverdueLeaseId = noOverdueLease.id;
});

afterAll(async () => {
  await prisma.notice.deleteMany({
    where: { leaseId: { in: [leaseId, noOverdueLeaseId] } },
  });
  await prisma.rentCharge.deleteMany({
    where: { leaseId: { in: [leaseId, noOverdueLeaseId] } },
  });
  await prisma.lease.deleteMany({
    where: { id: { in: [leaseId, noOverdueLeaseId] } },
  });
  await prisma.unit.deleteMany({ where: { propertyId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── 5-Day Notice ──

describe("generateFiveDayNotice", () => {
  it("creates notice with auto-calculated amount from overdue charges", async () => {
    const result = await generateFiveDayNotice({
      leaseId,
      tenantId,
    });

    expect(result.type).toBe("five_day");
    expect(result.content).toContain("FIVE-DAY NOTICE");
    expect(result.content).toContain("735 ILCS 5/9-209");
    expect(result.content).toContain("Alex Tenant");
    expect(result.content).toContain("$2,000.00");
    expect(result.content).toContain("FIVE (5) days");
    expect(result.content).toContain("partial payment does not waive");
    expect(result.content).toContain("400 Notice Blvd");
    expect(result.content).toContain("NG-101");

    // Verify DB record
    const notice = await prisma.notice.findUnique({ where: { id: result.id } });
    expect(notice!.amountOwed).toBe(200000);
    expect(notice!.reason).toBe("non_payment");
  });

  it("uses provided amount if specified", async () => {
    const result = await generateFiveDayNotice({
      leaseId,
      tenantId,
      amountOwed: 100000,
    });

    expect(result.content).toContain("$1,000.00");
  });

  it("rejects when no rent is past due", async () => {
    await expect(
      generateFiveDayNotice({ leaseId: noOverdueLeaseId, tenantId })
    ).rejects.toThrow("no rent is currently past due");
  });
});

// ── 10-Day Notice ──

describe("generateTenDayNotice", () => {
  it("creates notice with violation description", async () => {
    const result = await generateTenDayNotice({
      leaseId,
      tenantId,
      violationDescription: "Unauthorized pet observed on premises on January 15, 2026.",
    });

    expect(result.type).toBe("ten_day");
    expect(result.content).toContain("TEN-DAY NOTICE");
    expect(result.content).toContain("735 ILCS 5/9-210");
    expect(result.content).toContain("Unauthorized pet");
    expect(result.content).toContain("TEN (10) days");
    expect(result.content).toContain("Alex Tenant");
  });

  it("rejects empty violation description", async () => {
    await expect(
      generateTenDayNotice({ leaseId, tenantId, violationDescription: "  " })
    ).rejects.toThrow("Violation description is required");
  });
});

// ── 30-Day Notice ──

describe("generateThirtyDayNotice", () => {
  it("creates notice with valid effective date", async () => {
    const effectiveDate = new Date();
    effectiveDate.setDate(effectiveDate.getDate() + 35);

    const result = await generateThirtyDayNotice({
      leaseId,
      tenantId,
      effectiveDate,
    });

    expect(result.type).toBe("thirty_day");
    expect(result.content).toContain("THIRTY-DAY NOTICE");
    expect(result.content).toContain("735 ILCS 5/9-207");
    expect(result.content).toContain("Alex Tenant");
  });

  it("rejects effective date less than 30 days out", async () => {
    const tooSoon = new Date();
    tooSoon.setDate(tooSoon.getDate() + 15);

    await expect(
      generateThirtyDayNotice({ leaseId, tenantId, effectiveDate: tooSoon })
    ).rejects.toThrow("at least 30 days");
  });
});

// ── Service Tracking ──

describe("recordNoticeService", () => {
  it("records personal service with correct dates", async () => {
    const notice = await generateFiveDayNotice({ leaseId, tenantId });
    const serviceDate = new Date(2026, 1, 10);

    const { effectiveDate, expirationDate } = await recordNoticeService({
      noticeId: notice.id,
      serviceMethod: "personal",
      serviceDate,
      servedBy: "John Server",
    });

    // Personal: effective = service date
    expect(effectiveDate.getTime()).toBe(serviceDate.getTime());
    // 5-day notice: expiration = effective + 5
    const expected = new Date(serviceDate);
    expected.setDate(expected.getDate() + 5);
    expect(expirationDate.getTime()).toBe(expected.getTime());

    // Verify DB
    const dbNotice = await prisma.notice.findUnique({ where: { id: notice.id } });
    expect(dbNotice!.serviceConfirmed).toBe(true);
    expect(dbNotice!.servedBy).toBe("John Server");
  });

  it("records certified mail with 5-day delivery delay", async () => {
    const notice = await generateTenDayNotice({
      leaseId,
      tenantId,
      violationDescription: "Noise violation",
    });
    const serviceDate = new Date(2026, 1, 10);

    const { effectiveDate, expirationDate } = await recordNoticeService({
      noticeId: notice.id,
      serviceMethod: "certified_mail",
      serviceDate,
      servedBy: "USPS",
      certifiedMailTracking: "7020 3440 0001 2345 6789",
    });

    // Certified mail: effective = service + 5 days
    const expectedEffective = new Date(serviceDate);
    expectedEffective.setDate(expectedEffective.getDate() + 5);
    expect(effectiveDate.getTime()).toBe(expectedEffective.getTime());

    // 10-day notice: expiration = effective + 10
    const expectedExpiry = new Date(expectedEffective);
    expectedExpiry.setDate(expectedExpiry.getDate() + 10);
    expect(expirationDate.getTime()).toBe(expectedExpiry.getTime());
  });

  it("rejects certified mail without tracking number", async () => {
    const notice = await generateFiveDayNotice({ leaseId, tenantId });

    await expect(
      recordNoticeService({
        noticeId: notice.id,
        serviceMethod: "certified_mail",
        serviceDate: new Date(),
        servedBy: "USPS",
      })
    ).rejects.toThrow("tracking number is required");
  });
});

// ── PDF Generation ──

describe("generateNoticePdf", () => {
  it("generates a valid PDF buffer for a 5-day notice", async () => {
    const notice = await generateFiveDayNotice({ leaseId, tenantId });
    const pdf = await generateNoticePdf(notice.id);

    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(100);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("generates PDF for 10-day notice", async () => {
    const notice = await generateTenDayNotice({
      leaseId,
      tenantId,
      violationDescription: "PDF test violation",
    });
    const pdf = await generateNoticePdf(notice.id);

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("throws for non-existent notice", async () => {
    await expect(generateNoticePdf("nonexistent")).rejects.toThrow(
      "Notice not found"
    );
  });
});
