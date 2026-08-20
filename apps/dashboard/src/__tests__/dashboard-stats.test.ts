import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_stats_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let otherUserId: string;
let propertyId: string;
let otherPropertyId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "Stats Test Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: {
      email: testEmail("other"),
      name: "Other Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
    },
  });
  otherUserId = otherUser.id;

  const property = await prisma.property.create({
    data: {
      name: "Stats Test Property",
      address: "100 Stats Ave",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const otherProperty = await prisma.property.create({
    data: {
      name: "Other Stats Property",
      address: "200 Other St",
      userId: otherUserId,
    },
  });
  otherPropertyId = otherProperty.id;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Applications created today
  await prisma.application.create({
    data: {
      propertyId,
      status: "completed",
      channel: "voice",
      fullName: "Today App 1",
      completedAt: new Date(),
      createdAt: new Date(startOfToday.getTime() + 3600000), // 1h after midnight
    },
  });

  await prisma.application.create({
    data: {
      propertyId,
      status: "in_progress",
      channel: "sms",
      fullName: "Today App 2 (in progress)",
      createdAt: new Date(startOfToday.getTime() + 7200000), // 2h after midnight
    },
  });

  // Completed earlier this month (but not today)
  const earlierThisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0);
  if (earlierThisMonth < startOfToday) {
    await prisma.application.create({
      data: {
        propertyId,
        status: "completed",
        channel: "web",
        fullName: "Earlier This Month",
        completedAt: earlierThisMonth,
        createdAt: earlierThisMonth,
      },
    });
  }

  // In-progress application
  await prisma.application.create({
    data: {
      propertyId,
      status: "in_progress",
      channel: "voice",
      fullName: "Old In Progress",
      createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    },
  });

  // Other user's application (should NOT be counted)
  await prisma.application.create({
    data: {
      propertyId: otherPropertyId,
      status: "completed",
      channel: "voice",
      fullName: "Other User App",
      completedAt: new Date(),
    },
  });

  // Call logs for cost summary
  await prisma.callLog.createMany({
    data: [
      {
        propertyId,
        callerPhone: "+13125550010",
        channel: "voice",
        duration: 300,
        estimatedCostCents: 165,
        startedAt: new Date(),
      },
      {
        propertyId,
        callerPhone: "+13125550011",
        channel: "voice",
        duration: 480,
        estimatedCostCents: 264,
        startedAt: new Date(),
      },
      // Other user's call log (should NOT be counted)
      {
        propertyId: otherPropertyId,
        callerPhone: "+13125559999",
        channel: "voice",
        duration: 600,
        estimatedCostCents: 330,
        startedAt: new Date(),
      },
    ],
  });
});

afterAll(async () => {
  await prisma.callLog.deleteMany({
    where: { propertyId: { in: [propertyId, otherPropertyId] } },
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

// ── Dashboard Stats ──

describe("Dashboard stats queries", () => {
  it("counts applications created today", async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const count = await prisma.application.count({
      where: {
        property: { userId },
        createdAt: { gte: startOfToday },
      },
    });

    expect(count).toBe(2); // Today App 1 + Today App 2
  });

  it("counts in-progress applications", async () => {
    const count = await prisma.application.count({
      where: {
        property: { userId },
        status: "in_progress",
      },
    });

    expect(count).toBe(2); // Today App 2 + Old In Progress
  });

  it("counts completed this month", async () => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const count = await prisma.application.count({
      where: {
        property: { userId },
        status: { in: ["completed", "reviewed"] },
        completedAt: { gte: startOfMonth },
      },
    });

    // At least the one created today + possibly the earlier-this-month one
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("sums estimated cost this month", async () => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const summary = await prisma.callLog.aggregate({
      where: {
        property: { userId },
        startedAt: { gte: startOfMonth },
      },
      _sum: { estimatedCostCents: true },
    });

    expect(summary._sum.estimatedCostCents).toBe(165 + 264); // 429 cents
  });

  it("does NOT include other user's data in stats", async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const appCount = await prisma.application.count({
      where: {
        property: { userId },
        createdAt: { gte: startOfToday },
      },
    });

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const costSummary = await prisma.callLog.aggregate({
      where: {
        property: { userId },
        startedAt: { gte: startOfMonth },
      },
      _sum: { estimatedCostCents: true },
    });

    // Other user's app and call log should NOT be included
    expect(appCount).toBe(2); // Only user's today apps
    expect(costSummary._sum.estimatedCostCents).toBe(429); // Only user's costs
  });
});

// ── Recent Applications ──

describe("Recent applications", () => {
  it("returns last 10 applications ordered by date", async () => {
    const apps = await prisma.application.findMany({
      where: { property: { userId } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        property: { select: { id: true, name: true } },
      },
    });

    expect(apps.length).toBeGreaterThanOrEqual(3);
    expect(apps.length).toBeLessThanOrEqual(10);

    // Verify ordering (newest first)
    for (let i = 1; i < apps.length; i++) {
      expect(apps[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        apps[i].createdAt.getTime(),
      );
    }
  });

  it("includes property info in each application", async () => {
    const apps = await prisma.application.findMany({
      where: { property: { userId } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        property: { select: { id: true, name: true } },
      },
    });

    for (const app of apps) {
      expect(app.property.name).toBe("Stats Test Property");
    }
  });

  it("does NOT include other user's applications", async () => {
    const apps = await prisma.application.findMany({
      where: { property: { userId } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const names = apps.map((a) => a.fullName);
    expect(names).not.toContain("Other User App");
  });
});
