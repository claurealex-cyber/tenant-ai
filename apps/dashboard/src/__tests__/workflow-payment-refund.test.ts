import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_refund_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

// ── Shared state ──

let userId: string;
let otherUserId: string;
let propertyId: string;
let otherPropertyId: string;
let unitId: string;
let otherUnitId: string;
let tenantId: string;
let otherTenantId: string;
let leaseId: string;
let otherLeaseId: string;

// Payment IDs created per-test
let completedPaymentId: string;
let completedPaymentNoStripeId: string;
let pendingPaymentId: string;
let refundedPaymentId: string;
let otherPaymentId: string;

// RentCharge IDs
let charge1Id: string;
let charge2Id: string;

// ── Mock session ──

const mockSession = {
  user: { id: "", email: "", role: "client" },
};

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => {
  const { PrismaClient: RealPrisma } = require("@prisma/client");
  return { prisma: new RealPrisma() };
});

// Mock stripe-connect — avoid real Stripe calls
const mockRefundsCreate = vi.fn().mockResolvedValue({ id: "re_mock" });
vi.mock("@/lib/stripe-connect", () => ({
  getStripeClient: vi.fn(() =>
    Promise.resolve({
      refunds: { create: (...args: any[]) => mockRefundsCreate(...args) },
    })
  ),
}));

// ── Setup ──

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "Refund Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;
  mockSession.user.id = userId;
  mockSession.user.email = user.email;

  const otherUser = await prisma.user.create({
    data: {
      email: testEmail("other"),
      name: "Other Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
    },
  });
  otherUserId = otherUser.id;

  const property = await prisma.property.create({
    data: { name: "Refund Prop", address: "100 Refund St", userId, isActive: true },
  });
  propertyId = property.id;

  const otherProperty = await prisma.property.create({
    data: { name: "Other Prop", address: "200 Other St", userId: otherUserId, isActive: true },
  });
  otherPropertyId = otherProperty.id;

  const unit = await prisma.unit.create({
    data: { propertyId, unitNumber: "RFD-1", monthlyRent: 100000 },
  });
  unitId = unit.id;

  const otherUnit = await prisma.unit.create({
    data: { propertyId: otherPropertyId, unitNumber: "RFD-2", monthlyRent: 80000 },
  });
  otherUnitId = otherUnit.id;

  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Refund",
      lastName: "Tenant",
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

  const lease = await prisma.lease.create({
    data: {
      unitId,
      tenantId,
      monthlyRent: 100000,
      startDate: new Date(2025, 6, 1),
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
      monthlyRent: 80000,
      startDate: new Date(2025, 6, 1),
      status: "active",
      rentDueDay: 1,
      lateFeeGraceDays: 5,
    },
  });
  otherLeaseId = otherLease.id;
});

