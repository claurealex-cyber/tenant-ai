import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import {
  postRentCharges,
  applyPaymentToCharges,
  getLeaseBalance,
} from "../services/rent-charges.js";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_rentcharges_${Date.now()}`;

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
let lease2Id: string;
let monthToMonthLeaseId: string;
let terminatedLeaseId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "RentCharge Test Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  // Regular property
  const property = await prisma.property.create({
    data: {
      name: "RentCharge Property",
      address: "100 Rent St, Springfield IL 62701",
      userId,
      isActive: true,
      cookCounty: false,
    },
  });
  propertyId = property.id;

  // Cook County property
  const cookCountyProperty = await prisma.property.create({
    data: {
      name: "Cook County Property",
      address: "200 Chicago Ave, Chicago IL 60601",
      userId,
      isActive: true,
      cookCounty: true,
    },
  });
  cookCountyPropertyId = cookCountyProperty.id;

  // Units
  const unit = await prisma.unit.create({
    data: { propertyId, unitNumber: "RC-101", monthlyRent: 150000 },
  });
  unitId = unit.id;

  const unit2 = await prisma.unit.create({
    data: { propertyId, unitNumber: "RC-102", monthlyRent: 120000 },
  });
  unit2Id = unit2.id;

  const cookCountyUnit = await prisma.unit.create({
    data: {
      propertyId: cookCountyPropertyId,
      unitNumber: "CC-201",
      monthlyRent: 180000,
    },
  });
  cookCountyUnitId = cookCountyUnit.id;

  // Tenants
  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant1"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Rent",
      lastName: "Tester",
      userId,
    },
  });
  tenantId = tenant.id;

  const tenant2 = await prisma.tenant.create({
    data: {
      email: testEmail("tenant2"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Second",
      lastName: "Tester",
      userId,
    },
  });
  tenant2Id = tenant2.id;

  const today = new Date();

  // Active lease: due on today's day of month
  const lease = await prisma.lease.create({
    data: {
      unitId,
      tenantId,
      monthlyRent: 150000,
      startDate: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      leaseType: "fixed",
      status: "active",
      rentDueDay: today.getDate(),
      lateFeeGraceDays: 5,
    },
  });
  leaseId = lease.id;

  // Second active lease: due on a different day (15th)
  const otherDueDay = today.getDate() === 15 ? 20 : 15;
  const lease2 = await prisma.lease.create({
    data: {
      unitId: unit2Id,
      tenantId: tenant2Id,
      monthlyRent: 120000,
      startDate: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      leaseType: "fixed",
      status: "active",
      rentDueDay: otherDueDay,
      lateFeeGraceDays: 5,
    },
  });
  lease2Id = lease2.id;

  // Month-to-month lease: due on today
  const mtmLease = await prisma.lease.create({
    data: {
      unitId: cookCountyUnitId,
      tenantId,
      monthlyRent: 180000,
      startDate: new Date(today.getFullYear(), today.getMonth() - 3, 1),
      leaseType: "month_to_month",
      status: "active",
      rentDueDay: today.getDate(),
      lateFeeGraceDays: 5,
    },
  });
  monthToMonthLeaseId = mtmLease.id;

  // Terminated lease: due on today (should NOT get charges)
  const termLease = await prisma.lease.create({
    data: {
      unitId: unit2Id,
      tenantId: tenant2Id,
      monthlyRent: 120000,
      startDate: new Date(today.getFullYear(), today.getMonth() - 6, 1),
      leaseType: "fixed",
      status: "terminated",
      rentDueDay: today.getDate(),
      lateFeeGraceDays: 5,
    },
  });
  terminatedLeaseId = termLease.id;
});

afterAll(async () => {
  // Clean up in reverse dependency order
  await prisma.rentCharge.deleteMany({
    where: {
      leaseId: {
        in: [leaseId, lease2Id, monthToMonthLeaseId, terminatedLeaseId],
      },
    },
  });
  await prisma.lease.deleteMany({
    where: {
      id: {
        in: [leaseId, lease2Id, monthToMonthLeaseId, terminatedLeaseId],
      },
    },
  });
  await prisma.unit.deleteMany({
    where: { id: { in: [unitId, unit2Id, cookCountyUnitId] } },
  });
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantId, tenant2Id] } },
  });
  await prisma.property.deleteMany({
    where: { id: { in: [propertyId, cookCountyPropertyId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── postRentCharges ──

describe("postRentCharges", () => {
  it("creates RentCharge for active leases with matching rentDueDay", async () => {
    const today = new Date();
    const created = await postRentCharges(today);

    // Should create charges for leaseId and monthToMonthLeaseId (both due today)
    // NOT for lease2Id (different due day) or terminatedLeaseId (terminated)
    expect(created).toBe(2);

    // Verify charge details for lease1
    const charge = await prisma.rentCharge.findFirst({
      where: { leaseId, type: "rent" },
    });

    expect(charge).not.toBeNull();
    expect(charge!.amount).toBe(150000);
    expect(charge!.paidAmount).toBe(0);
    expect(charge!.status).toBe("unpaid");
    expect(charge!.type).toBe("rent");

    // forMonth should be first of current month
    const expectedForMonth = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );
    expect(charge!.forMonth.getTime()).toBe(expectedForMonth.getTime());
  });

  it("creates charge for month-to-month leases", async () => {
    const charge = await prisma.rentCharge.findFirst({
      where: { leaseId: monthToMonthLeaseId, type: "rent" },
    });

    expect(charge).not.toBeNull();
    expect(charge!.amount).toBe(180000);
  });

  it("does NOT create charge for terminated leases", async () => {
    const charge = await prisma.rentCharge.findFirst({
      where: { leaseId: terminatedLeaseId, type: "rent" },
    });

    expect(charge).toBeNull();
  });

  it("is idempotent — running twice does not create duplicate charges", async () => {
    const today = new Date();

    // Run again (charges already exist from first test)
    const created = await postRentCharges(today);
    expect(created).toBe(0); // All duplicates skipped

    // Verify only 1 rent charge per lease
    const charges = await prisma.rentCharge.findMany({
      where: { leaseId, type: "rent" },
    });
    expect(charges).toHaveLength(1);
  });

  it("does NOT create charge when rentDueDay does not match", async () => {
    const charge = await prisma.rentCharge.findFirst({
      where: { leaseId: lease2Id, type: "rent" },
    });

    // lease2 has a different due day, so no charge should exist
    expect(charge).toBeNull();
  });

  it("sets correct dueDate based on rentDueDay", async () => {
    const today = new Date();
    const charge = await prisma.rentCharge.findFirst({
      where: { leaseId, type: "rent" },
    });

    expect(charge).not.toBeNull();
    const expectedDueDate = new Date(Date.UTC(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    ));
    expect(charge!.dueDate.getUTCDate()).toBe(expectedDueDate.getUTCDate());
    expect(charge!.dueDate.getUTCMonth()).toBe(expectedDueDate.getUTCMonth());
  });

  it("includes description with month and year", async () => {
    const charge = await prisma.rentCharge.findFirst({
      where: { leaseId, type: "rent" },
    });

    expect(charge).not.toBeNull();
    expect(charge!.description).toContain("Rent for");
  });
});

// ── applyPaymentToCharges (FIFO) ──

describe("applyPaymentToCharges", () => {
  let fifoLeaseId: string;
  let fifoUnitId: string;

  beforeAll(async () => {
    // Create a separate lease with multiple charges for FIFO testing
    const fifoUnit = await prisma.unit.create({
      data: { propertyId, unitNumber: "FIFO-1", monthlyRent: 100000 },
    });
    fifoUnitId = fifoUnit.id;

    const fifoLease = await prisma.lease.create({
      data: {
        unitId: fifoUnitId,
        tenantId,
        monthlyRent: 100000,
        startDate: new Date(2026, 0, 1),
        status: "active",
        rentDueDay: 1,
        lateFeeGraceDays: 5,
      },
    });
    fifoLeaseId = fifoLease.id;

    // Create 3 monthly charges
    await prisma.rentCharge.createMany({
      data: [
        {
          leaseId: fifoLeaseId,
          amount: 100000,
          type: "rent",
          forMonth: new Date(2026, 0, 1), // Jan
          dueDate: new Date(2026, 0, 1),
          status: "unpaid",
          paidAmount: 0,
        },
        {
          leaseId: fifoLeaseId,
          amount: 100000,
          type: "rent",
          forMonth: new Date(2026, 1, 1), // Feb
          dueDate: new Date(2026, 1, 1),
          status: "unpaid",
          paidAmount: 0,
        },
        {
          leaseId: fifoLeaseId,
          amount: 100000,
          type: "rent",
          forMonth: new Date(2026, 2, 1), // Mar
          dueDate: new Date(2026, 2, 1),
          status: "unpaid",
          paidAmount: 0,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.rentCharge.deleteMany({
      where: { leaseId: fifoLeaseId },
    });
    await prisma.lease.deleteMany({ where: { id: fifoLeaseId } });
    await prisma.unit.deleteMany({ where: { id: fifoUnitId } });
  });

  it("applies full payment to oldest charge first", async () => {
    const applied = await applyPaymentToCharges(fifoLeaseId, 100000);

    expect(applied).toHaveLength(1);
    expect(applied[0].applied).toBe(100000);

    // Jan charge should be paid
    const janCharge = await prisma.rentCharge.findFirst({
      where: { leaseId: fifoLeaseId, forMonth: new Date(2026, 0, 1) },
    });
    expect(janCharge!.status).toBe("paid");
    expect(janCharge!.paidAmount).toBe(100000);

    // Feb should still be unpaid
    const febCharge = await prisma.rentCharge.findFirst({
      where: { leaseId: fifoLeaseId, forMonth: new Date(2026, 1, 1) },
    });
    expect(febCharge!.status).toBe("unpaid");
  });

  it("handles partial payment correctly", async () => {
    // Pay $500 toward Feb (which is $1000)
    const applied = await applyPaymentToCharges(fifoLeaseId, 50000);

    expect(applied).toHaveLength(1);
    expect(applied[0].applied).toBe(50000);

    const febCharge = await prisma.rentCharge.findFirst({
      where: { leaseId: fifoLeaseId, forMonth: new Date(2026, 1, 1) },
    });
    expect(febCharge!.status).toBe("partial");
    expect(febCharge!.paidAmount).toBe(50000);
  });

  it("pays remaining on partial charge then moves to next", async () => {
    // Pay $1500: should finish Feb ($500 remaining) and pay all of Mar ($1000)
    const applied = await applyPaymentToCharges(fifoLeaseId, 150000);

    expect(applied).toHaveLength(2);
    expect(applied[0].applied).toBe(50000); // Remaining on Feb
    expect(applied[1].applied).toBe(100000); // All of Mar

    const febCharge = await prisma.rentCharge.findFirst({
      where: { leaseId: fifoLeaseId, forMonth: new Date(2026, 1, 1) },
    });
    expect(febCharge!.status).toBe("paid");
    expect(febCharge!.paidAmount).toBe(100000);

    const marCharge = await prisma.rentCharge.findFirst({
      where: { leaseId: fifoLeaseId, forMonth: new Date(2026, 2, 1) },
    });
    expect(marCharge!.status).toBe("paid");
    expect(marCharge!.paidAmount).toBe(100000);
  });

  it("returns empty array when no outstanding charges", async () => {
    // All charges are now paid
    const applied = await applyPaymentToCharges(fifoLeaseId, 50000);
    expect(applied).toHaveLength(0);
  });
});

// ── getLeaseBalance ──

describe("getLeaseBalance", () => {
  let balanceLeaseId: string;
  let balanceUnitId: string;

  beforeAll(async () => {
    const balanceUnit = await prisma.unit.create({
      data: { propertyId, unitNumber: "BAL-1", monthlyRent: 100000 },
    });
    balanceUnitId = balanceUnit.id;

    const balanceLease = await prisma.lease.create({
      data: {
        unitId: balanceUnitId,
        tenantId,
        monthlyRent: 100000,
        startDate: new Date(2026, 0, 1),
        status: "active",
        rentDueDay: 1,
        lateFeeGraceDays: 5,
      },
    });
    balanceLeaseId = balanceLease.id;

    await prisma.rentCharge.createMany({
      data: [
        {
          leaseId: balanceLeaseId,
          amount: 100000,
          type: "rent",
          forMonth: new Date(2026, 0, 1),
          dueDate: new Date(2026, 0, 1),
          status: "unpaid",
          paidAmount: 0,
        },
        {
          leaseId: balanceLeaseId,
          amount: 100000,
          type: "rent",
          forMonth: new Date(2026, 1, 1),
          dueDate: new Date(2026, 1, 1),
          status: "partial",
          paidAmount: 40000,
        },
        {
          leaseId: balanceLeaseId,
          amount: 100000,
          type: "rent",
          forMonth: new Date(2026, 2, 1),
          dueDate: new Date(2026, 2, 1),
          status: "paid",
          paidAmount: 100000,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.rentCharge.deleteMany({
      where: { leaseId: balanceLeaseId },
    });
    await prisma.lease.deleteMany({ where: { id: balanceLeaseId } });
    await prisma.unit.deleteMany({ where: { id: balanceUnitId } });
  });

  it("calculates balance from unpaid and partial charges", async () => {
    const balance = await getLeaseBalance(balanceLeaseId);

    // Jan: 100000 - 0 = 100000 (unpaid)
    // Feb: 100000 - 40000 = 60000 (partial)
    // Mar: paid (excluded)
    expect(balance).toBe(160000);
  });

  it("returns 0 when all charges are paid", async () => {
    // Apply remaining balance
    await applyPaymentToCharges(balanceLeaseId, 160000);

    const balance = await getLeaseBalance(balanceLeaseId);
    expect(balance).toBe(0);
  });
});
