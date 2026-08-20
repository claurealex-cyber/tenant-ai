import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_payments_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let otherUserId: string;
let propertyId: string;
let unitId: string;
let tenantId: string;
let leaseId: string;
let otherPropertyId: string;
let otherUnitId: string;
let otherLeaseId: string;
let otherTenantId: string;

beforeAll(async () => {
  await prisma.$connect();

  // Landlord
  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "Payment Test Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  // Other landlord
  const otherUser = await prisma.user.create({
    data: {
      email: testEmail("other"),
      name: "Other Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
    },
  });
  otherUserId = otherUser.id;

  // Properties
  const property = await prisma.property.create({
    data: {
      name: "Payment Property",
      address: "100 Pay St",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const otherProperty = await prisma.property.create({
    data: {
      name: "Other Property",
      address: "200 Other St",
      userId: otherUserId,
      isActive: true,
    },
  });
  otherPropertyId = otherProperty.id;

  // Units
  const unit = await prisma.unit.create({
    data: { propertyId, unitNumber: "PAY-101", monthlyRent: 150000 },
  });
  unitId = unit.id;

  const otherUnit = await prisma.unit.create({
    data: {
      propertyId: otherPropertyId,
      unitNumber: "PAY-201",
      monthlyRent: 120000,
    },
  });
  otherUnitId = otherUnit.id;

  // Tenants
  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Pay",
      lastName: "Tester",
      userId,
    },
  });
  tenantId = tenant.id;

  const otherTenant = await prisma.tenant.create({
    data: {
      email: testEmail("othertenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Other",
      lastName: "Tenant",
      userId: otherUserId,
    },
  });
  otherTenantId = otherTenant.id;

  // Leases
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

  const otherLease = await prisma.lease.create({
    data: {
      unitId: otherUnitId,
      tenantId: otherTenantId,
      monthlyRent: 120000,
      startDate: new Date(2026, 0, 1),
      status: "active",
      rentDueDay: 1,
      lateFeeGraceDays: 5,
    },
  });
  otherLeaseId = otherLease.id;

  // Create rent charges
  await prisma.rentCharge.createMany({
    data: [
      {
        leaseId,
        amount: 150000,
        type: "rent",
        forMonth: new Date(2026, 0, 1),
        dueDate: new Date(2026, 0, 1),
        status: "unpaid",
        paidAmount: 0,
      },
      {
        leaseId,
        amount: 150000,
        type: "rent",
        forMonth: new Date(2026, 1, 1),
        dueDate: new Date(2026, 1, 1),
        status: "unpaid",
        paidAmount: 0,
      },
      {
        leaseId,
        amount: 5000,
        type: "late_fee",
        forMonth: new Date(2026, 0, 1),
        dueDate: new Date(2026, 0, 7),
        status: "unpaid",
        paidAmount: 0,
      },
    ],
  });

  // Create some existing payments for listing test
  await prisma.payment.createMany({
    data: [
      {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "ach",
        status: "completed",
        forMonth: new Date(2025, 11, 1),
        paidAt: new Date(2025, 11, 1),
      },
      {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "card",
        status: "completed",
        forMonth: new Date(2025, 10, 1),
        paidAt: new Date(2025, 10, 1),
      },
      // Other user's payment (should NOT be visible)
      {
        leaseId: otherLeaseId,
        tenantId: otherTenantId,
        amount: 120000,
        type: "rent",
        method: "ach",
        status: "completed",
        paidAt: new Date(2025, 11, 1),
      },
    ],
  });
});

afterAll(async () => {
  await prisma.payment.deleteMany({
    where: { leaseId: { in: [leaseId, otherLeaseId] } },
  });
  await prisma.rentCharge.deleteMany({
    where: { leaseId: { in: [leaseId, otherLeaseId] } },
  });
  await prisma.lease.deleteMany({
    where: { id: { in: [leaseId, otherLeaseId] } },
  });
  await prisma.unit.deleteMany({
    where: { id: { in: [unitId, otherUnitId] } },
  });
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantId, otherTenantId] } },
  });
  await prisma.property.deleteMany({
    where: { id: { in: [propertyId, otherPropertyId] } },
  });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Payment Listing ──

