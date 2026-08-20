import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_wf_pay_${Date.now()}`;

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

// ── Setup ──

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "WF Pay Landlord",
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
    data: { name: "WF Pay Property", address: "100 Pay St", userId, isActive: true },
  });
  propertyId = property.id;

  const otherProperty = await prisma.property.create({
    data: { name: "Other Property", address: "200 Other St", userId: otherUserId, isActive: true },
  });
  otherPropertyId = otherProperty.id;

  const unit = await prisma.unit.create({
    data: { propertyId, unitNumber: "WFP-101", monthlyRent: 150000 },
  });
  unitId = unit.id;

  const otherUnit = await prisma.unit.create({
    data: { propertyId: otherPropertyId, unitNumber: "WFP-201", monthlyRent: 120000 },
  });
  otherUnitId = otherUnit.id;

  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "WFPay",
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

  const lease = await prisma.lease.create({
    data: {
      unitId,
      tenantId,
      monthlyRent: 150000,
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
      monthlyRent: 120000,
      startDate: new Date(2025, 6, 1),
      status: "active",
      rentDueDay: 1,
      lateFeeGraceDays: 5,
    },
  });
  otherLeaseId = otherLease.id;

  // Payments for listing
  await prisma.payment.createMany({
    data: [
      {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "ach",
        status: "completed",
        forMonth: new Date(2025, 8, 1),
        paidAt: new Date(2025, 8, 1),
      },
      {
        leaseId,
        tenantId,
        amount: 150000,
        type: "rent",
        method: "card",
        status: "completed",
        forMonth: new Date(2025, 9, 1),
        paidAt: new Date(2025, 9, 1),
      },
      // Other user's payment
      {
        leaseId: otherLeaseId,
        tenantId: otherTenantId,
        amount: 120000,
        type: "rent",
        method: "ach",
        status: "completed",
        paidAt: new Date(2025, 8, 1),
      },
    ],
  });

  // Rent charges for FIFO + overdue
  await prisma.rentCharge.createMany({
    data: [
      {
        leaseId,
        amount: 150000,
        type: "rent",
        forMonth: new Date(2025, 10, 1),
        dueDate: new Date(2025, 10, 1),
        status: "unpaid",
        paidAmount: 0,
      },
      {
        leaseId,
        amount: 150000,
        type: "rent",
        forMonth: new Date(2025, 11, 1),
        dueDate: new Date(2025, 11, 1),
        status: "unpaid",
        paidAmount: 0,
      },
      // Other user's overdue charge
      {
        leaseId: otherLeaseId,
        amount: 120000,
        type: "rent",
        forMonth: new Date(2025, 10, 1),
        dueDate: new Date(2025, 10, 1),
        status: "unpaid",
        paidAmount: 0,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { leaseId: { in: [leaseId, otherLeaseId] } } });
  await prisma.rentCharge.deleteMany({ where: { leaseId: { in: [leaseId, otherLeaseId] } } });
  await prisma.lease.deleteMany({ where: { id: { in: [leaseId, otherLeaseId] } } });
  await prisma.unit.deleteMany({ where: { id: { in: [unitId, otherUnitId] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.property.deleteMany({ where: { id: { in: [propertyId, otherPropertyId] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
  await prisma.$disconnect();
});

// ── GET /api/payments ──

describe("GET /api/payments", () => {
  it("returns payments for authenticated user with pagination", async () => {
    const { GET } = await import("@/app/api/payments/route");
    const req = new NextRequest("http://localhost/api/payments?page=1&limit=25");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.payments).toBeDefined();
    expect(data.pagination).toBeDefined();
    expect(data.pagination.page).toBe(1);
    expect(data.pagination.limit).toBe(25);
    expect(data.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it("returns only the authenticated user's payments (data isolation)", async () => {
    const { GET } = await import("@/app/api/payments/route");
    const req = new NextRequest("http://localhost/api/payments");
    const res = await GET(req);
    const data = await res.json();

    // Should not contain other user's 120000 payment
    for (const p of data.payments) {
      expect(p.tenantId).toBe(tenantId);
    }
    const amounts = data.payments.map((p: any) => p.amount);
    expect(amounts).not.toContain(120000);
  });

  it("includes tenant and lease info in each payment", async () => {
    const { GET } = await import("@/app/api/payments/route");
    const req = new NextRequest("http://localhost/api/payments");
    const res = await GET(req);
    const data = await res.json();

    for (const p of data.payments) {
      expect(p.tenant).toBeDefined();
      expect(p.tenant.firstName).toBe("WFPay");
      expect(p.lease).toBeDefined();
      expect(p.lease.unit).toBeDefined();
    }
  });

  it("filters by method", async () => {
    const { GET } = await import("@/app/api/payments/route");
    const req = new NextRequest("http://localhost/api/payments?method=ach");
    const res = await GET(req);
    const data = await res.json();

    expect(data.payments.length).toBeGreaterThanOrEqual(1);
    for (const p of data.payments) {
      expect(p.method).toBe("ach");
    }
  });

  it("filters by status", async () => {
    const { GET } = await import("@/app/api/payments/route");
    const req = new NextRequest("http://localhost/api/payments?status=completed");
    const res = await GET(req);
    const data = await res.json();

    for (const p of data.payments) {
      expect(p.status).toBe("completed");
    }
  });

  it("returns 401 when not authenticated", async () => {
    const savedId = mockSession.user.id;
    // Temporarily clear session
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/payments/route");
    const req = new NextRequest("http://localhost/api/payments");
    const res = await GET(req);

    expect(res.status).toBe(401);
    mockSession.user.id = savedId;
  });

  it("paginates correctly with page and limit", async () => {
    const { GET } = await import("@/app/api/payments/route");
    const req = new NextRequest("http://localhost/api/payments?page=1&limit=1");
    const res = await GET(req);
    const data = await res.json();

    expect(data.payments.length).toBe(1);
    expect(data.pagination.limit).toBe(1);
    expect(data.pagination.pages).toBeGreaterThanOrEqual(2);
  });
});

// ── GET /api/payments/overdue ──

describe("GET /api/payments/overdue", () => {
  it("returns overdue tenants with unpaid charges past due", async () => {
    const { GET } = await import("@/app/api/payments/overdue/route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.overdueTenants).toBeDefined();
    expect(Array.isArray(data.overdueTenants)).toBe(true);
    expect(data.overdueTenants.length).toBeGreaterThanOrEqual(1);
  });

  it("returns overdue tenant with correct shape", async () => {
    const { GET } = await import("@/app/api/payments/overdue/route");
    const res = await GET();
    const data = await res.json();

    const entry = data.overdueTenants.find((t: any) => t.tenantId === tenantId);
    expect(entry).toBeDefined();
    expect(entry.tenantName).toBe("WFPay Tester");
    expect(entry.propertyName).toBe("WF Pay Property");
    expect(entry.amountOwed).toBeGreaterThan(0);
    expect(entry.chargeCount).toBeGreaterThanOrEqual(1);
    expect(entry.oldestDueDate).toBeDefined();
    expect(entry.leaseId).toBe(leaseId);
  });

  it("does NOT include other user's overdue tenants (data isolation)", async () => {
    const { GET } = await import("@/app/api/payments/overdue/route");
    const res = await GET();
    const data = await res.json();

    const tenantIds = data.overdueTenants.map((t: any) => t.tenantId);
    expect(tenantIds).not.toContain(otherTenantId);
  });

  it("sorts by amount owed descending", async () => {
    const { GET } = await import("@/app/api/payments/overdue/route");
    const res = await GET();
    const data = await res.json();

    for (let i = 1; i < data.overdueTenants.length; i++) {
      expect(data.overdueTenants[i - 1].amountOwed).toBeGreaterThanOrEqual(
        data.overdueTenants[i].amountOwed
      );
    }
  });
});

// ── POST /api/payments/offline ──

describe("POST /api/payments/offline", () => {
  it("records a cash payment and applies FIFO", async () => {
    const { POST } = await import("@/app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId,
        tenantId,
        amount: 150000,
        method: "cash",
        forMonth: new Date(2025, 10, 1).toISOString(),
        description: "Cash rent payment",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.payment).toBeDefined();
    expect(data.payment.method).toBe("cash");
    expect(data.payment.status).toBe("completed");
    expect(data.payment.amount).toBe(150000);
    expect(data.applied).toBeDefined();
    expect(data.applied.length).toBeGreaterThanOrEqual(1);
    // FIFO: oldest charge should be applied first
    expect(data.applied[0].applied).toBe(150000);
  });

  it("returns 400 when required fields are missing", async () => {
    const { POST } = await import("@/app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({ leaseId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid method", async () => {
    const { POST } = await import("@/app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId,
        tenantId,
        amount: 100000,
        method: "money_order",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("cash");
  });

  it("returns 400 for non-positive amount", async () => {
    const { POST } = await import("@/app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId,
        tenantId,
        amount: -500,
        method: "cash",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when lease does not belong to user", async () => {
    const { POST } = await import("@/app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId: otherLeaseId,
        tenantId,
        amount: 100000,
        method: "cash",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 404 when tenant does not belong to user", async () => {
    const { POST } = await import("@/app/api/payments/offline/route");

    const req = new NextRequest("http://localhost/api/payments/offline", {
      method: "POST",
      body: JSON.stringify({
        leaseId,
        tenantId: otherTenantId,
        amount: 100000,
        method: "cash",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});
