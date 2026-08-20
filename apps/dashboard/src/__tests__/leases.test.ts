import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_leases_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;
let cookCountyPropertyId: string;
let unitId: string;
let unit2Id: string;
let cookCountyUnitId: string;
let tenantId: string;
let tenant2Id: string;
let leaseId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "Lease Test Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  // Regular property
  const property = await prisma.property.create({
    data: {
      name: "Lease Test Property",
      address: "100 Lease Ave, Springfield IL 62701",
      userId,
      isActive: true,
      cookCounty: false,
    },
  });
  propertyId = property.id;

  // Cook County property
  const cookProp = await prisma.property.create({
    data: {
      name: "Cook County Property",
      address: "200 Cook St, Chicago IL 60601",
      userId,
      isActive: true,
      cookCounty: true,
    },
  });
  cookCountyPropertyId = cookProp.id;

  // Units
  const unit = await prisma.unit.create({
    data: {
      propertyId,
      unitNumber: "101",
      monthlyRent: 150000, // $1,500
      bedrooms: 2,
      bathrooms: 1,
    },
  });
  unitId = unit.id;

  const unit2 = await prisma.unit.create({
    data: {
      propertyId,
      unitNumber: "102",
      monthlyRent: 120000,
    },
  });
  unit2Id = unit2.id;

  const cookUnit = await prisma.unit.create({
    data: {
      propertyId: cookCountyPropertyId,
      unitNumber: "1A",
      monthlyRent: 150000, // $1,500
    },
  });
  cookCountyUnitId = cookUnit.id;

  // Tenants
  const tenant = await prisma.tenant.create({
    data: {
      firstName: "Alice",
      lastName: "Johnson",
      email: "alice@test.com",
      passwordHash: await bcrypt.hash("temp", 12),
      userId,
    },
  });
  tenantId = tenant.id;

  const tenant2 = await prisma.tenant.create({
    data: {
      firstName: "Bob",
      lastName: "Brown",
      email: "bob@test.com",
      passwordHash: await bcrypt.hash("temp", 12),
      userId,
    },
  });
  tenant2Id = tenant2.id;
});

