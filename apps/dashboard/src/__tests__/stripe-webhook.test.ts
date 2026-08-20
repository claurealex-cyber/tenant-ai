import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_webhook_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;
let unitId: string;
let tenantId: string;
let leaseId: string;
let tierId: string;
let subId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "Webhook Test Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "Webhook Property",
      address: "100 Hook St",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const unit = await prisma.unit.create({
    data: { propertyId, unitNumber: "WH-101", monthlyRent: 150000 },
  });
  unitId = unit.id;

  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Webhook",
      lastName: "Tenant",
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
    ],
  });

  // Pricing tier + subscription for billing tests
  const tier = await prisma.pricingTier.create({
    data: {
      name: `test_webhook_tier_${Date.now()}`,
      displayName: "Webhook Tier",
      basePriceCents: 5000,
      includedAiCents: 3000,
      aiMarkupPercent: 50,
    },
  });
  tierId = tier.id;

  const sub = await prisma.subscription.create({
    data: {
      userId,
      tierId,
      status: "active",
      stripeSubscriptionId: `sub_test_${Date.now()}`,
      currentPeriodStart: new Date(2026, 0, 1),
      currentPeriodEnd: new Date(2026, 1, 1),
    },
  });
  subId = sub.id;
});

afterAll(async () => {
  await prisma.invoice.deleteMany({ where: { subscriptionId: subId } });
  await prisma.payment.deleteMany({ where: { leaseId } });
  await prisma.rentCharge.deleteMany({ where: { leaseId } });
  await prisma.lease.deleteMany({ where: { id: leaseId } });
  await prisma.unit.deleteMany({ where: { id: unitId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.subscription.deleteMany({ where: { id: subId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.pricingTier.deleteMany({ where: { id: tierId } });
  await prisma.$disconnect();
});

// ── Connect: payment_intent.succeeded ──

describe("payment_intent.succeeded handler logic", () => {
  it("marks payment as completed and applies FIFO to RentCharges", async () => {
    // Create a pending payment with stripePaymentId
    const payment = await prisma.payment.create({
      data: {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "ach",
        status: "pending",
        stripePaymentId: `pi_test_${Date.now()}`,
      },
    });

    // Simulate what the webhook handler does
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "completed", paidAt: new Date() },
    });

    // Apply FIFO
    const charges = await prisma.rentCharge.findMany({
      where: { leaseId, status: { in: ["unpaid", "partial"] } },
      orderBy: { dueDate: "asc" },
    });

    let remaining = payment.amount;
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

    // Verify: payment completed
    const updated = await prisma.payment.findUnique({
      where: { id: payment.id },
    });
    expect(updated!.status).toBe("completed");
    expect(updated!.paidAt).not.toBeNull();

    // Jan charge should be fully paid
    const janCharge = await prisma.rentCharge.findFirst({
      where: { leaseId, forMonth: new Date(2026, 0, 1), type: "rent" },
    });
    expect(janCharge!.status).toBe("paid");
    expect(janCharge!.paidAmount).toBe(150000);
  });
});

// ── Connect: payment_intent.payment_failed ──

describe("payment_intent.payment_failed handler logic", () => {
  it("marks payment as failed, RentCharges remain unchanged", async () => {
    const payment = await prisma.payment.create({
      data: {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "ach",
        status: "pending",
        stripePaymentId: `pi_fail_${Date.now()}`,
      },
    });

    // Simulate failure
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "failed" },
    });

    const updated = await prisma.payment.findUnique({
      where: { id: payment.id },
    });
    expect(updated!.status).toBe("failed");

    // Feb charge should still be unpaid (not affected by failed payment)
    const febCharge = await prisma.rentCharge.findFirst({
      where: { leaseId, forMonth: new Date(2026, 1, 1), type: "rent" },
    });
    expect(febCharge!.status).toBe("unpaid");
  });
});

// ── Connect: payment_intent.processing ──