describe("Payment listing (data isolation)", () => {
  it("returns only payments for user's properties", async () => {
    const payments = await prisma.payment.findMany({
      where: {
        lease: {
          unit: {
            property: { userId },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    expect(payments.length).toBe(2);
    for (const p of payments) {
      expect(p.leaseId).toBe(leaseId);
    }
  });

  it("does NOT include other user's payments", async () => {
    const payments = await prisma.payment.findMany({
      where: {
        lease: {
          unit: {
            property: { userId },
          },
        },
      },
    });

    const amounts = payments.map((p) => p.amount);
    expect(amounts).not.toContain(120000); // Other user's payment
  });

  it("filters by method", async () => {
    const achPayments = await prisma.payment.findMany({
      where: {
        lease: { unit: { property: { userId } } },
        method: "ach",
      },
    });

    expect(achPayments.length).toBe(1);
    expect(achPayments[0].method).toBe("ach");
  });

  it("filters by lease", async () => {
    const payments = await prisma.payment.findMany({
      where: {
        leaseId,
        lease: { unit: { property: { userId } } },
      },
    });

    expect(payments.length).toBe(2);
  });
});

// ── Offline Payment Recording ──

describe("Record offline payment (cash/check)", () => {
  it("creates cash payment and applies to oldest RentCharge (FIFO)", async () => {
    // Record a $1,500 cash payment
    const payment = await prisma.payment.create({
      data: {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "cash",
        status: "completed",
        description: "Cash payment",
        forMonth: new Date(2026, 0, 1),
        paidAt: new Date(),
      },
    });

    expect(payment.method).toBe("cash");
    expect(payment.status).toBe("completed");
    expect(payment.stripePaymentId).toBeNull();

    // Apply FIFO
    const charges = await prisma.rentCharge.findMany({
      where: {
        leaseId,
        status: { in: ["unpaid", "partial"] },
      },
      orderBy: { dueDate: "asc" },
    });

    // Apply $1500 to oldest charge first
    let remaining = 150000;
    for (const charge of charges) {
      if (remaining <= 0) break;
      const owed = charge.amount - charge.paidAmount;
      const toApply = Math.min(remaining, owed);
      const newPaidAmount = charge.paidAmount + toApply;
      const newStatus =
        newPaidAmount >= charge.amount ? "paid" : "partial";

      await prisma.rentCharge.update({
        where: { id: charge.id },
        data: { paidAmount: newPaidAmount, status: newStatus },
      });
      remaining -= toApply;
    }

    // Jan rent charge ($1500) should be fully paid
    const janCharge = await prisma.rentCharge.findFirst({
      where: { leaseId, type: "rent", forMonth: new Date(2026, 0, 1) },
    });
    expect(janCharge!.status).toBe("paid");
    expect(janCharge!.paidAmount).toBe(150000);
  });

  it("creates check payment", async () => {
    const payment = await prisma.payment.create({
      data: {
        leaseId,
        tenantId,
        amount: 5000,
        type: "late_fee",
        method: "check",
        status: "completed",
        description: "Check payment for late fee",
        paidAt: new Date(),
      },
    });

    expect(payment.method).toBe("check");
    expect(payment.status).toBe("completed");

    // Apply to late fee charge
    const lateFeeCharge = await prisma.rentCharge.findFirst({
      where: { leaseId, type: "late_fee" },
    });

    if (lateFeeCharge && lateFeeCharge.status !== "paid") {
      await prisma.rentCharge.update({
        where: { id: lateFeeCharge.id },
        data: { paidAmount: 5000, status: "paid" },
      });
    }

    const updatedCharge = await prisma.rentCharge.findFirst({
      where: { leaseId, type: "late_fee" },
    });
    expect(updatedCharge!.status).toBe("paid");
  });

  it("offline payment has null stripePaymentId", async () => {
    const payments = await prisma.payment.findMany({
      where: {
        leaseId,
        method: { in: ["cash", "check"] },
      },
    });

    for (const p of payments) {
      expect(p.stripePaymentId).toBeNull();
    }
  });
});

// ── Overdue Tenants ──

describe("Overdue tenants query", () => {
  it("finds tenants with unpaid RentCharges past due date", async () => {
    // Feb charge is still unpaid
    const overdueCharges = await prisma.rentCharge.findMany({
      where: {
        status: { in: ["unpaid", "partial"] },
        dueDate: { lt: new Date() },
        lease: {
          unit: {
            property: { userId },
          },
        },
      },
      include: {
        lease: {
          select: {
            tenantId: true,
            tenant: { select: { firstName: true, lastName: true } },
            unit: {
              select: {
                unitNumber: true,
                property: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { amount: "desc" },
    });

    // Feb rent charge should be overdue
    expect(overdueCharges.length).toBeGreaterThanOrEqual(1);

    // Each overdue charge should be from our user's properties
    for (const charge of overdueCharges) {
      expect(charge.lease.tenant).toBeDefined();
      expect(charge.lease.unit.property.name).toBe("Payment Property");
    }
  });

  it("does NOT include other user's overdue charges", async () => {
    const overdueCharges = await prisma.rentCharge.findMany({
      where: {
        status: { in: ["unpaid", "partial"] },
        lease: {
          unit: {
            property: { userId },
          },
        },
      },
    });

    for (const charge of overdueCharges) {
      expect(charge.leaseId).not.toBe(otherLeaseId);
    }
  });
});
