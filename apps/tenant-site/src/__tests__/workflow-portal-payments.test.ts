import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock next-auth ────────────────────────────────────────────────
const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

// ── Mock @/lib/auth ───────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  tenantAuthOptions: { providers: [] },
}));

// ── Mock @/lib/prisma ─────────────────────────────────────────────
const mockPaymentFindMany = vi.fn();
const mockPaymentCreate = vi.fn();
const mockPaymentUpdate = vi.fn();
const mockLeaseFindFirst = vi.fn();
const mockTenantFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: {
      findMany: (...args: any[]) => mockPaymentFindMany(...args),
      create: (...args: any[]) => mockPaymentCreate(...args),
      update: (...args: any[]) => mockPaymentUpdate(...args),
    },
    lease: {
      findFirst: (...args: any[]) => mockLeaseFindFirst(...args),
    },
    tenant: {
      findUnique: (...args: any[]) => mockTenantFindUnique(...args),
    },
  },
}));

// ── Mock @/lib/stripe ─────────────────────────────────────────────
const mockCreateAchPaymentIntent = vi.fn();
vi.mock("@/lib/stripe", () => ({
  createAchPaymentIntent: (...args: any[]) => mockCreateAchPaymentIntent(...args),
}));

// ── Session helper ────────────────────────────────────────────────
function tenantSession(overrides: Record<string, unknown> = {}) {
  return {
    tenant: {
      id: "tenant-pay-1",
      email: "payer@test.com",
      firstName: "Pay",
      lastName: "Tenant",
      userId: "landlord-1",
      ...overrides,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// GET /api/portal/payments
// ─────────────────────────────────────────────────────────────────
describe("GET /api/portal/payments — payment history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/payments/route");
    const res = await GET();
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns payment history for authenticated tenant", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakePayments = [
      {
        id: "pay-1",
        amount: 150000,
        type: "rent",
        method: "ach",
        status: "completed",
        paidAt: new Date(2026, 0, 5).toISOString(),
        forMonth: new Date(2026, 0, 1).toISOString(),
        receiptUrl: "https://receipts.example.com/pay-1.pdf",
        createdAt: new Date(2026, 0, 5).toISOString(),
      },
      {
        id: "pay-2",
        amount: 150000,
        type: "rent",
        method: "card",
        status: "pending",
        paidAt: null,
        forMonth: new Date(2026, 1, 1).toISOString(),
        receiptUrl: null,
        createdAt: new Date(2026, 1, 1).toISOString(),
      },
    ];
    mockPaymentFindMany.mockResolvedValue(fakePayments);

    const { GET } = await import("../app/api/portal/payments/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.payments).toHaveLength(2);
    expect(data.payments[0].id).toBe("pay-1");
    expect(data.payments[0].amount).toBe(150000);
    expect(data.payments[0].method).toBe("ach");
    expect(data.payments[0].status).toBe("completed");
    expect(data.payments[0].receiptUrl).toBe("/api/portal/payments/pay-1/receipt");
  });

  it("returns empty array when tenant has no payments", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockPaymentFindMany.mockResolvedValue([]);

    const { GET } = await import("../app/api/portal/payments/route");
    const res = await GET();
    const data = await res.json();

    expect(data.payments).toEqual([]);
  });

  it("queries payments for the correct tenant", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession({ id: "tenant-xyz" }));
    mockPaymentFindMany.mockResolvedValue([]);

    const { GET } = await import("../app/api/portal/payments/route");
    await GET();

    expect(mockPaymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-xyz" },
        orderBy: { createdAt: "desc" },
      })
    );
  });

  it("includes forMonth field for billing period tracking", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakePayments = [
      {
        id: "pay-3",
        amount: 120000,
        type: "rent",
        method: "card",
        status: "completed",
        paidAt: new Date(2026, 1, 3).toISOString(),
        forMonth: new Date(2026, 1, 1).toISOString(),
        receiptUrl: null,
        createdAt: new Date(2026, 1, 3).toISOString(),
      },
    ];
    mockPaymentFindMany.mockResolvedValue(fakePayments);

    const { GET } = await import("../app/api/portal/payments/route");
    const res = await GET();
    const data = await res.json();

    expect(data.payments[0].forMonth).toBeDefined();
    expect(data.payments[0].type).toBe("rent");
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/portal/payments/create-intent
// ─────────────────────────────────────────────────────────────────
describe("POST /api/portal/payments/create-intent — create payment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: 150000, leaseId: "lease-1" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 when amount is missing", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ leaseId: "lease-1" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("positive amount");
  });

  it("returns 400 when amount is zero", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: 0, leaseId: "lease-1" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("positive amount");
  });

  it("returns 400 when amount is negative", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: -5000, leaseId: "lease-1" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when amount is not a number", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: "not-a-number", leaseId: "lease-1" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when leaseId is missing", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: 150000 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("leaseId");
  });

  it("returns 404 when lease does not belong to tenant", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockLeaseFindFirst.mockResolvedValue(null);

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: 150000, leaseId: "someone-elses-lease" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toContain("Lease not found");
  });

  it("creates a pending payment and returns paymentId (201)", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockLeaseFindFirst.mockResolvedValue({
      id: "lease-1",
      tenantId: "tenant-pay-1",
      status: "active",
      unit: { property: { name: "Test", user: { stripeConnectAccountId: null } } },
    });
    mockPaymentCreate.mockResolvedValue({ id: "payment-new-1" });

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: 150000, leaseId: "lease-1" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.paymentId).toBe("payment-new-1");
  });

  it("creates payment with status pending, type rent, method card", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockLeaseFindFirst.mockResolvedValue({
      id: "lease-2",
      tenantId: "tenant-pay-1",
      status: "active",
      unit: { property: { name: "Test", user: { stripeConnectAccountId: null } } },
    });
    mockPaymentCreate.mockResolvedValue({ id: "payment-new-2" });

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: 120000, leaseId: "lease-2" }),
    });

    await POST(req);

    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leaseId: "lease-2",
          tenantId: "tenant-pay-1",
          amount: 120000,
          type: "rent",
          method: "card",
          status: "pending",
        }),
      })
    );
  });

  it("verifies lease ownership with correct tenant and active status", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession({ id: "tenant-owner" }));
    mockLeaseFindFirst.mockResolvedValue(null);

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: 100000, leaseId: "lease-check" }),
    });

    await POST(req);

    expect(mockLeaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "lease-check",
          tenantId: "tenant-owner",
          status: "active",
        },
      })
    );
  });

  it("uses UTC for forMonth field", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockLeaseFindFirst.mockResolvedValue({
      id: "lease-utc",
      tenantId: "tenant-pay-1",
      status: "active",
      unit: { property: { name: "Test", user: { stripeConnectAccountId: null } } },
    });
    mockPaymentCreate.mockResolvedValue({ id: "payment-utc" });

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: 100000, leaseId: "lease-utc" }),
    });

    await POST(req);

    const callArgs = mockPaymentCreate.mock.calls[0][0];
    const forMonth = new Date(callArgs.data.forMonth);
    // UTC day should be 1 (first of month)
    expect(forMonth.getUTCDate()).toBe(1);
    expect(forMonth.getUTCHours()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/portal/payments/create-intent — ACH bank payments
// ─────────────────────────────────────────────────────────────────
describe("POST /api/portal/payments/create-intent — ACH bank path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const leaseWithConnect = {
    id: "lease-ach",
    tenantId: "tenant-pay-1",
    status: "active",
    unit: {
      property: {
        name: "Test Property",
        user: { stripeConnectAccountId: "acct_123" },
      },
    },
  };

  it("returns 400 when tenant has no linked bank account", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockLeaseFindFirst.mockResolvedValue(leaseWithConnect);
    mockTenantFindUnique.mockResolvedValue({
      stripePaymentMethodId: null,
      stripeCustomerId: null,
    });

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: 150000, leaseId: "lease-ach", paymentMethodType: "bank" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("No bank account linked");
  });

  it("returns 400 when landlord has no Stripe Connect account", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockLeaseFindFirst.mockResolvedValue({
      ...leaseWithConnect,
      unit: { property: { name: "Test", user: { stripeConnectAccountId: null } } },
    });
    mockTenantFindUnique.mockResolvedValue({
      stripePaymentMethodId: "ba_123",
      stripeCustomerId: "cus_123",
    });

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: 150000, leaseId: "lease-ach", paymentMethodType: "bank" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("landlord");
  });

  it("creates ACH payment with method 'ach' and returns paymentId (201)", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockLeaseFindFirst.mockResolvedValue(leaseWithConnect);
    mockTenantFindUnique.mockResolvedValue({
      stripePaymentMethodId: "ba_123",
      stripeCustomerId: "cus_123",
    });
    mockPaymentCreate.mockResolvedValue({ id: "payment-ach-1" });
    mockCreateAchPaymentIntent.mockResolvedValue({
      paymentIntentId: "pi_ach_123",
      clientSecret: "cs_123",
    });
    mockPaymentUpdate.mockResolvedValue({ id: "payment-ach-1" });

    const { POST } = await import("../app/api/portal/payments/create-intent/route");
    const req = new NextRequest("http://localhost:3002/api/portal/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount: 150000, leaseId: "lease-ach", paymentMethodType: "bank" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.paymentId).toBe("payment-ach-1");

    // Verify payment was created with method "ach"
    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          method: "ach",
          status: "pending",
        }),
      })
    );

    // Verify Stripe PaymentIntent was stored
    expect(mockPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "payment-ach-1" },
        data: { stripePaymentId: "pi_ach_123" },
      })
    );
  });
});
