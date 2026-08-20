import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_deplease_${Date.now()}`;

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
      name: "Deposit Test Landlord",
      companyName: "Test Properties",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "Deposit Test Prop",
      address: "100 Deposit St, Chicago IL 60601",
      userId,
      isActive: true,
      cookCounty: true,
    },
  });
  propertyId = property.id;

  const unit = await prisma.unit.create({
    data: {
      propertyId,
      unitNumber: "D1",
      monthlyRent: 150000,
      status: "occupied",
    },
  });
  unitId = unit.id;

  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Deposit",
      lastName: "Tester",
      userId,
    },
  });
  tenantId = tenant.id;

  const lease = await prisma.lease.create({
    data: {
      unitId,
      tenantId,
      monthlyRent: 150000,
      securityDeposit: 150000,
      startDate: new Date(2025, 0, 1),
      endDate: new Date(2026, 0, 1),
      leaseType: "fixed",
      status: "active",
      rentDueDay: 1,
      depositReceivedDate: new Date(),
      depositHoldingBank: "First National Bank",
      depositHoldingAddress: "200 Bank St, Chicago IL 60601",
    },
  });
  leaseId = lease.id;
});

afterAll(async () => {
  await prisma.rentCharge.deleteMany({ where: { leaseId } });
  await prisma.lease.deleteMany({ where: { unitId } });
  await prisma.tenant.deleteMany({ where: { userId } });
  await prisma.unit.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
  await prisma.$disconnect();
});

// ── Deposit Lifecycle (Step 56) ──

describe("Deposit lifecycle", () => {
  it("generates deposit receipt with bank info", async () => {
    const { generateDepositReceipt } = await import(
      "../services/deposit-lifecycle.js"
    );
    const result = await generateDepositReceipt(leaseId);

    expect(result.pdfBuffer).toBeInstanceOf(Buffer);
    expect(result.pdfBuffer.length).toBeGreaterThan(0);

    // Verify receipt sent flag updated
    const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
    expect(lease!.depositReceiptSent).toBe(true);

    // Reset for other tests
    await prisma.lease.update({
      where: { id: leaseId },
      data: { depositReceiptSent: false },
    });
  });

  it("throws when lease has no deposit", async () => {
    const noDepositLease = await prisma.lease.create({
      data: {
        unitId,
        tenantId,
        monthlyRent: 150000,
        startDate: new Date(2025, 6, 1),
        endDate: new Date(2026, 6, 1),
        leaseType: "fixed",
        status: "active",
        rentDueDay: 1,
      },
    });

    const { generateDepositReceipt } = await import(
      "../services/deposit-lifecycle.js"
    );
    await expect(generateDepositReceipt(noDepositLease.id)).rejects.toThrow(
      "No security deposit"
    );

    await prisma.lease.delete({ where: { id: noDepositLease.id } });
  });

  it("calculates deposit interest for Cook County landlord with 6+ units", async () => {
    // Create 5 more units to reach Cook County threshold of 6
    const extraUnits = [];
    for (let i = 2; i <= 6; i++) {
      const u = await prisma.unit.create({
        data: { propertyId, unitNumber: `D${i}`, monthlyRent: 100000 },
      });
      extraUnits.push(u.id);
    }

    const { calculateLeaseDepositInterest } = await import(
      "../services/deposit-lifecycle.js"
    );
    const result = await calculateLeaseDepositInterest(leaseId);

    expect(result.required).toBe(true);
    expect(result.interestCents).toBeGreaterThan(0);
    // 1% of $1,500 deposit = $15.00 = 1500 cents
    expect(result.interestCents).toBe(1500);

    // Cleanup extra units
    for (const id of extraUnits) {
      await prisma.unit.delete({ where: { id } });
    }
  });

  it("does not require interest for small landlord", async () => {
    // With only 1 unit (D1), neither threshold met
    const { calculateLeaseDepositInterest } = await import(
      "../services/deposit-lifecycle.js"
    );
    const result = await calculateLeaseDepositInterest(leaseId);

    expect(result.required).toBe(false);
    expect(result.interestCents).toBe(0);
  });

  it("calculates deposit return amount with deductions", async () => {
    // Add deductions
    await prisma.lease.update({
      where: { id: leaseId },
      data: {
        depositDeductions: [
          { description: "Carpet cleaning", amount: 20000 },
          { description: "Wall repair", amount: 15000 },
        ],
      },
    });

    const { calculateDepositReturn } = await import(
      "../services/deposit-lifecycle.js"
    );
    const result = await calculateDepositReturn(leaseId);

    expect(result.originalDeposit).toBe(150000);
    expect(result.totalDeductions).toBe(35000); // $200 + $150
    // Return = deposit + interest (0, small landlord) - deductions
    expect(result.returnAmount).toBe(115000);

    // Reset
    await prisma.lease.update({
      where: { id: leaseId },
      data: { depositDeductions: Prisma.DbNull },
    });
  });

  it("checks deposit receipt deadline alerts", async () => {
    const { checkDepositDeadlines } = await import(
      "../services/deposit-lifecycle.js"
    );

    // Our lease has deposit but receipt not sent
    const alerts = await checkDepositDeadlines();
    const receiptAlerts = alerts.filter(
      (a) => a.leaseId === leaseId && a.type === "receipt_due"
    );

    expect(receiptAlerts.length).toBe(1);
    expect(receiptAlerts[0].daysRemaining).toBeLessThanOrEqual(10);
  });

  it("checks statement/return deadlines after move-out", async () => {
    // Set move-out date to 10 days ago
    const moveOut = new Date();
    moveOut.setDate(moveOut.getDate() - 10);

    await prisma.lease.update({
      where: { id: leaseId },
      data: { moveOutDate: moveOut, status: "terminated" },
    });

    const { checkDepositDeadlines } = await import(
      "../services/deposit-lifecycle.js"
    );
    const alerts = await checkDepositDeadlines();

    const statementAlerts = alerts.filter(
      (a) => a.leaseId === leaseId && a.type === "statement_due"
    );
    expect(statementAlerts.length).toBe(1);
    expect(statementAlerts[0].daysRemaining).toBe(20); // 30 - 10

    const returnAlerts = alerts.filter(
      (a) => a.leaseId === leaseId && a.type === "return_due"
    );
    expect(returnAlerts.length).toBe(1);
    expect(returnAlerts[0].daysRemaining).toBe(35); // 45 - 10

    // Restore lease status
    await prisma.lease.update({
      where: { id: leaseId },
      data: { moveOutDate: null, status: "active" },
    });
  });

  it("sends deposit reminders via notification service", async () => {
    const { clearSentNotifications, getSentNotifications } = await import(
      "../services/notifications.js"
    );
    const { sendDepositReminders } = await import(
      "../services/deposit-lifecycle.js"
    );

    clearSentNotifications();
    const sent = await sendDepositReminders();

    expect(sent).toBeGreaterThanOrEqual(1);
    const notifications = getSentNotifications();
    const depositNotifs = notifications.filter((n) => n.type === "deposit_reminder");
    expect(depositNotifs.length).toBeGreaterThanOrEqual(1);
    expect(depositNotifs[0].subject).toContain("Deposit");

    clearSentNotifications();
  });
});

// ── Lease Expiration Monitoring (Step 57) ──

describe("Lease expiration monitoring", () => {
  let expiringLeaseId: string;
  let expiredLeaseId: string;
  let extraTenantId: string;
  let extraUnitId1: string;
  let extraUnitId2: string;

  beforeAll(async () => {
    // Create extra tenants and units for expiration tests
    const tenant2 = await prisma.tenant.create({
      data: {
        email: testEmail("tenant2"),
        passwordHash: await bcrypt.hash("pass", 12),
        firstName: "Expiring",
        lastName: "Tenant",
        userId,
      },
    });
    extraTenantId = tenant2.id;

    const u1 = await prisma.unit.create({
      data: { propertyId, unitNumber: "EXP1", monthlyRent: 100000, status: "occupied" },
    });
    extraUnitId1 = u1.id;

    const u2 = await prisma.unit.create({
      data: { propertyId, unitNumber: "EXP2", monthlyRent: 100000, status: "occupied" },
    });
    extraUnitId2 = u2.id;

    // Create lease expiring in 15 days
    const fifteenDays = new Date();
    fifteenDays.setDate(fifteenDays.getDate() + 15);
    const expiring = await prisma.lease.create({
      data: {
        unitId: extraUnitId1,
        tenantId: extraTenantId,
        monthlyRent: 100000,
        startDate: new Date(2025, 0, 1),
        endDate: fifteenDays,
        leaseType: "fixed",
        status: "active",
        rentDueDay: 1,
      },
    });
    expiringLeaseId = expiring.id;

    // Create lease that expired yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const expired = await prisma.lease.create({
      data: {
        unitId: extraUnitId2,
        tenantId,
        monthlyRent: 100000,
        startDate: new Date(2025, 0, 1),
        endDate: yesterday,
        leaseType: "fixed",
        status: "active",
        rentDueDay: 1,
      },
    });
    expiredLeaseId = expired.id;
  });

  afterAll(async () => {
    await prisma.lease.deleteMany({
      where: { id: { in: [expiringLeaseId, expiredLeaseId] } },
    });
    await prisma.unit.deleteMany({
      where: { id: { in: [extraUnitId1, extraUnitId2] } },
    });
    await prisma.tenant.deleteMany({ where: { id: extraTenantId } });
  });

  it("sends reminders and auto-converts expired leases in one pass", async () => {
    const { clearSentNotifications, getSentNotifications } = await import(
      "../services/notifications.js"
    );
    const { checkLeaseExpirations } = await import(
      "../services/lease-expiration.js"
    );

    clearSentNotifications();
    const result = await checkLeaseExpirations();

    // Should have sent at least 1 reminder (for lease expiring in 15 days)
    expect(result.reminders).toBeGreaterThanOrEqual(1);

    // Should have auto-converted at least 1 expired lease
    expect(result.autoConverted).toBeGreaterThanOrEqual(1);

    // Verify expiring lease notification
    const notifs = getSentNotifications();
    const expiringNotifs = notifs.filter(
      (n) => n.type === "lease_expiring" && n.subject.includes("expires in")
    );
    expect(expiringNotifs.length).toBeGreaterThanOrEqual(1);

    // Verify auto-conversion notification
    const convertedNotifs = notifs.filter(
      (n) => n.type === "lease_expiring" && n.subject.includes("auto-converted")
    );
    expect(convertedNotifs.length).toBeGreaterThanOrEqual(1);

    // Verify expired lease updated in DB
    const lease = await prisma.lease.findUnique({ where: { id: expiredLeaseId } });
    expect(lease!.leaseType).toBe("month_to_month");
    expect(lease!.endDate).toBeNull();

    clearSentNotifications();
  });

  it("renews a lease with new end date", async () => {
    const { renewLease } = await import("../services/lease-expiration.js");
    const newEnd = new Date(2027, 11, 31);

    await renewLease(expiringLeaseId, newEnd);

    const lease = await prisma.lease.findUnique({ where: { id: expiringLeaseId } });
    expect(lease!.endDate!.toISOString().slice(0, 10)).toBe("2027-12-31");
    expect(lease!.leaseType).toBe("fixed");
  });

  it("terminates a lease and vacates unit", async () => {
    const { terminateLease } = await import("../services/lease-expiration.js");

    await terminateLease(expiringLeaseId, new Date());

    const lease = await prisma.lease.findUnique({ where: { id: expiringLeaseId } });
    expect(lease!.status).toBe("terminated");
    expect(lease!.moveOutDate).not.toBeNull();

    const unit = await prisma.unit.findUnique({ where: { id: extraUnitId1 } });
    expect(unit!.status).toBe("vacant");
  });

  it("throws when renewing a terminated lease", async () => {
    const { renewLease } = await import("../services/lease-expiration.js");
    await expect(
      renewLease(expiringLeaseId, new Date(2028, 0, 1))
    ).rejects.toThrow("Only active leases can be renewed");
  });
});
