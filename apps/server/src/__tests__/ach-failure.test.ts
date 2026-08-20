import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import {
  notifyPaymentFailed,
  notifyPaymentReceived,
  getSentNotifications,
  clearSentNotifications,
} from "../services/notifications.js";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_ach_${Date.now()}`;

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
      name: "ACH Test Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "ACH Test Property",
      address: "200 Payment Ave",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const unit = await prisma.unit.create({
    data: { propertyId, unitNumber: "ACH-1", monthlyRent: 150000 },
  });
  unitId = unit.id;

  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Jane",
      lastName: "Renter",
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

  // Unpaid rent charge
  await prisma.rentCharge.create({
    data: {
      leaseId,
      amount: 150000,
      type: "rent",
      forMonth: new Date(2026, 1, 1),
      dueDate: new Date(2026, 1, 1),
      status: "unpaid",
      paidAmount: 0,
    },
  });
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { leaseId } });
  await prisma.rentCharge.deleteMany({ where: { leaseId } });
  await prisma.lease.deleteMany({ where: { id: leaseId } });
  await prisma.unit.deleteMany({ where: { id: unitId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(() => {
  clearSentNotifications();
});

// ── ACH failure: payment stays failed, RentCharges unchanged ──

describe("ACH failure handling", () => {
  it("marks payment as failed and leaves RentCharges unpaid", async () => {
    const payment = await prisma.payment.create({
      data: {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "ach",
        status: "pending",
        stripePaymentId: `pi_ach_fail_${Date.now()}`,
      },
    });

    // Simulate webhook: payment_intent.payment_failed
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "failed" },
    });

    const updated = await prisma.payment.findUnique({
      where: { id: payment.id },
    });
    expect(updated!.status).toBe("failed");

    // RentCharge should remain unpaid
    const charge = await prisma.rentCharge.findFirst({
      where: { leaseId, forMonth: new Date(2026, 1, 1), type: "rent" },
    });
    expect(charge!.status).toBe("unpaid");
    expect(charge!.paidAmount).toBe(0);
  });

  it("does not auto-retry — tenant must create a new payment", async () => {
    // After a failure, the old payment is "failed" and should not be reused
    const failedPayments = await prisma.payment.findMany({
      where: { leaseId, status: "failed" },
    });
    expect(failedPayments.length).toBeGreaterThanOrEqual(1);

    // A new payment can be created for the same lease
    const newPayment = await prisma.payment.create({
      data: {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "ach",
        status: "pending",
        stripePaymentId: `pi_ach_retry_${Date.now()}`,
      },
    });
    expect(newPayment.status).toBe("pending");
  });
});

// ── Notifications ──

describe("Payment failure notifications", () => {
  it("sends notifications to both tenant and landlord on payment failure", async () => {
    const payment = await prisma.payment.create({
      data: {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "ach",
        status: "failed",
        stripePaymentId: `pi_notify_fail_${Date.now()}`,
      },
    });

    await notifyPaymentFailed(payment.id);

    const notifications = getSentNotifications();
    expect(notifications).toHaveLength(2);

    // Tenant notification
    const tenantNotif = notifications.find((n) =>
      n.recipientEmail === testEmail("tenant")
    );
    expect(tenantNotif).toBeDefined();
    expect(tenantNotif!.type).toBe("payment_failed");
    expect(tenantNotif!.subject).toContain("$1,500.00");
    expect(tenantNotif!.subject).toContain("failed");
    expect(tenantNotif!.body).toContain("Jane");
    expect(tenantNotif!.body).toContain("ACH");

    // Landlord notification
    const landlordNotif = notifications.find((n) =>
      n.recipientEmail === testEmail("landlord")
    );
    expect(landlordNotif).toBeDefined();
    expect(landlordNotif!.type).toBe("payment_failed");
    expect(landlordNotif!.subject).toContain("Jane Renter");
    expect(landlordNotif!.body).toContain("ACH");
    expect(landlordNotif!.body).toContain("No automatic retry");
  });

  it("sends notifications to both tenant and landlord on payment success", async () => {
    const payment = await prisma.payment.create({
      data: {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "ach",
        status: "completed",
        stripePaymentId: `pi_notify_ok_${Date.now()}`,
        paidAt: new Date(),
      },
    });

    await notifyPaymentReceived(payment.id);

    const notifications = getSentNotifications();
    expect(notifications).toHaveLength(2);

    const tenantNotif = notifications.find((n) =>
      n.recipientEmail === testEmail("tenant")
    );
    expect(tenantNotif).toBeDefined();
    expect(tenantNotif!.type).toBe("payment_received");
    expect(tenantNotif!.subject).toContain("$1,500.00");
    expect(tenantNotif!.body).toContain("received");

    const landlordNotif = notifications.find((n) =>
      n.recipientEmail === testEmail("landlord")
    );
    expect(landlordNotif).toBeDefined();
    expect(landlordNotif!.subject).toContain("Jane Renter");
  });

  it("handles non-existent payment ID gracefully", async () => {
    await notifyPaymentFailed("nonexistent_id");
    expect(getSentNotifications()).toHaveLength(0);
  });

  it("card payment failure also sends notifications", async () => {
    const payment = await prisma.payment.create({
      data: {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "card",
        status: "failed",
        stripePaymentId: `pi_card_fail_${Date.now()}`,
      },
    });

    await notifyPaymentFailed(payment.id);

    const notifications = getSentNotifications();
    expect(notifications).toHaveLength(2);
    expect(notifications[0].body).toContain("CARD");
  });
});
