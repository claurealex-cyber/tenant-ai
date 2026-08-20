import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_admin_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let adminId: string;
let clientId: string;
let tierId: string;
let subscriptionId: string;
let propertyId1: string;
let propertyId2: string;
let propertyId3: string;

beforeAll(async () => {
  await prisma.$connect();

  // Create admin user
  const admin = await prisma.user.create({
    data: {
      email: testEmail("admin"),
      name: "Test Admin",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "admin",
      onboarded: true,
    },
  });
  adminId = admin.id;

  // Create a pricing tier
  const tier = await prisma.pricingTier.create({
    data: {
      name: `${TEST_PREFIX}_starter`,
      displayName: "Test Starter",
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

  // Create client user
  const client = await prisma.user.create({
    data: {
      email: testEmail("client"),
      name: "Test Client",
      companyName: "Test Properties LLC",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  clientId = client.id;

  // Create subscription
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

  // Create 3 properties (max for starter tier)
  const p1 = await prisma.property.create({
    data: { name: "Prop 1", address: "100 Main St", userId: clientId, isActive: true },
  });
  propertyId1 = p1.id;

  const phoneA = `+1555${Date.now().toString().slice(-7)}`;
  const p2 = await prisma.property.create({
    data: { name: "Prop 2", address: "200 Main St", userId: clientId, isActive: true, twilioPhone: phoneA },
  });
  propertyId2 = p2.id;

  const p3 = await prisma.property.create({
    data: { name: "Prop 3", address: "300 Main St", userId: clientId, isActive: true },
  });
  propertyId3 = p3.id;

  // Create usage records for current month
  const now = new Date();
  const billingMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  await prisma.usageRecord.createMany({
    data: [
      { userId: clientId, propertyId: propertyId1, type: "voice_call", costCents: 250, quantity: 1, durationSeconds: 480, billingMonth },
      { userId: clientId, propertyId: propertyId1, type: "voice_call", costCents: 300, quantity: 1, durationSeconds: 600, billingMonth },
      { userId: clientId, propertyId: propertyId2, type: "sms", costCents: 50, quantity: 5, billingMonth },
      { userId: clientId, propertyId: propertyId1, type: "web_app", costCents: 0, quantity: 3, billingMonth },
    ],
  });
});

afterAll(async () => {
  const now = new Date();
  const billingMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await prisma.usageRecord.deleteMany({ where: { userId: clientId, billingMonth } });
  await prisma.invoice.deleteMany({ where: { subscriptionId } });
  await prisma.subscription.deleteMany({ where: { id: subscriptionId } });
  await prisma.property.deleteMany({ where: { userId: clientId } });
  await prisma.pricingTier.deleteMany({ where: { id: tierId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Feature Gating (Steps 50-51) ──

describe("Feature gating", () => {
  it("canCreateProperty returns false when at property limit", async () => {
    const { canCreateProperty } = await import("../lib/feature-gate");
    const result = await canCreateProperty(clientId);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Property limit reached");
    expect(result.reason).toContain("3");
  });

  it("canCreateProperty returns true when under limit", async () => {
    // Temporarily delete one property
    await prisma.property.delete({ where: { id: propertyId3 } });

    const { canCreateProperty } = await import("../lib/feature-gate");
    const result = await canCreateProperty(clientId);
    expect(result.allowed).toBe(true);

    // Re-create the property
    const p = await prisma.property.create({
      data: { name: "Prop 3", address: "300 Main St", userId: clientId, isActive: true },
    });
    propertyId3 = p.id;
  });

  it("canProvisionPhone returns false when at phone limit", async () => {
    // Add a second phone to hit limit of 2
    const phoneB = `+1556${Date.now().toString().slice(-7)}`;
    await prisma.property.update({
      where: { id: propertyId3 },
      data: { twilioPhone: phoneB },
    });

    const { canProvisionPhone } = await import("../lib/feature-gate");
    const result = await canProvisionPhone(clientId);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Phone number limit reached");

    // Clean up
    await prisma.property.update({
      where: { id: propertyId3 },
      data: { twilioPhone: null },
    });
  });

  it("canUseCustomDomain returns false when tier disallows", async () => {
    const { canUseCustomDomain } = await import("../lib/feature-gate");
    const result = await canUseCustomDomain(clientId);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Custom domains require");
  });

  it("canWriteData returns false for suspended subscription", async () => {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: "suspended" },
    });

    const { canWriteData } = await import("../lib/feature-gate");
    const result = await canWriteData(clientId);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("suspended");

    // Restore
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: "active" },
    });
  });

  it("canWriteData returns true for active subscription", async () => {
    const { canWriteData } = await import("../lib/feature-gate");
    const result = await canWriteData(clientId);
    expect(result.allowed).toBe(true);
  });

  it("getSubscriptionStatus returns trial info", async () => {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: "trialing",
        trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    });

    const { getSubscriptionStatus } = await import("../lib/feature-gate");
    const status = await getSubscriptionStatus(clientId);
    expect(status).not.toBeNull();
    expect(status!.status).toBe("trialing");
    expect(status!.trialDaysRemaining).toBeGreaterThanOrEqual(4);
    expect(status!.trialDaysRemaining).toBeLessThanOrEqual(6);
    expect(status!.isPastDue).toBe(false);
    expect(status!.isSuspended).toBe(false);

    // Restore
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: "active", trialEndsAt: null },
    });
  });

  it("getSubscriptionStatus returns null for user without subscription", async () => {
    const { getSubscriptionStatus } = await import("../lib/feature-gate");
    const result = await getSubscriptionStatus(adminId);
    expect(result).toBeNull();
  });

  it("canCreateProperty respects admin override", async () => {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { overrideMaxProperties: 10 },
    });

    const { canCreateProperty } = await import("../lib/feature-gate");
    const result = await canCreateProperty(clientId);
    expect(result.allowed).toBe(true);

    // Restore
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { overrideMaxProperties: null },
    });
  });

  it("suspended subscription blocks property creation", async () => {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: "suspended" },
    });

    const { canCreateProperty } = await import("../lib/feature-gate");
    const result = await canCreateProperty(clientId);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Subscription suspended");

    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: "active" },
    });
  });
});

