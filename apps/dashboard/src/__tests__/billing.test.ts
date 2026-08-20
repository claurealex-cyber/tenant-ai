import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const TEST_PREFIX = `test_billing_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  // Clean up test data in correct order (foreign key constraints)
  await prisma.subscription.deleteMany({
    where: { user: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.pricingTier.deleteMany({
    where: { name: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Pricing Tiers ──

describe("Pricing tiers", () => {
  it("seed created 3 tiers: starter, growth, scale", async () => {
    const tiers = await prisma.pricingTier.findMany({
      where: { name: { in: ["starter", "growth", "scale"] } },
      orderBy: { sortOrder: "asc" },
    });

    expect(tiers).toHaveLength(3);
    expect(tiers[0].name).toBe("starter");
    expect(tiers[1].name).toBe("growth");
    expect(tiers[2].name).toBe("scale");
  });

  it("starter tier: $20/mo, $10 AI included, 50% markup, 3 props, 3 phones", async () => {
    const tier = await prisma.pricingTier.findUnique({
      where: { name: "starter" },
    });

    expect(tier).not.toBeNull();
    expect(tier!.basePriceCents).toBe(2000);
    expect(tier!.includedAiCents).toBe(1000);
    expect(tier!.aiMarkupPercent).toBe(50);
    expect(tier!.maxProperties).toBe(3);
    expect(tier!.maxPhoneNumbers).toBe(3);
    expect(tier!.websiteEnabled).toBe(true);
    expect(tier!.customDomainEnabled).toBe(false);
  });

  it("growth tier: $50/mo, $30 AI included, 40% markup, 10 props, custom domain", async () => {
    const tier = await prisma.pricingTier.findUnique({
      where: { name: "growth" },
    });

    expect(tier!.basePriceCents).toBe(5000);
    expect(tier!.includedAiCents).toBe(3000);
    expect(tier!.aiMarkupPercent).toBe(40);
    expect(tier!.maxProperties).toBe(10);
    expect(tier!.maxPhoneNumbers).toBe(10);
    expect(tier!.customDomainEnabled).toBe(true);
  });

  it("scale tier: $100/mo, $75 AI included, 30% markup, unlimited", async () => {
    const tier = await prisma.pricingTier.findUnique({
      where: { name: "scale" },
    });

    expect(tier!.basePriceCents).toBe(10000);
    expect(tier!.includedAiCents).toBe(7500);
    expect(tier!.aiMarkupPercent).toBe(30);
    expect(tier!.maxProperties).toBeNull();
    expect(tier!.maxPhoneNumbers).toBeNull();
    expect(tier!.customDomainEnabled).toBe(true);
  });

  it("tier name is unique (duplicate fails)", async () => {
    await expect(
      prisma.pricingTier.create({
        data: {
          name: "starter",
          displayName: "Duplicate Starter",
          basePriceCents: 1000,
          includedAiCents: 500,
        },
      })
    ).rejects.toThrow();
  });

  it("deactivated tier excluded from active listing", async () => {
    // Create an inactive tier
    await prisma.pricingTier.create({
      data: {
        name: `${TEST_PREFIX}_inactive`,
        displayName: "Inactive Tier",
        basePriceCents: 999,
        includedAiCents: 100,
        isActive: false,
      },
    });

    const activeTiers = await prisma.pricingTier.findMany({
      where: { isActive: true },
    });

    const inactiveNames = activeTiers.map((t) => t.name);
    expect(inactiveNames).not.toContain(`${TEST_PREFIX}_inactive`);
  });

  it("sortOrder controls display order", async () => {
    const tiers = await prisma.pricingTier.findMany({
      where: { name: { in: ["starter", "growth", "scale"] } },
      orderBy: { sortOrder: "asc" },
    });

    expect(tiers[0].sortOrder).toBeLessThan(tiers[1].sortOrder);
    expect(tiers[1].sortOrder).toBeLessThan(tiers[2].sortOrder);
  });
});

// ── Subscriptions ──

describe("Subscriptions", () => {
  let userId: string;
  let starterId: string;
  let growthId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Password123", 12);
    const user = await prisma.user.create({
      data: {
        name: "Billing Test User",
        email: testEmail("sub_user"),
        passwordHash,
        role: "client",
        onboarded: false,
      },
    });
    userId = user.id;

    const starter = await prisma.pricingTier.findUnique({
      where: { name: "starter" },
    });
    starterId = starter!.id;

    const growth = await prisma.pricingTier.findUnique({
      where: { name: "growth" },
    });
    growthId = growth!.id;
  });

  it("creates subscription with trialing status and 14-day trial", async () => {
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const subscription = await prisma.subscription.create({
      data: {
        userId,
        tierId: starterId,
        status: "trialing",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: trialEnd,
      },
      include: { tier: true },
    });

    expect(subscription.status).toBe("trialing");
    expect(subscription.tier.name).toBe("starter");
    expect(subscription.trialEndsAt).not.toBeNull();

    // Trial ends ~14 days from now
    const trialDaysLeft = Math.round(
      (subscription.trialEndsAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    expect(trialDaysLeft).toBeGreaterThanOrEqual(13);
    expect(trialDaysLeft).toBeLessThanOrEqual(14);
  });

  it("userId is unique — duplicate subscription fails", async () => {
    await expect(
      prisma.subscription.create({
        data: {
          userId,
          tierId: growthId,
          status: "trialing",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })
    ).rejects.toThrow();
  });

  it("upgrade: change tierId from starter to growth", async () => {
    const updated = await prisma.subscription.update({
      where: { userId },
      data: { tierId: growthId },
      include: { tier: true },
    });

    expect(updated.tier.name).toBe("growth");
    expect(updated.tier.basePriceCents).toBe(5000);
  });

  it("includes tier details when querying subscription", async () => {
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
      include: {
        tier: {
          select: {
            name: true,
            displayName: true,
            basePriceCents: true,
            maxProperties: true,
          },
        },
      },
    });

    expect(subscription).not.toBeNull();
    expect(subscription!.tier.displayName).toBe("Growth");
    expect(subscription!.tier.maxProperties).toBe(10);
  });

  it("cancel: sets status to canceled with canceledAt", async () => {
    const updated = await prisma.subscription.update({
      where: { userId },
      data: {
        status: "canceled",
        canceledAt: new Date(),
      },
    });

    expect(updated.status).toBe("canceled");
    expect(updated.canceledAt).not.toBeNull();
  });

  it("admin overrides: can set per-landlord custom pricing", async () => {
    const updated = await prisma.subscription.update({
      where: { userId },
      data: {
        overrideBasePriceCents: 3500,
        overrideAiMarkupPercent: 35,
        overrideMaxProperties: 20,
        adminNotes: "Custom deal for early adopter",
      },
    });

    expect(updated.overrideBasePriceCents).toBe(3500);
    expect(updated.overrideAiMarkupPercent).toBe(35);
    expect(updated.overrideMaxProperties).toBe(20);
    expect(updated.adminNotes).toBe("Custom deal for early adopter");
  });
});
