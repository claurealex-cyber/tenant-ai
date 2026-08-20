import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { id: "user-1", role: "landlord", email: "ll@test.com" },
  }),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

const mockTransaction = vi.fn();
const mockLeaseFind = vi.fn();
const mockTenantFind = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lease: { findFirst: (...args: any[]) => mockLeaseFind(...args) },
    tenant: { findFirst: (...args: any[]) => mockTenantFind(...args) },
    $transaction: (...args: any[]) => mockTransaction(...args),
  },
}));

describe("Offline Payment - Transaction Safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLeaseFind.mockResolvedValue({ id: "lease-1" });
    mockTenantFind.mockResolvedValue({ id: "tenant-1", userId: "user-1" });
  });

  it("wraps payment creation and charge updates in a transaction", async () => {
    mockTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        payment: {
          create: vi.fn().mockResolvedValue({ id: "pay-1", amount: 100000 }),
        },
        rentCharge: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "charge-1",
              amount: 100000,
              paidAmount: 0,
              status: "unpaid",
            },
          ]),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    const { POST } = await import("../app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId: "lease-1",
        tenantId: "tenant-1",
        amount: 100000,
        method: "cash",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Verify $transaction was called (not individual prisma calls)
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(typeof mockTransaction.mock.calls[0][0]).toBe("function");
  });

  it("applies FIFO ordering to charges", async () => {
    const mockChargeUpdate = vi.fn().mockResolvedValue({});

    mockTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        payment: {
          create: vi.fn().mockResolvedValue({ id: "pay-1", amount: 150000 }),
        },
        rentCharge: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "charge-old",
              amount: 100000,
              paidAmount: 0,
              status: "unpaid",
            },
            {
              id: "charge-new",
              amount: 100000,
              paidAmount: 0,
              status: "unpaid",
            },
          ]),
          update: mockChargeUpdate,
        },
      };
      return fn(tx);
    });

    const { POST } = await import("../app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId: "lease-1",
        tenantId: "tenant-1",
        amount: 150000,
        method: "check",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    // First charge fully paid, second partially paid
    expect(mockChargeUpdate).toHaveBeenCalledTimes(2);
    expect(data.applied).toHaveLength(2);
    expect(data.applied[0].chargeId).toBe("charge-old");
    expect(data.applied[0].applied).toBe(100000);
    expect(data.applied[1].chargeId).toBe("charge-new");
    expect(data.applied[1].applied).toBe(50000);
  });

  it("returns 400 for invalid method", async () => {
    const { POST } = await import("../app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId: "lease-1",
        tenantId: "tenant-1",
        amount: 100000,
        method: "bitcoin",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when required fields are missing", async () => {
    const { POST } = await import("../app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId: "lease-1",
        // missing tenantId, amount, method
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-positive amount", async () => {
    const { POST } = await import("../app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId: "lease-1",
        tenantId: "tenant-1",
        amount: -500,
        method: "cash",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when lease not found", async () => {
    mockLeaseFind.mockResolvedValue(null);

    const { POST } = await import("../app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId: "nonexistent",
        tenantId: "tenant-1",
        amount: 100000,
        method: "cash",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 404 when tenant not found", async () => {
    mockTenantFind.mockResolvedValue(null);

    const { POST } = await import("../app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId: "lease-1",
        tenantId: "nonexistent",
        amount: 100000,
        method: "cash",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("marks fully paid charge as paid status", async () => {
    const mockChargeUpdate = vi.fn().mockResolvedValue({});

    mockTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        payment: {
          create: vi.fn().mockResolvedValue({ id: "pay-1", amount: 100000 }),
        },
        rentCharge: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "charge-1",
              amount: 100000,
              paidAmount: 0,
              status: "unpaid",
            },
          ]),
          update: mockChargeUpdate,
        },
      };
      return fn(tx);
    });

    const { POST } = await import("../app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId: "lease-1",
        tenantId: "tenant-1",
        amount: 100000,
        method: "cash",
      }),
    });

    await POST(req);

    // Verify the charge was updated with paid status
    expect(mockChargeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "charge-1" },
        data: { paidAmount: 100000, status: "paid" },
      })
    );
  });

  it("marks partially paid charge as partial status", async () => {
    const mockChargeUpdate = vi.fn().mockResolvedValue({});

    mockTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        payment: {
          create: vi.fn().mockResolvedValue({ id: "pay-1", amount: 50000 }),
        },
        rentCharge: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "charge-1",
              amount: 100000,
              paidAmount: 0,
              status: "unpaid",
            },
          ]),
          update: mockChargeUpdate,
        },
      };
      return fn(tx);
    });

    const { POST } = await import("../app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId: "lease-1",
        tenantId: "tenant-1",
        amount: 50000,
        method: "check",
      }),
    });

    await POST(req);

    expect(mockChargeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "charge-1" },
        data: { paidAmount: 50000, status: "partial" },
      })
    );
  });
});
