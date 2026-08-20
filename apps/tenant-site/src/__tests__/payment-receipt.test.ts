import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ──

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock("@/lib/auth", () => ({
  tenantAuthOptions: {},
}));

const mockPaymentFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: {
      findUnique: (...args: any[]) => mockPaymentFindUnique(...args),
    },
  },
}));

// Mock pdfkit
vi.mock("pdfkit", () => {
  const EventEmitter = require("events");
  return {
    default: class MockPDFDocument extends EventEmitter {
      constructor() {
        super();
      }
      fontSize() { return this; }
      font() { return this; }
      text() { return this; }
      moveDown() { return this; }
      moveTo() { return this; }
      lineTo() { return this; }
      stroke() { return this; }
      fillColor() { return this; }
      get y() { return 100; }
      end() {
        this.emit("data", Buffer.from("%PDF-mock"));
        this.emit("end");
      }
    },
  };
});

import { GET } from "../app/api/portal/payments/[id]/receipt/route";

const completedPayment = {
  id: "pay-1",
  amount: 150000,
  type: "rent",
  method: "ach",
  status: "completed",
  tenantId: "t1",
  paidAt: new Date(2026, 0, 5).toISOString(),
  forMonth: new Date(2026, 0, 1).toISOString(),
  createdAt: new Date(2026, 0, 5).toISOString(),
  tenant: { firstName: "John", lastName: "Doe" },
  lease: {
    unit: {
      unitNumber: "101",
      property: {
        name: "Oak Apartments",
        address: "123 Main St, Chicago IL",
        userId: "landlord-1",
        user: { name: "Jane Landlord", companyName: null },
      },
    },
  },
};

describe("GET /api/portal/payments/[id]/receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeParams = (id: string) => ({
    params: Promise.resolve({ id }),
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/portal/payments/pay-1/receipt");
    const res = await GET(req, makeParams("pay-1"));

    expect(res.status).toBe(401);
  });

  it("returns 404 when payment not found", async () => {
    mockGetServerSession.mockResolvedValue({
      tenant: { id: "t1", email: "test@test.com", firstName: "John", lastName: "Doe", userId: "u1" },
    });
    mockPaymentFindUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/portal/payments/pay-99/receipt");
    const res = await GET(req, makeParams("pay-99"));

    expect(res.status).toBe(404);
  });

  it("returns 404 when payment belongs to different tenant", async () => {
    mockGetServerSession.mockResolvedValue({
      tenant: { id: "other-tenant", email: "other@test.com", firstName: "Other", lastName: "Person", userId: "u2" },
    });
    mockPaymentFindUnique.mockResolvedValue(completedPayment);

    const req = new NextRequest("http://localhost/api/portal/payments/pay-1/receipt");
    const res = await GET(req, makeParams("pay-1"));

    expect(res.status).toBe(404);
  });

  it("returns 400 for non-completed payment", async () => {
    mockGetServerSession.mockResolvedValue({
      tenant: { id: "t1", email: "test@test.com", firstName: "John", lastName: "Doe", userId: "u1" },
    });
    mockPaymentFindUnique.mockResolvedValue({
      ...completedPayment,
      status: "pending",
    });

    const req = new NextRequest("http://localhost/api/portal/payments/pay-1/receipt");
    const res = await GET(req, makeParams("pay-1"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("completed");
  });

  it("returns 400 for failed payment", async () => {
    mockGetServerSession.mockResolvedValue({
      tenant: { id: "t1", email: "test@test.com", firstName: "John", lastName: "Doe", userId: "u1" },
    });
    mockPaymentFindUnique.mockResolvedValue({
      ...completedPayment,
      status: "failed",
    });

    const req = new NextRequest("http://localhost/api/portal/payments/pay-1/receipt");
    const res = await GET(req, makeParams("pay-1"));

    expect(res.status).toBe(400);
  });

  it("returns PDF with correct headers for completed payment", async () => {
    mockGetServerSession.mockResolvedValue({
      tenant: { id: "t1", email: "test@test.com", firstName: "John", lastName: "Doe", userId: "u1" },
    });
    mockPaymentFindUnique.mockResolvedValue(completedPayment);

    const req = new NextRequest("http://localhost/api/portal/payments/pay-1/receipt");
    const res = await GET(req, makeParams("pay-1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("receipt-pay-1.pdf");
  });
});