afterAll(async () => {
  // Clean up — children first
  await prisma.rentCharge.deleteMany({ where: { leaseId: { in: [leaseId, otherLeaseId] } } });
  await prisma.payment.deleteMany({ where: { leaseId: { in: [leaseId, otherLeaseId] } } });
  await prisma.lease.deleteMany({ where: { id: { in: [leaseId, otherLeaseId] } } });
  await prisma.unit.deleteMany({ where: { id: { in: [unitId, otherUnitId] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.property.deleteMany({ where: { id: { in: [propertyId, otherPropertyId] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await prisma.$disconnect();
});

// ── Helper to seed per-test payments/charges ──

async function seedPaymentsAndCharges() {
  // Clean up from previous test
  await prisma.rentCharge.deleteMany({ where: { leaseId } });
  await prisma.payment.deleteMany({ where: { leaseId } });

  // Create two rent charges (Aug + Sep)
  const c1 = await prisma.rentCharge.create({
    data: {
      leaseId,
      amount: 100000,
      type: "rent",
      forMonth: new Date(Date.UTC(2025, 7, 1)),
      dueDate: new Date(Date.UTC(2025, 7, 1)),
      paidAmount: 100000,
      status: "paid",
    },
  });
  charge1Id = c1.id;

  const c2 = await prisma.rentCharge.create({
    data: {
      leaseId,
      amount: 100000,
      type: "rent",
      forMonth: new Date(Date.UTC(2025, 8, 1)),
      dueDate: new Date(Date.UTC(2025, 8, 1)),
      paidAmount: 50000,
      status: "partial",
    },
  });
  charge2Id = c2.id;

  // Completed payment with Stripe (covers the Sep partial)
  const cp = await prisma.payment.create({
    data: {
      leaseId,
      tenantId,
      amount: 50000,
      type: "rent",
      method: "ach",
      status: "completed",
      stripePaymentId: "pi_test_123",
      paidAt: new Date(),
    },
  });
  completedPaymentId = cp.id;

  // Completed payment without Stripe (cash — covers the Aug full)
  const cpNoStripe = await prisma.payment.create({
    data: {
      leaseId,
      tenantId,
      amount: 100000,
      type: "rent",
      method: "cash",
      status: "completed",
      description: "Cash payment",
      paidAt: new Date(),
    },
  });
  completedPaymentNoStripeId = cpNoStripe.id;

  // Pending payment
  const pp = await prisma.payment.create({
    data: {
      leaseId,
      tenantId,
      amount: 100000,
      type: "rent",
      method: "ach",
      status: "pending",
    },
  });
  pendingPaymentId = pp.id;

  // Already refunded payment
  const rp = await prisma.payment.create({
    data: {
      leaseId,
      tenantId,
      amount: 100000,
      type: "rent",
      method: "ach",
      status: "refunded",
    },
  });
  refundedPaymentId = rp.id;

  // Other landlord's payment
  const op = await prisma.payment.create({
    data: {
      leaseId: otherLeaseId,
      tenantId: otherTenantId,
      amount: 80000,
      type: "rent",
      method: "card",
      status: "completed",
      paidAt: new Date(),
    },
  });
  otherPaymentId = op.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/[id]/refund
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/payments/[id]/refund — payment refund", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSession.user.id = userId;
    await seedPaymentsAndCharges();
  });

  it("returns 401 when not authenticated", async () => {
    mockSession.user.id = "";
    // Clear session entirely
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { POST } = await import("../app/api/payments/[id]/refund/route");
    const req = new NextRequest(`http://localhost:3000/api/payments/${completedPaymentId}/refund`, {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: completedPaymentId }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 for nonexistent payment", async () => {
    const { POST } = await import("../app/api/payments/[id]/refund/route");
    const req = new NextRequest("http://localhost:3000/api/payments/nonexistent/refund", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 for another landlord's payment", async () => {
    const { POST } = await import("../app/api/payments/[id]/refund/route");
    const req = new NextRequest(`http://localhost:3000/api/payments/${otherPaymentId}/refund`, {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: otherPaymentId }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for already refunded payment", async () => {
    const { POST } = await import("../app/api/payments/[id]/refund/route");
    const req = new NextRequest(`http://localhost:3000/api/payments/${refundedPaymentId}/refund`, {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: refundedPaymentId }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("already been refunded");
  });

  it("returns 400 for pending payment", async () => {
    const { POST } = await import("../app/api/payments/[id]/refund/route");
    const req = new NextRequest(`http://localhost:3000/api/payments/${pendingPaymentId}/refund`, {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: pendingPaymentId }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Only completed");
  });

  it("refunds a Stripe payment — calls stripe.refunds.create and updates status", async () => {
    const { POST } = await import("../app/api/payments/[id]/refund/route");
    const req = new NextRequest(`http://localhost:3000/api/payments/${completedPaymentId}/refund`, {
      method: "POST",
      body: JSON.stringify({ reason: "Duplicate charge" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: completedPaymentId }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.payment.status).toBe("refunded");
    expect(data.payment.description).toContain("Duplicate charge");

    // Stripe API called
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_test_123" })
    );

    // Verify DB
    const dbPayment = await prisma.payment.findUnique({ where: { id: completedPaymentId } });
    expect(dbPayment!.status).toBe("refunded");
  });

  it("refunds a cash payment — no Stripe call, still reverses charges", async () => {
    const { POST } = await import("../app/api/payments/[id]/refund/route");
    const req = new NextRequest(`http://localhost:3000/api/payments/${completedPaymentNoStripeId}/refund`, {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: completedPaymentNoStripeId }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.payment.status).toBe("refunded");

    // Stripe NOT called (no stripePaymentId)
    expect(mockRefundsCreate).not.toHaveBeenCalled();

    // Verify DB
    const dbPayment = await prisma.payment.findUnique({ where: { id: completedPaymentNoStripeId } });
    expect(dbPayment!.status).toBe("refunded");
  });

  it("reverses RentCharge allocations (newest-first)", async () => {
    // Before refund: charge1=100000/100000 (paid), charge2=50000/100000 (partial)
    // Refunding the 50000 Stripe payment should reverse charge2 first (newest)
    const { POST } = await import("../app/api/payments/[id]/refund/route");
    const req = new NextRequest(`http://localhost:3000/api/payments/${completedPaymentId}/refund`, {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: completedPaymentId }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.reversed).toHaveLength(1);
    expect(data.reversed[0].chargeId).toBe(charge2Id);
    expect(data.reversed[0].reversed).toBe(50000);

    // Verify charge2 went from partial(50000) to unpaid(0)
    const c2 = await prisma.rentCharge.findUnique({ where: { id: charge2Id } });
    expect(c2!.paidAmount).toBe(0);
    expect(c2!.status).toBe("unpaid");

    // charge1 should be unchanged (still fully paid)
    const c1 = await prisma.rentCharge.findUnique({ where: { id: charge1Id } });
    expect(c1!.paidAmount).toBe(100000);
    expect(c1!.status).toBe("paid");
  });

  it("reverses multiple charges when refund exceeds newest charge", async () => {
    // Refunding the 100000 cash payment should reverse charge2 (50000 partial) then charge1 (50000 from 100000 paid)
    const { POST } = await import("../app/api/payments/[id]/refund/route");
    const req = new NextRequest(`http://localhost:3000/api/payments/${completedPaymentNoStripeId}/refund`, {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: completedPaymentNoStripeId }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.reversed).toHaveLength(2);
    // Newest charge (Sep) reversed first
    expect(data.reversed[0].chargeId).toBe(charge2Id);
    expect(data.reversed[0].reversed).toBe(50000);
    // Then oldest charge (Aug) gets remaining 50000
    expect(data.reversed[1].chargeId).toBe(charge1Id);
    expect(data.reversed[1].reversed).toBe(50000);

    // Verify: charge2 → unpaid, charge1 → partial(50000)
    const c2 = await prisma.rentCharge.findUnique({ where: { id: charge2Id } });
    expect(c2!.paidAmount).toBe(0);
    expect(c2!.status).toBe("unpaid");

    const c1 = await prisma.rentCharge.findUnique({ where: { id: charge1Id } });
    expect(c1!.paidAmount).toBe(50000);
    expect(c1!.status).toBe("partial");
  });
});
