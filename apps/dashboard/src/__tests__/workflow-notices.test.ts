import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_wf_notice_${Date.now()}`;

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
let noticeId: string; // for detail / update tests

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
      name: "WF Notice Landlord",
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
    data: {
      name: "WF Notice Property",
      address: "300 Legal Ave, Chicago IL 60601",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const otherProperty = await prisma.property.create({
    data: {
      name: "Other Property",
      address: "999 Other St",
      userId: otherUserId,
      isActive: true,
    },
  });
  otherPropertyId = otherProperty.id;

  const unit = await prisma.unit.create({
    data: { propertyId, unitNumber: "WFN-1A", monthlyRent: 150000 },
  });
  unitId = unit.id;

  const otherUnit = await prisma.unit.create({
    data: { propertyId: otherPropertyId, unitNumber: "WFN-O1", monthlyRent: 100000 },
  });
  otherUnitId = otherUnit.id;

  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Legal",
      lastName: "Notice",
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
      startDate: new Date(2025, 0, 1),
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
      monthlyRent: 100000,
      startDate: new Date(2025, 0, 1),
      status: "active",
      rentDueDay: 1,
      lateFeeGraceDays: 5,
    },
  });
  otherLeaseId = otherLease.id;

  // Create an overdue rent charge for 5-day notice
  await prisma.rentCharge.create({
    data: {
      leaseId,
      amount: 150000,
      type: "rent",
      forMonth: new Date(2025, 5, 1),
      dueDate: new Date(2025, 5, 1),
      status: "unpaid",
      paidAmount: 0,
    },
  });

  // Seed some notices for listing tests
  const notice = await prisma.notice.create({
    data: {
      leaseId,
      tenantId,
      type: "five_day",
      reason: "non_payment",
      amountOwed: 150000,
      content: "FIVE-DAY NOTICE seed for testing",
      visibleInPortal: true,
    },
  });
  noticeId = notice.id;

  await prisma.notice.create({
    data: {
      leaseId,
      tenantId,
      type: "ten_day",
      reason: "lease_violation",
      content: "TEN-DAY NOTICE seed for testing",
      visibleInPortal: true,
    },
  });

  // Other user's notice
  await prisma.notice.create({
    data: {
      leaseId: otherLeaseId,
      tenantId: otherTenantId,
      type: "five_day",
      reason: "non_payment",
      amountOwed: 100000,
      content: "Other landlord's notice",
      visibleInPortal: true,
    },
  });
});

afterAll(async () => {
  await prisma.notice.deleteMany({ where: { leaseId: { in: [leaseId, otherLeaseId] } } });
  await prisma.rentCharge.deleteMany({ where: { leaseId: { in: [leaseId, otherLeaseId] } } });
  await prisma.lease.deleteMany({ where: { id: { in: [leaseId, otherLeaseId] } } });
  await prisma.unit.deleteMany({ where: { id: { in: [unitId, otherUnitId] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.property.deleteMany({ where: { id: { in: [propertyId, otherPropertyId] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
  await prisma.$disconnect();
});

// ── GET /api/notices ──

describe("GET /api/notices", () => {
  it("returns notices array", async () => {
    const { GET } = await import("@/app/api/notices/route");
    const req = new NextRequest("http://localhost/api/notices");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.notices).toBeDefined();
    expect(Array.isArray(data.notices)).toBe(true);
    expect(data.notices.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by ?type=five_day", async () => {
    const { GET } = await import("@/app/api/notices/route");
    const req = new NextRequest("http://localhost/api/notices?type=five_day");
    const res = await GET(req);
    const data = await res.json();

    expect(data.notices.length).toBeGreaterThanOrEqual(1);
    for (const n of data.notices) {
      expect(n.type).toBe("five_day");
    }
  });

  it("filters by ?type=ten_day", async () => {
    const { GET } = await import("@/app/api/notices/route");
    const req = new NextRequest("http://localhost/api/notices?type=ten_day");
    const res = await GET(req);
    const data = await res.json();

    expect(data.notices.length).toBeGreaterThanOrEqual(1);
    for (const n of data.notices) {
      expect(n.type).toBe("ten_day");
    }
  });

  it("includes tenant and lease info", async () => {
    const { GET } = await import("@/app/api/notices/route");
    const req = new NextRequest("http://localhost/api/notices");
    const res = await GET(req);
    const data = await res.json();

    const notice = data.notices[0];
    expect(notice.tenant).toBeDefined();
    expect(notice.tenant.firstName).toBe("Legal");
    expect(notice.lease).toBeDefined();
    expect(notice.lease.unit).toBeDefined();
    expect(notice.lease.unit.property).toBeDefined();
  });

  it("enforces data isolation - only returns authenticated user's notices", async () => {
    const { GET } = await import("@/app/api/notices/route");
    const req = new NextRequest("http://localhost/api/notices");
    const res = await GET(req);
    const data = await res.json();

    for (const n of data.notices) {
      expect(n.tenantId).toBe(tenantId);
      expect(n.leaseId).toBe(leaseId);
    }
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/notices/route");
    const req = new NextRequest("http://localhost/api/notices");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});

// ── POST /api/notices ──

describe("POST /api/notices", () => {
  it("creates a five_day notice with overdue rent", async () => {
    const { POST } = await import("@/app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "five_day",
        leaseId,
        tenantId,
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.notice).toBeDefined();
    expect(data.notice.type).toBe("five_day");
    expect(data.notice.reason).toBe("non_payment");
    expect(data.notice.content).toContain("FIVE-DAY NOTICE");
    expect(data.notice.content).toContain("735 ILCS 5/9-209");
    expect(data.notice.visibleInPortal).toBe(true);
  });

  it("creates a ten_day notice with violation description", async () => {
    const { POST } = await import("@/app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "ten_day",
        leaseId,
        tenantId,
        violationDescription: "Unauthorized subletting of apartment",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.notice.type).toBe("ten_day");
    expect(data.notice.reason).toBe("lease_violation");
    expect(data.notice.content).toContain("TEN-DAY NOTICE");
    expect(data.notice.content).toContain("735 ILCS 5/9-210");
    expect(data.notice.content).toContain("Unauthorized subletting");
  });

  it("creates a thirty_day notice with valid effective date", async () => {
    const { POST } = await import("@/app/api/notices/route");

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 45);

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "thirty_day",
        leaseId,
        tenantId,
        effectiveDate: futureDate.toISOString(),
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.notice.type).toBe("thirty_day");
    expect(data.notice.reason).toBe("termination");
    expect(data.notice.content).toContain("THIRTY-DAY NOTICE");
    expect(data.notice.content).toContain("735 ILCS 5/9-207");
  });

  it("returns 400 when required fields are missing", async () => {
    const { POST } = await import("@/app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({ type: "five_day" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("required");
  });

  it("returns 400 for invalid notice type", async () => {
    const { POST } = await import("@/app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "three_day",
        leaseId,
        tenantId,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid notice type");
  });

  it("returns 400 for ten_day notice without violationDescription", async () => {
    const { POST } = await import("@/app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "ten_day",
        leaseId,
        tenantId,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("violationDescription");
  });

  it("returns 400 for thirty_day notice without effectiveDate", async () => {
    const { POST } = await import("@/app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "thirty_day",
        leaseId,
        tenantId,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("effectiveDate");
  });

  it("returns 400 for thirty_day notice with effective date less than 30 days away", async () => {
    const { POST } = await import("@/app/api/notices/route");

    const tooSoon = new Date();
    tooSoon.setDate(tooSoon.getDate() + 15);

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "thirty_day",
        leaseId,
        tenantId,
        effectiveDate: tooSoon.toISOString(),
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("30 days");
  });

  it("returns 404 for lease belonging to another user", async () => {
    const { POST } = await import("@/app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "five_day",
        leaseId: otherLeaseId,
        tenantId,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});

// ── GET /api/notices/[id] ──

describe("GET /api/notices/[id]", () => {
  it("returns notice detail with tenant and lease info", async () => {
    const { GET } = await import("@/app/api/notices/[id]/route");

    const req = new NextRequest(`http://localhost/api/notices/${noticeId}`);
    const res = await GET(req, { params: Promise.resolve({ id: noticeId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.notice).toBeDefined();
    expect(data.notice.id).toBe(noticeId);
    expect(data.notice.tenant).toBeDefined();
    expect(data.notice.tenant.firstName).toBe("Legal");
    expect(data.notice.tenant.lastName).toBe("Notice");
    expect(data.notice.lease).toBeDefined();
    expect(data.notice.lease.unit.property.name).toBe("WF Notice Property");
  });

  it("returns 404 for non-existent notice", async () => {
    const { GET } = await import("@/app/api/notices/[id]/route");

    const req = new NextRequest("http://localhost/api/notices/nonexistent-id");
    const res = await GET(req, { params: Promise.resolve({ id: "nonexistent-id" }) });

    expect(res.status).toBe(404);
  });

  it("returns 404 for another user's notice (data isolation)", async () => {
    // Get other user's notice id
    const otherNotice = await prisma.notice.findFirst({
      where: { leaseId: otherLeaseId },
    });
    expect(otherNotice).not.toBeNull();

    const { GET } = await import("@/app/api/notices/[id]/route");
    const req = new NextRequest(`http://localhost/api/notices/${otherNotice!.id}`);
    const res = await GET(req, { params: Promise.resolve({ id: otherNotice!.id }) });

    expect(res.status).toBe(404);
  });
});

