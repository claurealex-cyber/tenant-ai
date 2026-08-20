import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { calculateLateFees } from "../services/late-fees.js";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_latefees_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;
let cookCountyPropertyId: string;
let unitId: string;
let cookCountyUnitId: string;
let tenantId: string;
let leaseId: string;
let cookCountyLeaseId: string;
let noFeeLeaseId: string;
let noFeeUnitId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "LateFee Test Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  // Regular property
  const property = await prisma.property.create({
    data: {
      name: "LateFee Property",
      address: "100 Late St, Springfield IL 62701",
      userId,
      isActive: true,
      cookCounty: false,
    },
  });
  propertyId = property.id;

  // Cook County property
  const cookCountyProperty = await prisma.property.create({
    data: {
      name: "Cook County LateFee Property",
      address: "200 Chicago Ave, Chicago IL 60601",
      userId,
      isActive: true,
      cookCounty: true,
    },
  });
  cookCountyPropertyId = cookCountyProperty.id;

  // Units
  const unit = await prisma.unit.create({
    data: { propertyId, unitNumber: "LF-101", monthlyRent: 150000 },
  });
  unitId = unit.id;

  const cookCountyUnit = await prisma.unit.create({
    data: {
      propertyId: cookCountyPropertyId,
      unitNumber: "LF-CC-201",
      monthlyRent: 150000,
    },
  });
  cookCountyUnitId = cookCountyUnit.id;

  const noFeeUnit = await prisma.unit.create({
    data: { propertyId, unitNumber: "LF-NF-301", monthlyRent: 100000 },
  });
  noFeeUnitId = noFeeUnit.id;

  // Tenant
  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Late",
      lastName: "Payer",
      userId,
    },
  });
  tenantId = tenant.id;

  // Lease with late fee: $50, 5-day grace
  const lease = await prisma.lease.create({
    data: {
      unitId,
      tenantId,
      monthlyRent: 150000,
      startDate: new Date(2026, 0, 1),
      status: "active",
      rentDueDay: 1,
      lateFeeAmount: 5000, // $50
      lateFeeGraceDays: 5,
    },
  });
  leaseId = lease.id;

  // Cook County lease with excessive late fee ($200 — exceeds Cook County cap)
  const cookCountyLease = await prisma.lease.create({
    data: {
      unitId: cookCountyUnitId,
      tenantId,
      monthlyRent: 150000,
      startDate: new Date(2026, 0, 1),
      status: "active",
      rentDueDay: 1,
      lateFeeAmount: 20000, // $200 — above cap
      lateFeeGraceDays: 5,
    },
  });
  cookCountyLeaseId = cookCountyLease.id;

  // Lease with no late fee (lateFeeAmount = null)
  const noFeeLease = await prisma.lease.create({
    data: {
      unitId: noFeeUnitId,
      tenantId,
      monthlyRent: 100000,
      startDate: new Date(2026, 0, 1),
      status: "active",
      rentDueDay: 1,
      lateFeeAmount: null,
      lateFeeGraceDays: 5,
    },
  });
  noFeeLeaseId = noFeeLease.id;

  // Create overdue rent charges (due Jan 1, we'll test with date after grace)
  const forMonth = new Date(2026, 0, 1);
  const dueDate = new Date(2026, 0, 1);

  await prisma.rentCharge.createMany({
    data: [
      {
        leaseId,
        amount: 150000,
        type: "rent",
        forMonth,
        dueDate,
        status: "unpaid",
        paidAmount: 0,
      },
      {
        leaseId: cookCountyLeaseId,
        amount: 150000,
        type: "rent",
        forMonth,
        dueDate,
        status: "unpaid",
        paidAmount: 0,
      },
      {
        leaseId: noFeeLeaseId,
        amount: 100000,
        type: "rent",
        forMonth,
        dueDate,
        status: "unpaid",
        paidAmount: 0,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.rentCharge.deleteMany({
    where: {
      leaseId: { in: [leaseId, cookCountyLeaseId, noFeeLeaseId] },
    },
  });
  await prisma.lease.deleteMany({
    where: { id: { in: [leaseId, cookCountyLeaseId, noFeeLeaseId] } },
  });
  await prisma.unit.deleteMany({
    where: { id: { in: [unitId, cookCountyUnitId, noFeeUnitId] } },
  });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.property.deleteMany({
    where: { id: { in: [propertyId, cookCountyPropertyId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("calculateLateFees", () => {
  it("does NOT create late fee before grace period expires", async () => {
    // Jan 5 — still within 5-day grace period (due Jan 1 + 5 days grace = Jan 6)
    const jan5 = new Date(2026, 0, 5);
    const created = await calculateLateFees(jan5);
    expect(created).toBe(0);

    const lateFees = await prisma.rentCharge.findMany({
      where: { leaseId, type: "late_fee" },
    });
    expect(lateFees).toHaveLength(0);
  });

  it("creates late fee after grace period expires (day 6)", async () => {
    // Jan 7 — grace period ended (due Jan 1 + 5 days = Jan 6)
    const jan7 = new Date(2026, 0, 7);
    const created = await calculateLateFees(jan7);

    // Should create fees for leaseId and cookCountyLeaseId
    // NOT for noFeeLeaseId (no lateFeeAmount)
    expect(created).toBe(2);
  });

  it("creates correct late fee amount for regular property", async () => {
    const lateFee = await prisma.rentCharge.findFirst({
      where: { leaseId, type: "late_fee" },
    });

    expect(lateFee).not.toBeNull();
    expect(lateFee!.amount).toBe(5000); // $50
    expect(lateFee!.type).toBe("late_fee");
    expect(lateFee!.description).toContain("Late fee");
  });

  it("enforces Cook County RTLO late fee cap", async () => {
    const lateFee = await prisma.rentCharge.findFirst({
      where: { leaseId: cookCountyLeaseId, type: "late_fee" },
    });

    expect(lateFee).not.toBeNull();

    // Cook County cap for $1,500 rent: $10 + 5% of $500 = $10 + $25 = $35
    const expectedCap = 3500; // $35.00
    expect(lateFee!.amount).toBe(expectedCap);
    // The configured fee was $200 (20000 cents) — should be capped
    expect(lateFee!.amount).toBeLessThan(20000);
  });

  it("does NOT create late fee when lateFeeAmount is null", async () => {
    const lateFees = await prisma.rentCharge.findMany({
      where: { leaseId: noFeeLeaseId, type: "late_fee" },
    });

    expect(lateFees).toHaveLength(0);
  });

  it("is idempotent — running twice does not create duplicate late fees", async () => {
    const jan8 = new Date(2026, 0, 8);
    const created = await calculateLateFees(jan8);
    expect(created).toBe(0); // Already created

    const lateFees = await prisma.rentCharge.findMany({
      where: { leaseId, type: "late_fee" },
    });
    expect(lateFees).toHaveLength(1);
  });

  it("does NOT create late fee for terminated lease", async () => {
    // Create a terminated lease with overdue charge
    const termUnit = await prisma.unit.create({
      data: { propertyId, unitNumber: "LF-TERM", monthlyRent: 100000 },
    });
    const termLease = await prisma.lease.create({
      data: {
        unitId: termUnit.id,
        tenantId,
        monthlyRent: 100000,
        startDate: new Date(2026, 0, 1),
        status: "terminated",
        rentDueDay: 1,
        lateFeeAmount: 5000,
        lateFeeGraceDays: 5,
      },
    });

    await prisma.rentCharge.create({
      data: {
        leaseId: termLease.id,
        amount: 100000,
        type: "rent",
        forMonth: new Date(2026, 0, 1),
        dueDate: new Date(2026, 0, 1),
        status: "unpaid",
        paidAmount: 0,
      },
    });

    const jan10 = new Date(2026, 0, 10);
    const created = await calculateLateFees(jan10);
    // Should only be 0 (terminated leases skipped; other fees already created)
    expect(created).toBe(0);

    const lateFees = await prisma.rentCharge.findMany({
      where: { leaseId: termLease.id, type: "late_fee" },
    });
    expect(lateFees).toHaveLength(0);

    // Cleanup
    await prisma.rentCharge.deleteMany({ where: { leaseId: termLease.id } });
    await prisma.lease.delete({ where: { id: termLease.id } });
    await prisma.unit.delete({ where: { id: termUnit.id } });
  });
});
