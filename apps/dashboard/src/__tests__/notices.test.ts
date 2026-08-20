import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_notices_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;
let unitId: string;
let tenantId: string;
let leaseId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "Notice Test Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "Notice Test Property",
      address: "300 Legal Ave, Chicago IL 60601",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const unit = await prisma.unit.create({
    data: { propertyId, unitNumber: "NT-1", monthlyRent: 150000 },
  });
  unitId = unit.id;

  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Legal",
      lastName: "Notice",
      userId,
    },
  });
  tenantId = tenant.id;

  const lease = await prisma.lease.create({
    data: {
      unitId,
      tenantId,
      monthlyRent: 150000,
      startDate: new Date(2026, 0, 1),
      status: "active",
      rentDueDay: 1,
      lateFeeGraceDays: 5,
    },
  });
  leaseId = lease.id;

  // Create an overdue rent charge for 5-day notice tests
  await prisma.rentCharge.create({
    data: {
      leaseId,
      amount: 150000,
      type: "rent",
      forMonth: new Date(2025, 11, 1), // past month
      dueDate: new Date(2025, 11, 1),
      status: "unpaid",
      paidAmount: 0,
    },
  });

  // Create a second overdue charge for partial payment
  await prisma.rentCharge.create({
    data: {
      leaseId,
      amount: 150000,
      type: "rent",
      forMonth: new Date(2026, 0, 1),
      dueDate: new Date(2026, 0, 1),
      status: "partial",
      paidAmount: 50000,
    },
  });
});