// ── PUT /api/notices/[id] ──

describe("PUT /api/notices/[id]", () => {
  it("updates service info with personal service", async () => {
    const { PUT } = await import("@/app/api/notices/[id]/route");

    const req = new NextRequest(`http://localhost/api/notices/${noticeId}`, {
      method: "PUT",
      body: JSON.stringify({
        serviceMethod: "personal",
        serviceDate: new Date(2026, 1, 10).toISOString(),
        servedBy: "Process Server John",
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: noticeId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.notice).toBeDefined();
    expect(data.notice.serviceMethod).toBe("personal");
    expect(data.notice.servedBy).toBe("Process Server John");
    expect(data.notice.serviceConfirmed).toBe(true);
    expect(data.notice.effectiveDate).toBeDefined();
    expect(data.notice.expirationDate).toBeDefined();
  });

  it("updates with certified_mail service and tracking", async () => {
    // Create a separate notice for this test
    const certNotice = await prisma.notice.create({
      data: {
        leaseId,
        tenantId,
        type: "ten_day",
        reason: "lease_violation",
        content: "Certified mail test notice",
        visibleInPortal: true,
      },
    });

    const { PUT } = await import("@/app/api/notices/[id]/route");

    const req = new NextRequest(`http://localhost/api/notices/${certNotice.id}`, {
      method: "PUT",
      body: JSON.stringify({
        serviceMethod: "certified_mail",
        serviceDate: new Date(2026, 1, 10).toISOString(),
        servedBy: "USPS",
        certifiedMailTracking: "7020 3440 0001 2345 6789",
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: certNotice.id }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.notice.serviceMethod).toBe("certified_mail");
    expect(data.notice.certifiedMailTracking).toBe("7020 3440 0001 2345 6789");
    expect(data.notice.serviceConfirmed).toBe(true);
  });

  it("returns 400 for invalid service method", async () => {
    const { PUT } = await import("@/app/api/notices/[id]/route");

    const req = new NextRequest(`http://localhost/api/notices/${noticeId}`, {
      method: "PUT",
      body: JSON.stringify({
        serviceMethod: "email",
        serviceDate: new Date().toISOString(),
        servedBy: "Someone",
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: noticeId }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when serviceDate is missing", async () => {
    const { PUT } = await import("@/app/api/notices/[id]/route");

    const req = new NextRequest(`http://localhost/api/notices/${noticeId}`, {
      method: "PUT",
      body: JSON.stringify({
        serviceMethod: "personal",
        servedBy: "Someone",
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: noticeId }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when servedBy is missing", async () => {
    const { PUT } = await import("@/app/api/notices/[id]/route");

    const req = new NextRequest(`http://localhost/api/notices/${noticeId}`, {
      method: "PUT",
      body: JSON.stringify({
        serviceMethod: "personal",
        serviceDate: new Date().toISOString(),
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: noticeId }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 for certified_mail without tracking number", async () => {
    const { PUT } = await import("@/app/api/notices/[id]/route");

    const req = new NextRequest(`http://localhost/api/notices/${noticeId}`, {
      method: "PUT",
      body: JSON.stringify({
        serviceMethod: "certified_mail",
        serviceDate: new Date().toISOString(),
        servedBy: "USPS",
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: noticeId }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("certifiedMailTracking");
  });

  it("returns 404 for other user's notice (data isolation)", async () => {
    const otherNotice = await prisma.notice.findFirst({
      where: { leaseId: otherLeaseId },
    });

    const { PUT } = await import("@/app/api/notices/[id]/route");

    const req = new NextRequest(`http://localhost/api/notices/${otherNotice!.id}`, {
      method: "PUT",
      body: JSON.stringify({
        serviceMethod: "personal",
        serviceDate: new Date().toISOString(),
        servedBy: "Someone",
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: otherNotice!.id }) });
    expect(res.status).toBe(404);
  });
});