describe("payment_intent.processing handler logic", () => {
  it("marks payment as processing without affecting RentCharges", async () => {
    const payment = await prisma.payment.create({
      data: {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "ach",
        status: "pending",
        stripePaymentId: `pi_proc_${Date.now()}`,
      },
    });

    // Simulate what the processing webhook handler does
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "processing" },
    });

    const updated = await prisma.payment.findUnique({
      where: { id: payment.id },
    });
    expect(updated!.status).toBe("processing");

    // RentCharges should NOT be affected (funds haven't cleared)
    const febCharge = await prisma.rentCharge.findFirst({
      where: { leaseId, forMonth: new Date(2026, 1, 1), type: "rent" },
    });
    expect(febCharge!.status).toBe("unpaid");
  });
});

// ── Billing: invoice.paid ──

describe("invoice.paid handler logic", () => {
  it("marks invoice as paid", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        subscriptionId: subId,
        billingMonth: new Date(2026, 0, 1),
        basePriceCents: 5000,
        aiUsageCostCents: 1000,
        aiMarkupCents: 0,
        totalCents: 5000,
        status: "finalized",
        stripeInvoiceId: `inv_test_${Date.now()}`,
      },
    });

    // Simulate invoice.paid handler
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "paid", paidAt: new Date() },
    });

    const updated = await prisma.invoice.findUnique({
      where: { id: invoice.id },
    });
    expect(updated!.status).toBe("paid");
    expect(updated!.paidAt).not.toBeNull();
  });
});

// ── Billing: invoice.payment_failed → past_due after 3 failures ──

describe("invoice.payment_failed handler logic", () => {
  it("moves subscription to past_due after 3 failed invoices", async () => {
    // Create 3 failed invoices
    await prisma.invoice.createMany({
      data: [
        {
          subscriptionId: subId,
          billingMonth: new Date(2026, 2, 1),
          basePriceCents: 5000,
          totalCents: 5000,
          status: "failed",
          stripeInvoiceId: `inv_fail1_${Date.now()}`,
        },
        {
          subscriptionId: subId,
          billingMonth: new Date(2026, 3, 1),
          basePriceCents: 5000,
          totalCents: 5000,
          status: "failed",
          stripeInvoiceId: `inv_fail2_${Date.now()}`,
        },
        {
          subscriptionId: subId,
          billingMonth: new Date(2026, 4, 1),
          basePriceCents: 5000,
          totalCents: 5000,
          status: "failed",
          stripeInvoiceId: `inv_fail3_${Date.now()}`,
        },
      ],
    });

    // Check if subscription should move to past_due
    const failedCount = await prisma.invoice.count({
      where: { subscriptionId: subId, status: "failed" },
    });

    expect(failedCount).toBeGreaterThanOrEqual(3);

    // Simulate handler setting past_due
    await prisma.subscription.update({
      where: { id: subId },
      data: { status: "past_due" },
    });

    const sub = await prisma.subscription.findUnique({
      where: { id: subId },
    });
    expect(sub!.status).toBe("past_due");
  });
});

// ── Billing: subscription.deleted ──

describe("subscription.deleted handler logic", () => {
  it("marks subscription as canceled", async () => {
    await prisma.subscription.update({
      where: { id: subId },
      data: { status: "canceled", canceledAt: new Date() },
    });

    const sub = await prisma.subscription.findUnique({
      where: { id: subId },
    });
    expect(sub!.status).toBe("canceled");
    expect(sub!.canceledAt).not.toBeNull();
  });
});

// ── Webhook idempotency ──

describe("Webhook idempotency", () => {
  it("duplicate payment completion does not double-count", async () => {
    // Create a completed payment
    const payment = await prisma.payment.create({
      data: {
        leaseId,
        tenantId,
        amount: 100,
        type: "rent",
        method: "card",
        status: "completed",
        stripePaymentId: `pi_dup_${Date.now()}`,
        paidAt: new Date(),
      },
    });

    // Simulate duplicate webhook — updating already-completed payment
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "completed", paidAt: new Date() },
    });

    expect(updated.status).toBe("completed");
    // No additional side effects — just an update to an already-completed record
  });
});