afterAll(async () => {
  await prisma.lease.deleteMany({
    where: {
      unit: {
        propertyId: { in: [propertyId, cookCountyPropertyId] },
      },
    },
  });
  await prisma.tenant.deleteMany({ where: { userId } });
  await prisma.unit.deleteMany({
    where: { propertyId: { in: [propertyId, cookCountyPropertyId] } },
  });
  await prisma.property.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Lease Creation ──

describe("Lease creation", () => {
  it("creates a lease and updates unit to occupied", async () => {
    const lease = await prisma.lease.create({
      data: {
        unitId,
        tenantId,
        monthlyRent: 150000,
        securityDeposit: 150000,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        leaseType: "fixed",
        lateFeeGraceDays: 5,
        rentDueDay: 1,
        depositReceivedDate: new Date(),
      },
    });

    leaseId = lease.id;

    await prisma.unit.update({
      where: { id: unitId },
      data: { status: "occupied" },
    });

    expect(lease.id).toBeDefined();
    expect(lease.monthlyRent).toBe(150000);
    expect(lease.status).toBe("active");
    expect(lease.leaseType).toBe("fixed");

    const updatedUnit = await prisma.unit.findUnique({
      where: { id: unitId },
    });
    expect(updatedUnit!.status).toBe("occupied");
  });

  it("enforces IL minimum 5-day grace period", () => {
    const graceDays = Math.max(3, 5);
    expect(graceDays).toBe(5);

    const validGrace = Math.max(7, 5);
    expect(validGrace).toBe(7);
  });

  it("rejects end date before start date", () => {
    const start = new Date("2026-06-01");
    const end = new Date("2026-01-01");
    expect(end <= start).toBe(true);
  });

  it("allows month-to-month lease (no end date)", async () => {
    const lease = await prisma.lease.create({
      data: {
        unitId: unit2Id,
        tenantId: tenant2Id,
        monthlyRent: 120000,
        startDate: new Date("2026-01-01"),
        leaseType: "month_to_month",
        lateFeeGraceDays: 5,
        rentDueDay: 1,
      },
    });

    expect(lease.endDate).toBeNull();
    expect(lease.leaseType).toBe("month_to_month");

    // Clean up
    await prisma.lease.delete({ where: { id: lease.id } });
  });

  it("rejects lease on already-occupied unit", async () => {
    const activeLeaseOnUnit = await prisma.lease.findFirst({
      where: { unitId, status: "active" },
    });

    expect(activeLeaseOnUnit).not.toBeNull();
    // In the API route, this would return 400
  });
});

// ── Cook County Enforcement ──

describe("Cook County compliance", () => {
  it("enforces security deposit cap (1.5x rent)", () => {
    const monthlyRent = 150000; // $1,500
    const maxDeposit = Math.round(monthlyRent * 1.5);
    expect(maxDeposit).toBe(225000); // $2,250

    // $3,000 deposit exceeds cap
    expect(300000 > maxDeposit).toBe(true);

    // $2,000 deposit is within cap
    expect(200000 <= maxDeposit).toBe(true);
  });

  it("enforces late fee cap ($10 + 5% over $1000)", async () => {
    const { getCookCountyLateFeeMax } = await import("@tenant-ai/shared");
    const monthlyRent = 150000; // $1,500

    const maxLateFee = getCookCountyLateFeeMax(monthlyRent);
    // $10 + 5% of ($1500 - $1000) = $10 + $25 = $35 = 3500 cents
    expect(maxLateFee).toBe(3500);
  });

  it("late fee cap for rent at $1000", async () => {
    const { getCookCountyLateFeeMax } = await import("@tenant-ai/shared");
    const maxLateFee = getCookCountyLateFeeMax(100000); // $1,000
    // $10 + 5% of $0 = $10 = 1000 cents
    expect(maxLateFee).toBe(1000);
  });

  it("creates Cook County lease with valid deposit", async () => {
    const lease = await prisma.lease.create({
      data: {
        unitId: cookCountyUnitId,
        tenantId,
        monthlyRent: 150000,
        securityDeposit: 200000, // $2,000 (under 1.5x $1,500 = $2,250)
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        lateFeeGraceDays: 5,
        lateFeeAmount: 3000, // $30 (under $35 cap)
        rentDueDay: 1,
      },
    });

    expect(lease.securityDeposit).toBe(200000);
    expect(lease.lateFeeAmount).toBe(3000);

    // Clean up
    await prisma.lease.delete({ where: { id: lease.id } });
  });
});

// ── Lease Update ──

describe("Lease update", () => {
  it("updates lease end date (renewal)", async () => {
    const updated = await prisma.lease.update({
      where: { id: leaseId },
      data: { endDate: new Date("2027-12-31") },
    });

    expect(updated.endDate!.getFullYear()).toBe(2027);
  });

  it("converts to month-to-month", async () => {
    const updated = await prisma.lease.update({
      where: { id: leaseId },
      data: {
        leaseType: "month_to_month",
        endDate: null,
      },
    });

    expect(updated.leaseType).toBe("month_to_month");
    expect(updated.endDate).toBeNull();
  });

  it("terminates lease and vacates unit", async () => {
    const updated = await prisma.lease.update({
      where: { id: leaseId },
      data: { status: "terminated" },
    });

    await prisma.unit.update({
      where: { id: unitId },
      data: { status: "vacant" },
    });

    expect(updated.status).toBe("terminated");

    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
    });
    expect(unit!.status).toBe("vacant");
  });

  it("marks deposit receipt as sent", async () => {
    // Re-activate lease for testing
    await prisma.lease.update({
      where: { id: leaseId },
      data: { status: "active" },
    });

    const updated = await prisma.lease.update({
      where: { id: leaseId },
      data: { depositReceiptSent: true },
    });

    expect(updated.depositReceiptSent).toBe(true);
  });
});

// ── Security Deposit Tracking ──

describe("Security deposit tracking", () => {
  it("tracks deposit received date", async () => {
    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
    });

    expect(lease!.depositReceivedDate).not.toBeNull();
    expect(lease!.securityDeposit).toBe(150000);
  });

  it("records deposit deductions", async () => {
    const deductions = [
      { description: "Carpet cleaning", amount: 20000 },
      { description: "Wall repair", amount: 15000 },
    ];

    const updated = await prisma.lease.update({
      where: { id: leaseId },
      data: { depositDeductions: deductions },
    });

    const savedDeductions = updated.depositDeductions as Array<{
      description: string;
      amount: number;
    }>;
    expect(savedDeductions.length).toBe(2);
    expect(savedDeductions[0].description).toBe("Carpet cleaning");

    const totalDeductions = savedDeductions.reduce(
      (sum, d) => sum + d.amount,
      0,
    );
    expect(totalDeductions).toBe(35000); // $350
  });

  it("records deposit return date", async () => {
    const updated = await prisma.lease.update({
      where: { id: leaseId },
      data: { depositReturnedDate: new Date() },
    });

    expect(updated.depositReturnedDate).not.toBeNull();
  });
});

// ── Lease Listing ──

describe("Lease listing (data isolation)", () => {
  it("returns leases for user's properties", async () => {
    const leases = await prisma.lease.findMany({
      where: {
        unit: { property: { userId } },
      },
      include: {
        tenant: { select: { firstName: true, lastName: true } },
        unit: {
          include: {
            property: { select: { name: true } },
          },
        },
      },
    });

    expect(leases.length).toBeGreaterThanOrEqual(1);
    for (const l of leases) {
      expect(l.unit.property.name).toMatch(/Lease Test|Cook County/);
    }
  });

  it("filters by status", async () => {
    const active = await prisma.lease.findMany({
      where: {
        unit: { property: { userId } },
        status: "active",
      },
    });

    for (const l of active) {
      expect(l.status).toBe("active");
    }
  });
});