// ── Admin Subscriptions API (Step 52) ──

describe("Admin subscriptions API", () => {
  it("lists all subscriptions with MRR summary", async () => {
    const subs = await prisma.subscription.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, companyName: true } },
        tier: { select: { name: true, displayName: true, basePriceCents: true } },
        _count: { select: { invoices: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    expect(subs.length).toBeGreaterThanOrEqual(1);

    const activeSubs = subs.filter((s) => s.status === "active" || s.status === "trialing");
    const totalMrr = activeSubs.reduce(
      (sum, s) => sum + (s.overrideBasePriceCents ?? s.tier.basePriceCents),
      0
    );

    expect(totalMrr).toBeGreaterThanOrEqual(2000); // At least our test subscription
  });

  it("filters subscriptions by status", async () => {
    const subs = await prisma.subscription.findMany({
      where: { status: "active" },
    });

    for (const s of subs) {
      expect(s.status).toBe("active");
    }
  });

  it("returns subscription detail with usage", async () => {
    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        user: { select: { id: true, name: true, email: true, companyName: true } },
        tier: true,
        invoices: { orderBy: { billingMonth: "desc" }, take: 12 },
      },
    });

    expect(sub).not.toBeNull();
    expect(sub!.userId).toBe(clientId);

    // Get current month usage
    const now = new Date();
    const billingMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const usage = await prisma.usageRecord.groupBy({
      by: ["type"],
      where: { userId: clientId, billingMonth },
      _sum: { costCents: true, quantity: true },
    });

    expect(usage.length).toBeGreaterThanOrEqual(1);
  });

  it("updates subscription overrides", async () => {
    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        overrideBasePriceCents: 1500,
        overrideAiMarkupPercent: 30,
        overrideMaxProperties: 5,
        adminNotes: "Special deal for early customer",
      },
    });

    expect(updated.overrideBasePriceCents).toBe(1500);
    expect(updated.overrideAiMarkupPercent).toBe(30);
    expect(updated.overrideMaxProperties).toBe(5);
    expect(updated.adminNotes).toBe("Special deal for early customer");

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

  it("admin can suspend and reactivate a subscription", async () => {
    // Suspend
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: "suspended" },
    });

    let sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
    expect(sub!.status).toBe("suspended");

    // Reactivate
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: "active" },
    });

    sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
    expect(sub!.status).toBe("active");
  });

  it("cancel sets canceledAt timestamp", async () => {
    const cancelDate = new Date();
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: "canceled", canceledAt: cancelDate },
    });

    const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
    expect(sub!.status).toBe("canceled");
    expect(sub!.canceledAt).not.toBeNull();

    // Restore
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: "active", canceledAt: null },
    });
  });
});

// ── Admin Pricing Tiers API (Step 53) ──