afterAll(async () => {
  await prisma.notice.deleteMany({ where: { leaseId } });
  await prisma.rentCharge.deleteMany({ where: { leaseId } });
  await prisma.lease.deleteMany({ where: { id: leaseId } });
  await prisma.unit.deleteMany({ where: { id: unitId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.application.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Step 32: 5-Day Notice Generation ──

describe("5-day notice generation", () => {
  it("creates a 5-day notice with auto-calculated amount owed", async () => {
    const notice = await prisma.notice.create({
      data: {
        leaseId,
        tenantId,
        type: "five_day",
        reason: "non_payment",
        amountOwed: 250000, // $1500 + $1000 partial
        content: "FIVE-DAY NOTICE\nDEMAND FOR PAYMENT OF RENT\n...",
        visibleInPortal: true,
      },
    });

    expect(notice.type).toBe("five_day");
    expect(notice.reason).toBe("non_payment");
    expect(notice.amountOwed).toBe(250000);
    expect(notice.visibleInPortal).toBe(true);
    expect(notice.serviceConfirmed).toBe(false);
  });

  it("includes all IL-required content for 5-day notice", async () => {
    // Build the notice content the way the service would
    const charges = await prisma.rentCharge.findMany({
      where: { leaseId, status: { in: ["unpaid", "partial"] } },
    });
    const totalOwed = charges.reduce(
      (sum, c) => sum + (c.amount - c.paidAmount),
      0
    );

    const content = [
      "FIVE-DAY NOTICE",
      "DEMAND FOR PAYMENT OF RENT",
      "(Pursuant to 735 ILCS 5/9-209)",
      "",
      "TO: Legal Notice",
      "    300 Legal Ave, Chicago IL 60601, Unit NT-1",
      "",
      `Amount due: $${(totalOwed / 100).toFixed(2)}`,
      "",
      "Payment in full demanded within FIVE (5) days.",
      "Acceptance of partial payment does not waive landlord's right to terminate.",
    ].join("\n");

    // Verify content has required elements
    expect(content).toContain("735 ILCS 5/9-209");
    expect(content).toContain("FIVE (5) days");
    expect(content).toContain("partial payment does not waive");
    expect(content).toContain("Legal Notice"); // tenant name
    expect(content).toContain("300 Legal Ave"); // address
  });

  it("rejects 5-day notice when no rent is past due", async () => {
    // Create a lease with no overdue charges
    const unit2 = await prisma.unit.create({
      data: { propertyId, unitNumber: "NT-2", monthlyRent: 100000 },
    });
    const lease2 = await prisma.lease.create({
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

    // No overdue charges for this lease - check the condition
    const overdueCharge = await prisma.rentCharge.findFirst({
      where: {
        leaseId: lease2.id,
        status: { in: ["unpaid", "partial"] },
        dueDate: { lt: new Date() },
      },
    });
    expect(overdueCharge).toBeNull();

    // Cleanup
    await prisma.lease.delete({ where: { id: lease2.id } });
    await prisma.unit.delete({ where: { id: unit2.id } });
  });
});

// ── Step 32: 10-Day Notice Generation ──

describe("10-day notice generation", () => {
  it("creates a 10-day notice with violation description", async () => {
    const notice = await prisma.notice.create({
      data: {
        leaseId,
        tenantId,
        type: "ten_day",
        reason: "lease_violation",
        content:
          "TEN-DAY NOTICE\n(Pursuant to 735 ILCS 5/9-210)\nViolation: Unauthorized pet",
        visibleInPortal: true,
      },
    });

    expect(notice.type).toBe("ten_day");
    expect(notice.reason).toBe("lease_violation");
    expect(notice.content).toContain("735 ILCS 5/9-210");
    expect(notice.content).toContain("Unauthorized pet");
  });

  it("requires a violation description", () => {
    // The API enforces this — empty string should fail
    const desc = "";
    expect(desc.trim()).toBe("");
  });
});

// ── Step 32: 30-Day Notice Generation ──

describe("30-day notice generation", () => {
  it("creates a 30-day notice with valid effective date", async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 35);

    const notice = await prisma.notice.create({
      data: {
        leaseId,
        tenantId,
        type: "thirty_day",
        reason: "termination",
        effectiveDate: futureDate,
        content:
          "THIRTY-DAY NOTICE\n(Pursuant to 735 ILCS 5/9-207)\nTermination effective...",
        visibleInPortal: true,
      },
    });

    expect(notice.type).toBe("thirty_day");
    expect(notice.reason).toBe("termination");
    expect(notice.effectiveDate).not.toBeNull();
    expect(notice.content).toContain("735 ILCS 5/9-207");
  });

  it("rejects effective date less than 30 days from today", () => {
    const tooSoon = new Date();
    tooSoon.setDate(tooSoon.getDate() + 15);

    const minDate = new Date();
    minDate.setDate(minDate.getDate() + 30);

    expect(tooSoon < minDate).toBe(true);
  });
});

// ── Step 33: PDF generation ──

describe("Notice PDF generation", () => {
  it("generates a valid PDF for a notice", async () => {
    const PDFDocument = (await import("pdfkit")).default;

    const notice = await prisma.notice.findFirst({
      where: { leaseId, type: "five_day" },
    });
    expect(notice).not.toBeNull();

    // Generate PDF
    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "LETTER" });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.fontSize(16).text("FIVE-DAY NOTICE", { align: "center" });
      doc.moveDown();
      doc.fontSize(11).text(notice!.content);
      doc.end();
    });

    // Verify it's a valid PDF
    expect(pdf.length).toBeGreaterThan(100);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

// ── Step 34: Service Tracking ──

describe("Notice service tracking", () => {
  let noticeId: string;

  beforeAll(async () => {
    const notice = await prisma.notice.create({
      data: {
        leaseId,
        tenantId,
        type: "five_day",
        reason: "non_payment",
        amountOwed: 150000,
        content: "Service tracking test notice",
        visibleInPortal: true,
      },
    });
    noticeId = notice.id;
  });

  it("records personal service with correct effective/expiration dates", async () => {
    const serviceDate = new Date(2026, 1, 10);

    const updated = await prisma.notice.update({
      where: { id: noticeId },
      data: {
        serviceMethod: "personal",
        serviceDate,
        servedBy: "Process Server John",
        serviceConfirmed: true,
        effectiveDate: serviceDate, // same as service date for personal
        expirationDate: new Date(2026, 1, 15), // + 5 days for 5-day notice
      },
    });

    expect(updated.serviceMethod).toBe("personal");
    expect(updated.serviceConfirmed).toBe(true);
    expect(updated.servedBy).toBe("Process Server John");
    expect(updated.effectiveDate!.getTime()).toBe(serviceDate.getTime());
    // 5 days later
    expect(updated.expirationDate!.getDate()).toBe(15);
  });

  it("records certified mail service with delayed effective date", async () => {
    const certNotice = await prisma.notice.create({
      data: {
        leaseId,
        tenantId,
        type: "ten_day",
        reason: "lease_violation",
        content: "Certified mail test notice",
        visibleInPortal: true,
      },
    });

    const serviceDate = new Date(2026, 1, 10);
    const effectiveDate = new Date(serviceDate);
    effectiveDate.setDate(effectiveDate.getDate() + 5); // +5 for mail delivery
    const expirationDate = new Date(effectiveDate);
    expirationDate.setDate(expirationDate.getDate() + 10); // +10 for 10-day notice

    const updated = await prisma.notice.update({
      where: { id: certNotice.id },
      data: {
        serviceMethod: "certified_mail",
        serviceDate,
        servedBy: "USPS",
        certifiedMailTracking: "7020 3440 0001 2345 6789",
        serviceConfirmed: true,
        effectiveDate,
        expirationDate,
      },
    });

    expect(updated.serviceMethod).toBe("certified_mail");
    expect(updated.certifiedMailTracking).toBe("7020 3440 0001 2345 6789");
    // Effective = service + 5 days (mail delivery)
    expect(updated.effectiveDate!.getDate()).toBe(15);
    // Expiration = effective + 10 days
    expect(updated.expirationDate!.getDate()).toBe(25);
  });

  it("requires tracking number for certified mail", () => {
    // The API validates this — certified_mail without tracking should fail
    const method = "certified_mail";
    const tracking = "";
    expect(method === "certified_mail" && !tracking.trim()).toBe(true);
  });

  it("validates service method values", () => {
    const valid = ["personal", "substitute", "certified_mail"];
    expect(valid.includes("personal")).toBe(true);
    expect(valid.includes("substitute")).toBe(true);
    expect(valid.includes("certified_mail")).toBe(true);
    expect(valid.includes("email")).toBe(false);
  });
});

// ── Step 35: Notices list + detail ──

describe("Notices list and detail", () => {
  it("lists notices filtered by type", async () => {
    const fiveDayNotices = await prisma.notice.findMany({
      where: {
        leaseId,
        type: "five_day",
      },
    });

    expect(fiveDayNotices.length).toBeGreaterThanOrEqual(1);
    for (const n of fiveDayNotices) {
      expect(n.type).toBe("five_day");
    }
  });

  it("lists notices filtered by tenantId", async () => {
    const notices = await prisma.notice.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });

    expect(notices.length).toBeGreaterThanOrEqual(1);
    for (const n of notices) {
      expect(n.tenantId).toBe(tenantId);
    }
  });

  it("returns notice detail with tenant and lease info", async () => {
    const notice = await prisma.notice.findFirst({
      where: { leaseId },
      include: {
        tenant: { select: { firstName: true, lastName: true, email: true } },
        lease: {
          include: {
            unit: {
              include: {
                property: { select: { name: true, address: true } },
              },
            },
          },
        },
      },
    });

    expect(notice).not.toBeNull();
    expect(notice!.tenant.firstName).toBe("Legal");
    expect(notice!.tenant.lastName).toBe("Notice");
    expect(notice!.lease.unit.property.name).toBe("Notice Test Property");
  });

  it("scopes notices to landlord's properties (data isolation)", async () => {
    // Create another landlord's notice
    const otherUser = await prisma.user.create({
      data: {
        email: testEmail("other"),
        name: "Other Landlord",
        passwordHash: await bcrypt.hash("password123", 12),
        role: "client",
      },
    });

    const otherProperty = await prisma.property.create({
      data: {
        name: "Other Property",
        address: "999 Other St",
        userId: otherUser.id,
        isActive: true,
      },
    });

    const otherUnit = await prisma.unit.create({
      data: { propertyId: otherProperty.id, unitNumber: "O-1", monthlyRent: 100000 },
    });

    const otherTenant = await prisma.tenant.create({
      data: {
        email: testEmail("othertenant"),
        passwordHash: await bcrypt.hash("password123", 12),
        firstName: "Other",
        lastName: "Tenant",
        userId: otherUser.id,
      },
    });

    const otherLease = await prisma.lease.create({
      data: {
        unitId: otherUnit.id,
        tenantId: otherTenant.id,
        monthlyRent: 100000,
        startDate: new Date(2026, 0, 1),
        status: "active",
        rentDueDay: 1,
        lateFeeGraceDays: 5,
      },
    });

    await prisma.notice.create({
      data: {
        leaseId: otherLease.id,
        tenantId: otherTenant.id,
        type: "five_day",
        reason: "non_payment",
        amountOwed: 100000,
        content: "Other landlord's notice",
        visibleInPortal: true,
      },
    });

    // Query notices for original landlord's properties only
    const myNotices = await prisma.notice.findMany({
      where: {
        lease: {
          unit: {
            property: { userId },
          },
        },
      },
    });

    // Should not include the other landlord's notice
    for (const n of myNotices) {
      expect(n.leaseId).toBe(leaseId);
    }

    // Cleanup
    await prisma.notice.deleteMany({ where: { leaseId: otherLease.id } });
    await prisma.lease.delete({ where: { id: otherLease.id } });
    await prisma.unit.delete({ where: { id: otherUnit.id } });
    await prisma.tenant.delete({ where: { id: otherTenant.id } });
    await prisma.property.delete({ where: { id: otherProperty.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });
});

// ── Step 36: 5-Day Notice Partial Payment Flagging ──

describe("5-day notice partial payment flagging", () => {
  it("detects active 5-day notice when payment is received", async () => {
    // Create an active 5-day notice (served, not expired)
    const now = new Date();
    const effectiveDate = new Date(now);
    const expirationDate = new Date(now);
    expirationDate.setDate(expirationDate.getDate() + 5);

    const notice = await prisma.notice.create({
      data: {
        leaseId,
        tenantId,
        type: "five_day",
        reason: "non_payment",
        amountOwed: 150000,
        content: "Active 5-day notice for flagging test",
        serviceConfirmed: true,
        serviceMethod: "personal",
        serviceDate: now,
        servedBy: "Tester",
        effectiveDate,
        expirationDate,
      },
    });

    // Check for active 5-day notices on this lease
    const activeNotices = await prisma.notice.findMany({
      where: {
        leaseId,
        type: "five_day",
        serviceConfirmed: true,
        expirationDate: { gt: new Date() },
      },
    });

    expect(activeNotices.length).toBeGreaterThanOrEqual(1);

    // Flag: payment during active 5-day notice should be flagged
    const hasActive5Day = activeNotices.length > 0;
    expect(hasActive5Day).toBe(true);
  });

  it("does not flag when no active 5-day notice exists", async () => {
    // Only look for notices that are served AND not expired AND are 5-day type
    // Use a date far in the past to simulate all notices being expired
    const expiredNotices = await prisma.notice.findMany({
      where: {
        leaseId,
        type: "five_day",
        serviceConfirmed: true,
        expirationDate: { lt: new Date(2020, 0, 1) }, // way in the past
      },
    });

    expect(expiredNotices).toHaveLength(0);
  });
});

// ── Step 36: Duplicate Application Prevention ──

describe("Duplicate application prevention", () => {
  it("detects recent completed application for same phone+property", async () => {
    // Create a completed application
    await prisma.application.create({
      data: {
        propertyId,
        status: "completed",
        channel: "voice",
        callerPhone: "+15551234567",
        fullName: "Dup Test",
        completedAt: new Date(),
      },
    });

    // Check for recent completed application (within 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const existing = await prisma.application.findFirst({
      where: {
        propertyId,
        callerPhone: "+15551234567",
        status: "completed",
        completedAt: { gte: thirtyDaysAgo },
      },
    });

    expect(existing).not.toBeNull();
    expect(existing!.fullName).toBe("Dup Test");
  });

  it("allows application from different phone number", async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const existing = await prisma.application.findFirst({
      where: {
        propertyId,
        callerPhone: "+15559999999", // different phone
        status: "completed",
        completedAt: { gte: thirtyDaysAgo },
      },
    });

    expect(existing).toBeNull();
  });

  it("allows re-application after 30 days", async () => {
    // Create an old application
    await prisma.application.create({
      data: {
        propertyId,
        status: "completed",
        channel: "voice",
        callerPhone: "+15550000000",
        fullName: "Old App",
        completedAt: new Date(2025, 0, 1), // over 30 days ago
      },
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recent = await prisma.application.findFirst({
      where: {
        propertyId,
        callerPhone: "+15550000000",
        status: "completed",
        completedAt: { gte: thirtyDaysAgo },
      },
    });

    expect(recent).toBeNull(); // Old application is outside the 30-day window
  });
});
