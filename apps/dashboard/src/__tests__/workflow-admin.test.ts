import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { NextRequest } from "next/server";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_wfadmin_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let adminId: string;
let clientId: string;
let tierId: string;
let subscriptionId: string;
let propertyId: string;

// ── Mocks ──

const mockGetServerSession = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: new PrismaClient(),
}));

function mockAdminSession() {
  mockGetServerSession.mockResolvedValue({
    user: { id: adminId, role: "admin", email: testEmail("admin") },
  });
}

function mockClientSession() {
  mockGetServerSession.mockResolvedValue({
    user: { id: clientId, role: "client", email: testEmail("client") },
  });
}

function mockNoSession() {
  mockGetServerSession.mockResolvedValue(null);
}

beforeAll(async () => {
  await prisma.$connect();

  const admin = await prisma.user.create({
    data: {
      email: testEmail("admin"),
      name: "Workflow Admin",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "admin",
      onboarded: true,
    },
  });
  adminId = admin.id;

  const tier = await prisma.pricingTier.create({
    data: {
      name: `${TEST_PREFIX}_basic`,
      displayName: "Test Basic",
      basePriceCents: 2000,
      includedAiCents: 1000,
      aiMarkupPercent: 50,
      maxProperties: 3,
      maxPhoneNumbers: 2,
      websiteEnabled: true,
      customDomainEnabled: false,
      sortOrder: 0,
    },
  });
  tierId = tier.id;

  const client = await prisma.user.create({
    data: {
      email: testEmail("client"),
      name: "Workflow Client",
      companyName: "Workflow Properties LLC",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  clientId = client.id;

  const sub = await prisma.subscription.create({
    data: {
      userId: clientId,
      tierId,
      status: "active",
      currentPeriodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      currentPeriodEnd: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
    },
  });
  subscriptionId = sub.id;

  const prop = await prisma.property.create({
    data: {
      name: "Admin Test Property",
      address: "100 Admin St",
      userId: clientId,
      isActive: true,
    },
  });
  propertyId = prop.id;

  // Use local-time billing month to match the route handler's:
  //   new Date(now.getFullYear(), now.getMonth(), 1)
  const now = new Date();
  const billingMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  await prisma.usageRecord.createMany({
    data: [
      { userId: clientId, propertyId, type: "voice_call", costCents: 300, quantity: 1, durationSeconds: 500, billingMonth },
      { userId: clientId, propertyId, type: "sms", costCents: 40, quantity: 4, billingMonth },
    ],
  });
});

afterAll(async () => {
  await prisma.usageRecord.deleteMany({ where: { userId: clientId } });
  await prisma.invoice.deleteMany({ where: { subscriptionId } });
  await prisma.subscription.deleteMany({ where: { id: subscriptionId } });
  await prisma.property.deleteMany({ where: { userId: clientId } });
  await prisma.pricingTier.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET /api/admin/clients ──

describe("GET /api/admin/clients", () => {
  it("returns all client users (admin only)", async () => {
    mockAdminSession();

    const { GET } = await import("../app/api/admin/clients/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.clients).toBeDefined();
    expect(data.clients.length).toBeGreaterThanOrEqual(1);

    const testClient = data.clients.find((c: any) => c.id === clientId);
    expect(testClient).toBeDefined();
    expect(testClient.name).toBe("Workflow Client");
    expect(testClient.companyName).toBe("Workflow Properties LLC");
    expect(testClient._count.properties).toBeGreaterThanOrEqual(1);
  });

  it("does not include admin users in the list", async () => {
    mockAdminSession();

    const { GET } = await import("../app/api/admin/clients/route");
    const res = await GET();
    const data = await res.json();

    const adminInList = data.clients.find((c: any) => c.id === adminId);
    expect(adminInList).toBeUndefined();
  });

  it("returns 403 for non-admin user", async () => {
    mockClientSession();

    const { GET } = await import("../app/api/admin/clients/route");
    const res = await GET();
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toContain("Forbidden");
  });

  it("returns 403 when not authenticated", async () => {
    mockNoSession();

    const { GET } = await import("../app/api/admin/clients/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });
});

// ── GET /api/admin/subscriptions ──

describe("GET /api/admin/subscriptions", () => {
  it("returns all subscriptions with MRR summary", async () => {
    mockAdminSession();

    const { GET } = await import("../app/api/admin/subscriptions/route");

    const req = new NextRequest("http://localhost/api/admin/subscriptions");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.subscriptions).toBeDefined();
    expect(data.subscriptions.length).toBeGreaterThanOrEqual(1);
    expect(data.summary).toBeDefined();
    expect(data.summary.totalMrrCents).toBeGreaterThanOrEqual(0);
    expect(data.summary.total).toBeGreaterThanOrEqual(1);

    const sub = data.subscriptions.find((s: any) => s.id === subscriptionId);
    expect(sub).toBeDefined();
    expect(sub.user.name).toBe("Workflow Client");
    expect(sub.tier.basePriceCents).toBe(2000);
  });

  it("filters by status", async () => {
    mockAdminSession();

    const { GET } = await import("../app/api/admin/subscriptions/route");

    const req = new NextRequest("http://localhost/api/admin/subscriptions?status=active");
    const res = await GET(req);
    const data = await res.json();

    for (const s of data.subscriptions) {
      expect(s.status).toBe("active");
    }
  });

  it("returns 403 for non-admin user", async () => {
    mockClientSession();

    const { GET } = await import("../app/api/admin/subscriptions/route");

    const req = new NextRequest("http://localhost/api/admin/subscriptions");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/admin/subscriptions/[id] ──

describe("GET /api/admin/subscriptions/[id]", () => {
  it("returns subscription detail with usage", async () => {
    mockAdminSession();

    const { GET } = await import("../app/api/admin/subscriptions/[id]/route");

    const req = new NextRequest(`http://localhost/api/admin/subscriptions/${subscriptionId}`);
    const res = await GET(req, { params: Promise.resolve({ id: subscriptionId }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.subscription).toBeDefined();
    expect(data.subscription.id).toBe(subscriptionId);
    expect(data.subscription.user.name).toBe("Workflow Client");
    expect(data.subscription.tier).toBeDefined();
    expect(data.usage).toBeDefined();
    expect(data.usage.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 404 for non-existent subscription", async () => {
    mockAdminSession();

    const { GET } = await import("../app/api/admin/subscriptions/[id]/route");

    const req = new NextRequest("http://localhost/api/admin/subscriptions/nonexistent");
    const res = await GET(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-admin", async () => {
    mockClientSession();

    const { GET } = await import("../app/api/admin/subscriptions/[id]/route");

    const req = new NextRequest(`http://localhost/api/admin/subscriptions/${subscriptionId}`);
    const res = await GET(req, { params: Promise.resolve({ id: subscriptionId }) });
    expect(res.status).toBe(403);
  });
});

// ── PUT /api/admin/subscriptions/[id] ──

describe("PUT /api/admin/subscriptions/[id]", () => {
  it("suspends a subscription", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/subscriptions/[id]/route");

    const req = new NextRequest(`http://localhost/api/admin/subscriptions/${subscriptionId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "suspended" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: subscriptionId }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.subscription.status).toBe("suspended");
  });

  it("reactivates a subscription", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/subscriptions/[id]/route");

    const req = new NextRequest(`http://localhost/api/admin/subscriptions/${subscriptionId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "active" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: subscriptionId }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.subscription.status).toBe("active");
  });

  it("overrides pricing", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/subscriptions/[id]/route");

    const req = new NextRequest(`http://localhost/api/admin/subscriptions/${subscriptionId}`, {
      method: "PUT",
      body: JSON.stringify({
        overrideBasePriceCents: 1500,
        overrideAiMarkupPercent: 35,
        overrideMaxProperties: 10,
        adminNotes: "Custom deal for workflow test",
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: subscriptionId }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.subscription.overrideBasePriceCents).toBe(1500);
    expect(data.subscription.overrideAiMarkupPercent).toBe(35);
    expect(data.subscription.overrideMaxProperties).toBe(10);
    expect(data.subscription.adminNotes).toBe("Custom deal for workflow test");

    // Restore
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        overrideBasePriceCents: null,
        overrideAiMarkupPercent: null,
        overrideMaxProperties: null,
        adminNotes: null,
      },
    });
  });

  it("returns 404 for non-existent subscription", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/subscriptions/[id]/route");

    const req = new NextRequest("http://localhost/api/admin/subscriptions/nonexistent", {
      method: "PUT",
      body: JSON.stringify({ status: "suspended" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-admin", async () => {
    mockClientSession();

    const { PUT } = await import("../app/api/admin/subscriptions/[id]/route");

    const req = new NextRequest(`http://localhost/api/admin/subscriptions/${subscriptionId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "suspended" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: subscriptionId }) });
    expect(res.status).toBe(403);
  });
});

// ── GET /api/admin/pricing ──

describe("GET /api/admin/pricing", () => {
  it("returns all tiers with subscription counts", async () => {
    mockAdminSession();

    const { GET } = await import("../app/api/admin/pricing/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.tiers).toBeDefined();
    expect(data.tiers.length).toBeGreaterThanOrEqual(1);

    const testTier = data.tiers.find((t: any) => t.id === tierId);
    expect(testTier).toBeDefined();
    expect(testTier._count.subscriptions).toBe(1);
  });

  it("returns 403 for non-admin", async () => {
    mockClientSession();

    const { GET } = await import("../app/api/admin/pricing/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });
});

// ── POST /api/admin/pricing ──

describe("POST /api/admin/pricing", () => {
  let newTierId: string;

  it("creates a new pricing tier", async () => {
    mockAdminSession();

    const { POST } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "POST",
      body: JSON.stringify({
        name: `${TEST_PREFIX}_premium`,
        displayName: "Test Premium",
        basePriceCents: 8000,
        includedAiCents: 5000,
        aiMarkupPercent: 35,
        maxProperties: 20,
        customDomainEnabled: true,
        sortOrder: 5,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.tier.name).toBe(`${TEST_PREFIX}_premium`);
    expect(data.tier.basePriceCents).toBe(8000);
    expect(data.tier.customDomainEnabled).toBe(true);
    newTierId = data.tier.id;
  });

  it("returns 400 when required fields are missing", async () => {
    mockAdminSession();

    const { POST } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "POST",
      body: JSON.stringify({
        name: `${TEST_PREFIX}_incomplete`,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("required");
  });

  it("returns 403 for non-admin", async () => {
    mockClientSession();

    const { POST } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "POST",
      body: JSON.stringify({
        name: "should-fail",
        displayName: "Should Fail",
        basePriceCents: 1000,
        includedAiCents: 500,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    if (newTierId) {
      await prisma.pricingTier.delete({ where: { id: newTierId } }).catch(() => {});
    }
  });
});

// ── PUT /api/admin/pricing ──

describe("PUT /api/admin/pricing", () => {
  it("updates a pricing tier", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({
        id: tierId,
        displayName: "Updated Basic",
        basePriceCents: 2500,
        description: "Updated description",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.tier.displayName).toBe("Updated Basic");
    expect(data.tier.basePriceCents).toBe(2500);
    expect(data.tier.description).toBe("Updated description");
  });

  it("returns 400 when id is missing", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({ displayName: "No ID" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("id");
  });

  it("returns 403 for non-admin", async () => {
    mockClientSession();

    const { PUT } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({ id: tierId, displayName: "Hacked" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/admin/usage ──

describe("GET /api/admin/usage", () => {
  it("returns platform-wide usage for current month", async () => {
    mockAdminSession();

    const { GET } = await import("../app/api/admin/usage/route");

    const req = new NextRequest("http://localhost/api/admin/usage");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.billingMonth).toBeDefined();
    expect(data.totalAiCostCents).toBeGreaterThanOrEqual(0);
    expect(data.totalQuantity).toBeGreaterThanOrEqual(0);
    expect(data.usageByType).toBeDefined();
    expect(data.topUsers).toBeDefined();
  });

  it("accepts month parameter", async () => {
    mockAdminSession();

    const { GET } = await import("../app/api/admin/usage/route");

    const now = new Date();
    const monthParam = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const req = new NextRequest(`http://localhost/api/admin/usage?month=${monthParam}`);
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.billingMonth).toBeDefined();
  });

  it("returns top users by AI cost", async () => {
    mockAdminSession();

    const { GET } = await import("../app/api/admin/usage/route");

    const req = new NextRequest("http://localhost/api/admin/usage");
    const res = await GET(req);
    const data = await res.json();

    const testUser = data.topUsers.find((u: any) => u.userId === clientId);
    if (testUser) {
      expect(testUser.aiCostCents).toBeGreaterThan(0);
      expect(testUser.name).toBe("Workflow Client");
    }
  });

  it("returns 403 for non-admin", async () => {
    mockClientSession();

    const { GET } = await import("../app/api/admin/usage/route");

    const req = new NextRequest("http://localhost/api/admin/usage");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when not authenticated", async () => {
    mockNoSession();

    const { GET } = await import("../app/api/admin/usage/route");

    const req = new NextRequest("http://localhost/api/admin/usage");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });
});