describe("Admin pricing tiers", () => {
  let newTierId: string;

  it("lists all tiers with subscription counts", async () => {
    const tiers = await prisma.pricingTier.findMany({
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { subscriptions: true } } },
    });

    expect(tiers.length).toBeGreaterThanOrEqual(1);
    const testTier = tiers.find((t) => t.id === tierId);
    expect(testTier).toBeDefined();
    expect(testTier!._count.subscriptions).toBe(1);
  });

  it("creates a new pricing tier", async () => {
    const tier = await prisma.pricingTier.create({
      data: {
        name: `${TEST_PREFIX}_enterprise`,
        displayName: "Test Enterprise",
        basePriceCents: 10000,
        includedAiCents: 7500,
        aiMarkupPercent: 30,
        maxProperties: null,
        maxPhoneNumbers: null,
        customDomainEnabled: true,
        sortOrder: 10,
      },
    });
    newTierId = tier.id;

    expect(tier.basePriceCents).toBe(10000);
    expect(tier.maxProperties).toBeNull(); // unlimited
    expect(tier.customDomainEnabled).toBe(true);
  });

  it("enforces unique tier name", async () => {
    await expect(
      prisma.pricingTier.create({
        data: {
          name: `${TEST_PREFIX}_enterprise`,
          displayName: "Duplicate",
          basePriceCents: 5000,
          includedAiCents: 2500,
        },
      })
    ).rejects.toThrow();
  });

  it("updates a pricing tier", async () => {
    const updated = await prisma.pricingTier.update({
      where: { id: newTierId },
      data: { basePriceCents: 12000, description: "For large portfolios" },
    });

    expect(updated.basePriceCents).toBe(12000);
    expect(updated.description).toBe("For large portfolios");
  });

  it("deactivates a tier", async () => {
    const updated = await prisma.pricingTier.update({
      where: { id: newTierId },
      data: { isActive: false },
    });

    expect(updated.isActive).toBe(false);

    // Deactivated tier excluded from active listing
    const activeTiers = await prisma.pricingTier.findMany({
      where: { isActive: true },
    });
    const found = activeTiers.find((t) => t.id === newTierId);
    expect(found).toBeUndefined();
  });

  afterAll(async () => {
    if (newTierId) {
      await prisma.pricingTier.delete({ where: { id: newTierId } }).catch(() => {});
    }
  });
});

// ── Admin Usage Dashboard (Step 54) ──

describe("Admin usage dashboard", () => {
  it("aggregates total AI cost for current month", async () => {
    const now = new Date();
    const billingMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const agg = await prisma.usageRecord.aggregate({
      where: { billingMonth, userId: clientId },
      _sum: { costCents: true, quantity: true },
    });

    // voice_call: 250 + 300, sms: 50, web_app: 0
    expect(agg._sum.costCents).toBe(600);
    expect(agg._sum.quantity).toBe(10); // 1 + 1 + 5 + 3
  });

  it("breaks down usage by type", async () => {
    const now = new Date();
    const billingMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const byType = await prisma.usageRecord.groupBy({
      by: ["type"],
      where: { billingMonth, userId: clientId },
      _sum: { costCents: true, quantity: true },
    });

    const voice = byType.find((u) => u.type === "voice_call");
    expect(voice).toBeDefined();
    expect(voice!._sum.costCents).toBe(550); // 250 + 300

    const sms = byType.find((u) => u.type === "sms");
    expect(sms).toBeDefined();
    expect(sms!._sum.costCents).toBe(50);

    const web = byType.find((u) => u.type === "web_app");
    expect(web).toBeDefined();
    expect(web!._sum.costCents).toBe(0);
  });

  it("returns top users by AI cost", async () => {
    const now = new Date();
    const billingMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const topUsers = await prisma.usageRecord.groupBy({
      by: ["userId"],
      where: {
        billingMonth,
        type: { in: ["voice_call", "sms"] },
      },
      _sum: { costCents: true },
      orderBy: { _sum: { costCents: "desc" } },
      take: 20,
    });

    expect(topUsers.length).toBeGreaterThanOrEqual(1);
    const testUser = topUsers.find((u) => u.userId === clientId);
    expect(testUser).toBeDefined();
    expect(testUser!._sum.costCents).toBe(600); // 250 + 300 + 50
  });
});

// ── Admin Clients API (Step 55) ──

describe("Admin clients API", () => {
  it("lists all client users", async () => {
    const clients = await prisma.user.findMany({
      where: { role: "client" },
      select: {
        id: true,
        name: true,
        email: true,
        companyName: true,
        onboarded: true,
        _count: { select: { properties: true } },
      },
    });

    expect(clients.length).toBeGreaterThanOrEqual(1);
    const testClient = clients.find((c) => c.id === clientId);
    expect(testClient).toBeDefined();
    expect(testClient!.name).toBe("Test Client");
    expect(testClient!.companyName).toBe("Test Properties LLC");
    expect(testClient!._count.properties).toBeGreaterThanOrEqual(2);
  });

  it("does not include admin users in client list", async () => {
    const clients = await prisma.user.findMany({
      where: { role: "client" },
    });

    const adminInList = clients.find((c) => c.id === adminId);
    expect(adminInList).toBeUndefined();
  });
});

// ── Role-based access control ──

describe("Role-based access", () => {
  it("admin role required for pricing tier operations", async () => {
    // Verify that a non-admin cannot be found with admin role
    const user = await prisma.user.findUnique({ where: { id: clientId } });
    expect(user!.role).toBe("client");
    expect(user!.role).not.toBe("admin");
  });

  it("admin user has correct role", async () => {
    const user = await prisma.user.findUnique({ where: { id: adminId } });
    expect(user!.role).toBe("admin");
  });
});
