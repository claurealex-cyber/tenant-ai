import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { NextRequest } from "next/server";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_wfbilling_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let otherUserId: string;
let starterId: string;
let growthId: string;

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

vi.mock("@/lib/stripe-billing", () => ({
  createStripeCustomer: vi.fn().mockResolvedValue(null),
  createStripeSubscription: vi.fn().mockResolvedValue(null),
  updateStripeSubscriptionPrice: vi.fn().mockResolvedValue(undefined),
  cancelStripeSubscription: vi.fn().mockResolvedValue(undefined),
}));

function mockSession(id: string) {
  mockGetServerSession.mockResolvedValue({
    user: { id, role: "client", email: testEmail("user") },
  });
}

function mockNoSession() {
  mockGetServerSession.mockResolvedValue(null);
}

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("billing_user"),
      name: "Billing Test User",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: {
      email: testEmail("billing_other"),
      name: "Other Billing User",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  otherUserId = otherUser.id;

  const starter = await prisma.pricingTier.findUnique({ where: { name: "starter" } });
  starterId = starter!.id;

  const growth = await prisma.pricingTier.findUnique({ where: { name: "growth" } });
  growthId = growth!.id;
});

afterAll(async () => {
  await prisma.usageRecord.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.invoice.deleteMany({
    where: { subscription: { userId: { in: [userId, otherUserId] } } },
  });
  await prisma.subscription.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET /api/billing/tiers ──

describe("GET /api/billing/tiers", () => {
  it("returns active pricing tiers in sort order", async () => {
    const { GET } = await import("../app/api/billing/tiers/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.tiers).toBeDefined();
    expect(data.tiers.length).toBeGreaterThanOrEqual(3);

    for (let i = 1; i < data.tiers.length; i++) {
      expect(data.tiers[i - 1].sortOrder).toBeLessThanOrEqual(data.tiers[i].sortOrder);
    }

    const starter = data.tiers.find((t: any) => t.name === "starter");
    expect(starter).toBeDefined();
    expect(starter.basePriceCents).toBe(2000);
    expect(starter.displayName).toBeDefined();
  });

  it("does not include inactive tiers", async () => {
    const inactiveTier = await prisma.pricingTier.create({
      data: {
        name: `${TEST_PREFIX}_inactive`,
        displayName: "Inactive Tier",
        basePriceCents: 999,
        includedAiCents: 100,
        isActive: false,
      },
    });

    const { GET } = await import("../app/api/billing/tiers/route");
    const res = await GET();
    const data = await res.json();

    const found = data.tiers.find((t: any) => t.name === `${TEST_PREFIX}_inactive`);
    expect(found).toBeUndefined();

    await prisma.pricingTier.delete({ where: { id: inactiveTier.id } });
  });
});

// ── GET /api/billing/usage ──

describe("GET /api/billing/usage", () => {
  beforeAll(async () => {
    await prisma.subscription.create({
      data: {
        userId,
        tierId: starterId,
        status: "active",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const now = new Date();
    const billingMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    await prisma.usageRecord.createMany({
      data: [
        { userId, type: "voice_call", costCents: 200, quantity: 1, durationSeconds: 300, billingMonth },
        { userId, type: "voice_call", costCents: 150, quantity: 1, durationSeconds: 240, billingMonth },
        { userId, type: "sms", costCents: 30, quantity: 3, billingMonth },
        { userId, type: "web_app", costCents: 0, quantity: 5, billingMonth },
      ],
    });
  });

  it("returns usage breakdown by type for current month", async () => {
    mockSession(userId);

    const { GET } = await import("../app/api/billing/usage/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.billingMonth).toBeDefined();
    expect(data.usageByType).toBeDefined();
    expect(data.usageByType.length).toBeGreaterThanOrEqual(1);

    expect(data.totalAiCostCents).toBe(200 + 150 + 30); // 380
    expect(data.includedAiCents).toBe(1000); // starter tier
  });

  it("returns 401 when not authenticated", async () => {
    mockNoSession();

    const { GET } = await import("../app/api/billing/usage/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// ── GET /api/billing/invoices ──

describe("GET /api/billing/invoices", () => {
  beforeAll(async () => {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (sub) {
      const billingMonth = new Date(Date.UTC(2025, 0, 1));
      await prisma.invoice.create({
        data: {
          subscriptionId: sub.id,
          billingMonth,
          basePriceCents: 2000,
          aiUsageCostCents: 500,
          aiMarkupCents: 250,
          totalCents: 2750,
          status: "paid",
          paidAt: new Date(),
        },
      });
    }
  });

  it("returns invoice history", async () => {
    mockSession(userId);

    const { GET } = await import("../app/api/billing/invoices/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.invoices).toBeDefined();
    expect(data.invoices.length).toBeGreaterThanOrEqual(1);

    const invoice = data.invoices[0];
    expect(invoice.basePriceCents).toBe(2000);
    expect(invoice.totalCents).toBe(2750);
    expect(invoice.status).toBe("paid");
  });

  it("returns empty array when user has no subscription", async () => {
    mockSession(otherUserId);

    const { GET } = await import("../app/api/billing/invoices/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.invoices).toEqual([]);
  });

  it("returns 401 when not authenticated", async () => {
    mockNoSession();

    const { GET } = await import("../app/api/billing/invoices/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// ── POST /api/billing/subscription ──

describe("POST /api/billing/subscription", () => {
  it("returns existing subscription if already subscribed (idempotent)", async () => {
    mockSession(userId);

    const { POST } = await import("../app/api/billing/subscription/route");

    const req = new NextRequest("http://localhost/api/billing/subscription", {
      method: "POST",
      body: JSON.stringify({ tierId: growthId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.subscription).toBeDefined();
    expect(data.subscription.userId).toBe(userId);
  });

  it("creates new subscription with trial for new user", async () => {
    mockSession(otherUserId);

    const { POST } = await import("../app/api/billing/subscription/route");

    const req = new NextRequest("http://localhost/api/billing/subscription", {
      method: "POST",
      body: JSON.stringify({ tierId: starterId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.subscription.status).toBe("trialing");
    expect(data.subscription.tier.name).toBe("starter");
    expect(data.subscription.trialEndsAt).not.toBeNull();
  });

  it("returns 400 when tierId is missing", async () => {
    mockSession(otherUserId);

    const { POST } = await import("../app/api/billing/subscription/route");

    const req = new NextRequest("http://localhost/api/billing/subscription", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("Tier ID");
  });

  it("returns 400 for invalid/inactive tier", async () => {
    await prisma.subscription.deleteMany({ where: { userId: otherUserId } });

    mockSession(otherUserId);

    const { POST } = await import("../app/api/billing/subscription/route");

    const req = new NextRequest("http://localhost/api/billing/subscription", {
      method: "POST",
      body: JSON.stringify({ tierId: "nonexistent-tier-id" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("Invalid");
  });

  it("returns 401 when not authenticated", async () => {
    mockNoSession();

    const { POST } = await import("../app/api/billing/subscription/route");

    const req = new NextRequest("http://localhost/api/billing/subscription", {
      method: "POST",
      body: JSON.stringify({ tierId: starterId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ── PUT /api/billing/subscription ──

describe("PUT /api/billing/subscription", () => {
  beforeAll(async () => {
    const existing = await prisma.subscription.findUnique({ where: { userId: otherUserId } });
    if (!existing) {
      await prisma.subscription.create({
        data: {
          userId: otherUserId,
          tierId: starterId,
          status: "active",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }
  });

  it("upgrades subscription from starter to growth", async () => {
    mockSession(userId);

    const { PUT } = await import("../app/api/billing/subscription/route");

    const req = new NextRequest("http://localhost/api/billing/subscription", {
      method: "PUT",
      body: JSON.stringify({ tierId: growthId }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.subscription.tier.name).toBe("growth");
    expect(data.subscription.tier.basePriceCents).toBe(5000);
  });

  it("returns 400 when tierId is missing", async () => {
    mockSession(userId);

    const { PUT } = await import("../app/api/billing/subscription/route");

    const req = new NextRequest("http://localhost/api/billing/subscription", {
      method: "PUT",
      body: JSON.stringify({}),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid tier", async () => {
    mockSession(userId);

    const { PUT } = await import("../app/api/billing/subscription/route");

    const req = new NextRequest("http://localhost/api/billing/subscription", {
      method: "PUT",
      body: JSON.stringify({ tierId: "nonexistent" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockNoSession();

    const { PUT } = await import("../app/api/billing/subscription/route");

    const req = new NextRequest("http://localhost/api/billing/subscription", {
      method: "PUT",
      body: JSON.stringify({ tierId: growthId }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/billing/subscription ──

describe("DELETE /api/billing/subscription", () => {
  it("cancels subscription", async () => {
    mockSession(otherUserId);

    const { DELETE } = await import("../app/api/billing/subscription/route");
    const res = await DELETE();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.subscription.status).toBe("canceled");
    expect(data.subscription.canceledAt).not.toBeNull();
  });

  it("returns 401 when not authenticated", async () => {
    mockNoSession();

    const { DELETE } = await import("../app/api/billing/subscription/route");
    const res = await DELETE();
    expect(res.status).toBe(401);
  });
});
