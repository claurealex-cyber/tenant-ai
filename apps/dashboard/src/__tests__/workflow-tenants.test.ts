import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_wf_tenants_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

// ── Test IDs ──
let userId: string;
let otherUserId: string;
let propertyId: string;
let otherPropertyId: string;
let unitId: string;
let tenantId: string;
let otherTenantId: string;
let leaseId: string;

// ── Mock getServerSession ──
let mockSessionUserId: string;

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      user: { id: mockSessionUserId, role: "client", email: "test@test.com" },
    });
  }),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

// Mock sendEmail to avoid actual emails during tests
vi.mock("@tenant-ai/shared", async () => {
  const actual = await vi.importActual<typeof import("@tenant-ai/shared")>("@tenant-ai/shared");
  return {
    ...actual,
    sendEmail: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Setup & Teardown ──

beforeAll(async () => {
  await prisma.$connect();

  // Two landlords for isolation testing
  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "Workflow Tenant Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;
  mockSessionUserId = userId;

  const otherUser = await prisma.user.create({
    data: {
      email: testEmail("other"),
      name: "Other Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  otherUserId = otherUser.id;

  // Properties
  const property = await prisma.property.create({
    data: {
      name: "Workflow Tenant Property",
      address: "100 Tenant Workflow St, Chicago IL 60601",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const otherProperty = await prisma.property.create({
    data: {
      name: "Other Landlord Property",
      address: "200 Other St",
      userId: otherUserId,
    },
  });
  otherPropertyId = otherProperty.id;

  // Unit for lease
  const unit = await prisma.unit.create({
    data: {
      propertyId,
      unitNumber: "WF-1",
      monthlyRent: 150000,
      status: "occupied",
    },
  });
  unitId = unit.id;

  // Create a tenant for the main user
  const tenant = await prisma.tenant.create({
    data: {
      firstName: "Existing",
      lastName: "Tenant",
      email: testEmail("existing_tenant"),
      phone: "+13125550010",
      passwordHash: await bcrypt.hash("tenantpass", 12),
      userId,
    },
  });
  tenantId = tenant.id;

  // Create a tenant for the other user (for IDOR tests)
  const otherTenant = await prisma.tenant.create({
    data: {
      firstName: "Other",
      lastName: "Tenant",
      email: testEmail("other_tenant"),
      passwordHash: await bcrypt.hash("tenantpass", 12),
      userId: otherUserId,
    },
  });
  otherTenantId = otherTenant.id;

  // Lease and payment for tenant detail
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

  // Create a payment for the tenant
  await prisma.payment.create({
    data: {
      leaseId,
      tenantId,
      amount: 150000,
      type: "rent",
      method: "ach",
      status: "completed",
      forMonth: new Date(2026, 0, 1),
      paidAt: new Date(2026, 0, 3),
    },
  });
});

afterAll(async () => {
  // Clean up in order respecting foreign keys
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.tenantInvite.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.payment.deleteMany({
    where: { tenantId: { in: [tenantId, otherTenantId] } },
  });
  await prisma.lease.deleteMany({
    where: { unit: { propertyId: { in: [propertyId, otherPropertyId] } } },
  });
  await prisma.unit.deleteMany({
    where: { propertyId: { in: [propertyId, otherPropertyId] } },
  });
  // Delete tenants belonging to our test users (including any created during tests)
  await prisma.tenant.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.application.deleteMany({
    where: { propertyId: { in: [propertyId, otherPropertyId] } },
  });
  await prisma.property.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ────────────────────────────────────────────────────────────────
// GET /api/tenants
// ────────────────────────────────────────────────────────────────

describe("GET /api/tenants", () => {
  it("returns tenants array for the authenticated user", async () => {
    mockSessionUserId = userId;
    const { GET } = await import("@/app/api/tenants/route");

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tenants).toBeDefined();
    expect(Array.isArray(data.tenants)).toBe(true);
    expect(data.tenants.length).toBeGreaterThanOrEqual(1);

    const existing = data.tenants.find((t: any) => t.id === tenantId);
    expect(existing).toBeDefined();
    expect(existing.firstName).toBe("Existing");
    expect(existing.lastName).toBe("Tenant");
  });

  it("includes active lease with property info", async () => {
    mockSessionUserId = userId;
    const { GET } = await import("@/app/api/tenants/route");

    const res = await GET();
    const data = await res.json();

    const existing = data.tenants.find((t: any) => t.id === tenantId);
    expect(existing.leases).toBeDefined();
    expect(existing.leases.length).toBeGreaterThanOrEqual(1);
    expect(existing.leases[0].unit).toBeDefined();
    expect(existing.leases[0].unit.property).toBeDefined();
    expect(existing.leases[0].unit.property.name).toBe(
      "Workflow Tenant Property",
    );
  });

  it("only returns current user's tenants (data isolation)", async () => {
    mockSessionUserId = userId;
    const { GET } = await import("@/app/api/tenants/route");

    const res = await GET();
    const data = await res.json();

    const ids = data.tenants.map((t: any) => t.id);
    expect(ids).not.toContain(otherTenantId);
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/tenants/route");

    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// ────────────────────────────────────────────────────────────────
// POST /api/tenants
// ────────────────────────────────────────────────────────────────

describe("POST /api/tenants", () => {
  it("creates a tenant with firstName, lastName, email, phone", async () => {
    mockSessionUserId = userId;
    const { POST } = await import("@/app/api/tenants/route");

    const req = new NextRequest("http://localhost/api/tenants", {
      method: "POST",
      body: JSON.stringify({
        firstName: "New",
        lastName: "Renter",
        email: testEmail("new_renter"),
        phone: "+13125550099",
      }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.tenant).toBeDefined();
    expect(data.tenant.firstName).toBe("New");
    expect(data.tenant.lastName).toBe("Renter");
    expect(data.tenant.email).toBe(testEmail("new_renter"));
    expect(data.tenant.phone).toBe("+13125550099");
    expect(data.tenant.userId).toBe(userId);
    expect(data.tempPassword).toBeDefined();
    expect(data.tempPassword.length).toBeGreaterThan(0);
  });

  it("returns 400 for missing required fields", async () => {
    mockSessionUserId = userId;
    const { POST } = await import("@/app/api/tenants/route");

    // Missing lastName and email
    const req = new NextRequest("http://localhost/api/tenants", {
      method: "POST",
      body: JSON.stringify({
        firstName: "Only",
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns 400 for missing email", async () => {
    mockSessionUserId = userId;
    const { POST } = await import("@/app/api/tenants/route");

    const req = new NextRequest("http://localhost/api/tenants", {
      method: "POST",
      body: JSON.stringify({
        firstName: "No",
        lastName: "Email",
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 409 for duplicate email under same landlord", async () => {
    mockSessionUserId = userId;
    const { POST } = await import("@/app/api/tenants/route");

    const req = new NextRequest("http://localhost/api/tenants", {
      method: "POST",
      body: JSON.stringify({
        firstName: "Duplicate",
        lastName: "Tenant",
        email: testEmail("existing_tenant"),
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already exists");
  });
});

// ────────────────────────────────────────────────────────────────
// GET /api/tenants/[id]
// ────────────────────────────────────────────────────────────────

describe("GET /api/tenants/[id]", () => {
  it("returns tenant detail with leases and payment history", async () => {
    mockSessionUserId = userId;
    const { GET } = await import("@/app/api/tenants/[id]/route");

    const req = new NextRequest(
      `http://localhost/api/tenants/${tenantId}`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ id: tenantId }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tenant).toBeDefined();
    expect(data.tenant.id).toBe(tenantId);
    expect(data.tenant.firstName).toBe("Existing");
    expect(data.tenant.lastName).toBe("Tenant");

    // Leases
    expect(data.tenant.leases).toBeDefined();
    expect(Array.isArray(data.tenant.leases)).toBe(true);
    expect(data.tenant.leases.length).toBeGreaterThanOrEqual(1);
    expect(data.tenant.leases[0].unit).toBeDefined();
    expect(data.tenant.leases[0].unit.property).toBeDefined();

    // Payments
    expect(data.tenant.payments).toBeDefined();
    expect(Array.isArray(data.tenant.payments)).toBe(true);
    expect(data.tenant.payments.length).toBeGreaterThanOrEqual(1);
    expect(data.tenant.payments[0].amount).toBe(150000);
  });

  it("returns 404 for non-existent tenant", async () => {
    mockSessionUserId = userId;
    const { GET } = await import("@/app/api/tenants/[id]/route");

    const req = new NextRequest(
      "http://localhost/api/tenants/nonexistent-id-99999",
    );
    const res = await GET(req, {
      params: Promise.resolve({ id: "nonexistent-id-99999" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 404 for other user's tenant (IDOR protection)", async () => {
    mockSessionUserId = userId;
    const { GET } = await import("@/app/api/tenants/[id]/route");

    const req = new NextRequest(
      `http://localhost/api/tenants/${otherTenantId}`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ id: otherTenantId }),
    });

    expect(res.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────
// PUT /api/tenants/[id]
// ────────────────────────────────────────────────────────────────

describe("PUT /api/tenants/[id]", () => {
  it("updates tenant fields (phone)", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import("@/app/api/tenants/[id]/route");

    const req = new NextRequest(
      `http://localhost/api/tenants/${tenantId}`,
      {
        method: "PUT",
        body: JSON.stringify({ phone: "+13125550088" }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: tenantId }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tenant.phone).toBe("+13125550088");
  });

  it("updates tenant firstName and lastName", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import("@/app/api/tenants/[id]/route");

    const req = new NextRequest(
      `http://localhost/api/tenants/${tenantId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          firstName: "Updated",
          lastName: "Name",
        }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: tenantId }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tenant.firstName).toBe("Updated");
    expect(data.tenant.lastName).toBe("Name");
  });

  it("returns 404 for other user's tenant", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import("@/app/api/tenants/[id]/route");

    const req = new NextRequest(
      `http://localhost/api/tenants/${otherTenantId}`,
      {
        method: "PUT",
        body: JSON.stringify({ phone: "+10000000000" }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: otherTenantId }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 409 when updating email to one already in use", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import("@/app/api/tenants/[id]/route");

    // Create another tenant to conflict with
    const conflictTenant = await prisma.tenant.create({
      data: {
        firstName: "Conflict",
        lastName: "Tenant",
        email: testEmail("conflict_tenant"),
        passwordHash: await bcrypt.hash("pass", 12),
        userId,
      },
    });

    const req = new NextRequest(
      `http://localhost/api/tenants/${tenantId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          email: testEmail("conflict_tenant"),
        }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: tenantId }),
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already exists");
  });
});

// ────────────────────────────────────────────────────────────────
// POST /api/tenants/invite
// ────────────────────────────────────────────────────────────────

describe("POST /api/tenants/invite", () => {
  it("creates invite with token and 72-hour expiry", async () => {
    mockSessionUserId = userId;
    const { POST } = await import("@/app/api/tenants/invite/route");

    const req = new NextRequest("http://localhost/api/tenants/invite", {
      method: "POST",
      body: JSON.stringify({
        email: testEmail("invitee"),
        propertyId,
      }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.invite).toBeDefined();
    expect(data.invite.token).toBeDefined();
    expect(data.invite.token.length).toBeGreaterThan(0);
    expect(data.invite.email).toBe(testEmail("invitee"));
    expect(data.invite.propertyId).toBe(propertyId);

    // Verify expiry is roughly 72 hours from now
    const expiresAt = new Date(data.invite.expiresAt).getTime();
    const expectedExpiry = Date.now() + 72 * 60 * 60 * 1000;
    const diffMs = Math.abs(expiresAt - expectedExpiry);
    expect(diffMs).toBeLessThan(60_000); // within 1 minute
  });

  it("returns 400 for missing email", async () => {
    mockSessionUserId = userId;
    const { POST } = await import("@/app/api/tenants/invite/route");

    const req = new NextRequest("http://localhost/api/tenants/invite", {
      method: "POST",
      body: JSON.stringify({
        propertyId,
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing propertyId", async () => {
    mockSessionUserId = userId;
    const { POST } = await import("@/app/api/tenants/invite/route");

    const req = new NextRequest("http://localhost/api/tenants/invite", {
      method: "POST",
      body: JSON.stringify({
        email: "someone@test.com",
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 404 for property not owned by user", async () => {
    mockSessionUserId = userId;
    const { POST } = await import("@/app/api/tenants/invite/route");

    const req = new NextRequest("http://localhost/api/tenants/invite", {
      method: "POST",
      body: JSON.stringify({
        email: "someone@test.com",
        propertyId: otherPropertyId,
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────
// POST /api/tenants/[id]/convert (application to tenant conversion)
// ────────────────────────────────────────────────────────────────

describe("POST /api/tenants/[id]/convert", () => {
  let convertibleAppId: string;

  beforeAll(async () => {
    // Create a reviewed application that can be converted
    const app = await prisma.application.create({
      data: {
        propertyId,
        status: "reviewed",
        channel: "voice",
        callerPhone: "+13125550050",
        fullName: "Convert Candidate",
        email: testEmail("convertible"),
      },
    });
    convertibleAppId = app.id;
  });

  it("converts application data into tenant record", async () => {
    mockSessionUserId = userId;
    const { POST } = await import(
      "@/app/api/tenants/[id]/convert/route"
    );

    const req = new NextRequest(
      `http://localhost/api/tenants/${convertibleAppId}/convert`,
      { method: "POST" },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: convertibleAppId }),
    });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.tenant).toBeDefined();
    expect(data.tenant.email).toBe(testEmail("convertible"));
    expect(data.tenant.firstName).toBe("Convert");
    expect(data.tenant.lastName).toBe("Candidate");
    expect(data.inviteToken).toBeDefined();
    expect(data.inviteToken.length).toBeGreaterThan(0);
  });

  it("returns 409 when tenant already exists for that email", async () => {
    mockSessionUserId = userId;
    const { POST } = await import(
      "@/app/api/tenants/[id]/convert/route"
    );

    // Try to convert the same application again (tenant already created above)
    const req = new NextRequest(
      `http://localhost/api/tenants/${convertibleAppId}/convert`,
      { method: "POST" },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: convertibleAppId }),
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already exists");
  });

  it("returns 400 for application not in reviewed/completed status", async () => {
    mockSessionUserId = userId;

    // Create an in_progress application
    const inProgressApp = await prisma.application.create({
      data: {
        propertyId,
        status: "in_progress",
        channel: "voice",
        callerPhone: "+13125550060",
        fullName: "Not Ready",
        email: testEmail("not_ready"),
      },
    });

    const { POST } = await import(
      "@/app/api/tenants/[id]/convert/route"
    );

    const req = new NextRequest(
      `http://localhost/api/tenants/${inProgressApp.id}/convert`,
      { method: "POST" },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: inProgressApp.id }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("reviewed or completed");
  });

  it("returns 400 for application without email", async () => {
    mockSessionUserId = userId;

    // Create reviewed app without email
    const noEmailApp = await prisma.application.create({
      data: {
        propertyId,
        status: "reviewed",
        channel: "voice",
        callerPhone: "+13125550070",
        fullName: "No Email Person",
      },
    });

    const { POST } = await import(
      "@/app/api/tenants/[id]/convert/route"
    );

    const req = new NextRequest(
      `http://localhost/api/tenants/${noEmailApp.id}/convert`,
      { method: "POST" },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: noEmailApp.id }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("email");
  });

  it("converts with lease when unitId + monthlyRent + startDate provided", async () => {
    mockSessionUserId = userId;

    // Create a fresh unit for this lease
    const convertUnit = await prisma.unit.create({
      data: { propertyId, unitNumber: "CVT-1", monthlyRent: 120000 },
    });

    // Create a new convertible app (different email since previous was already converted)
    const leaseApp = await prisma.application.create({
      data: {
        propertyId,
        status: "reviewed",
        channel: "web",
        fullName: "Lease Convert",
        email: testEmail("lease_convert"),
      },
    });

    const { POST } = await import("@/app/api/tenants/[id]/convert/route");
    const req = new NextRequest(
      `http://localhost/api/tenants/${leaseApp.id}/convert`,
      {
        method: "POST",
        body: JSON.stringify({
          unitId: convertUnit.id,
          monthlyRent: 120000,
          startDate: "2026-03-01",
        }),
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ id: leaseApp.id }),
    });

    const data = await res.json();
    if (res.status !== 201) {
      console.error("Convert with lease failed:", data);
    }
    expect(res.status).toBe(201);
    expect(data.tenant).toBeDefined();
    expect(data.lease).toBeDefined();
    expect(data.lease.unitId).toBe(convertUnit.id);
    expect(data.lease.monthlyRent).toBe(120000);

    // Verify unit status updated
    const updatedUnit = await prisma.unit.findUnique({ where: { id: convertUnit.id } });
    expect(updatedUnit!.status).toBe("occupied");
  });

  it("converts without lease when no unitId provided (backward compatible)", async () => {
    mockSessionUserId = userId;

    const noLeaseApp = await prisma.application.create({
      data: {
        propertyId,
        status: "reviewed",
        channel: "web",
        fullName: "No Lease Convert",
        email: testEmail("nolease_convert"),
      },
    });

    const { POST } = await import("@/app/api/tenants/[id]/convert/route");
    const req = new NextRequest(
      `http://localhost/api/tenants/${noLeaseApp.id}/convert`,
      { method: "POST" },
    );

    const res = await POST(req, {
      params: Promise.resolve({ id: noLeaseApp.id }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.tenant).toBeDefined();
    expect(data.lease).toBeUndefined();
  });

  it("returns 404 for other user's application", async () => {
    mockSessionUserId = userId;

    // Create application for the other user
    const otherApp = await prisma.application.create({
      data: {
        propertyId: otherPropertyId,
        status: "reviewed",
        channel: "web",
        fullName: "Other User App",
        email: testEmail("other_convert"),
      },
    });

    const { POST } = await import(
      "@/app/api/tenants/[id]/convert/route"
    );

    const req = new NextRequest(
      `http://localhost/api/tenants/${otherApp.id}/convert`,
      { method: "POST" },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: otherApp.id }),
    });

    expect(res.status).toBe(404);
  });
});
