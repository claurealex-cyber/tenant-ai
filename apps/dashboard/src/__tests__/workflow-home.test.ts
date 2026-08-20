/**
 * Workflow test: Dashboard Home Page
 *
 * Tests the dashboard home page API routes:
 * - GET /api/dashboard/stats
 * - GET /api/dashboard/recent-applications
 * - GET /api/properties (home page property section)
 *
 * Uses real DB operations matching the exact query logic from route handlers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_wf_home_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let otherUserId: string;
let propertyId: string;
let otherPropertyId: string;

beforeAll(async () => {
  await prisma.$connect();

  // Create main test user
  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "Home Test Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  // Create another user for isolation tests
  const otherUser = await prisma.user.create({
    data: {
      email: testEmail("other"),
      name: "Other Home User",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  otherUserId = otherUser.id;

  // Create properties
  const property = await prisma.property.create({
    data: {
      name: "Home Test Property",
      address: "100 Home Ave, Chicago IL 60601",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const otherProperty = await prisma.property.create({
    data: {
      name: "Other Home Property",
      address: "200 Other St",
      userId: otherUserId,
      isActive: true,
    },
  });
  otherPropertyId = otherProperty.id;

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  // Create applications for the main user's property
  // App created today, completed
  await prisma.application.create({
    data: {
      propertyId,
      status: "completed",
      channel: "voice",
      fullName: "Home Today App 1",
      completedAt: new Date(),
      createdAt: new Date(startOfToday.getTime() + 3600000),
    },
  });

  // App created today, in_progress
  await prisma.application.create({
    data: {
      propertyId,
      status: "in_progress",
      channel: "sms",
      fullName: "Home Today App 2",
      createdAt: new Date(startOfToday.getTime() + 7200000),
    },
  });

  // Older in_progress app
  await prisma.application.create({
    data: {
      propertyId,
      status: "in_progress",
      channel: "voice",
      fullName: "Home Old In Progress",
      createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    },
  });

  // Other user's application (should NOT appear)
  await prisma.application.create({
    data: {
      propertyId: otherPropertyId,
      status: "completed",
      channel: "web",
      fullName: "Other User Home App",
      completedAt: new Date(),
    },
  });

  // Call logs for cost summary
  await prisma.callLog.createMany({
    data: [
      {
        propertyId,
        callerPhone: "+13125550100",
        channel: "voice",
        duration: 300,
        estimatedCostCents: 150,
        startedAt: new Date(),
      },
      {
        propertyId,
        callerPhone: "+13125550101",
        channel: "voice",
        duration: 600,
        estimatedCostCents: 300,
        startedAt: new Date(),
      },
      // Other user's call log
      {
        propertyId: otherPropertyId,
        callerPhone: "+13125559999",
        channel: "voice",
        duration: 120,
        estimatedCostCents: 999,
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

describe("GET /api/dashboard/stats", () => {
  it("returns stats object with all expected fields", async () => {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const propertyFilter = { property: { userId } };

    const [applicationsToday, inProgress, completedThisMonth, costSummary] =
      await Promise.all([
        prisma.application.count({
          where: {
            ...propertyFilter,
            createdAt: { gte: startOfToday },
          } as any,
        }),
        prisma.application.count({
          where: {
            ...propertyFilter,
            status: "in_progress",
          } as any,
        }),
        prisma.application.count({
          where: {
            ...propertyFilter,
            status: { in: ["completed", "reviewed"] },
            completedAt: { gte: startOfMonth },
          } as any,
        }),
        prisma.callLog.aggregate({
          where: {
            ...propertyFilter,
            startedAt: { gte: startOfMonth },
          } as any,
          _sum: { estimatedCostCents: true },
        }),
      ]);

    const stats = {
      applicationsToday,
      inProgress,
      completedThisMonth,
      estimatedCostCents: costSummary._sum.estimatedCostCents ?? 0,
    };

    expect(stats.applicationsToday).toBe(2);
    expect(stats.inProgress).toBe(2);
    expect(stats.completedThisMonth).toBeGreaterThanOrEqual(1);
    expect(stats.estimatedCostCents).toBe(450); // 150 + 300
  });

  it("stats reflect actual data and exclude other users", async () => {
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

    // Should NOT include the 999 cents from other user's call log
    expect(costSummary._sum.estimatedCostCents).toBe(450);
  });

  it("returns zero stats for user with no data", async () => {
    // Create a fresh user with no properties
    const freshUser = await prisma.user.create({
      data: {
        email: testEmail("fresh"),
        name: "Fresh User",
        passwordHash: await bcrypt.hash("password123", 12),
        role: "client",
      },
    });

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    const count = await prisma.application.count({
      where: {
        property: { userId: freshUser.id },
        createdAt: { gte: startOfToday },
      },
    });

    expect(count).toBe(0);
  });
});

// ── Recent Applications ──

describe("GET /api/dashboard/recent-applications", () => {
  it("returns applications with expected fields", async () => {
    const applications = await prisma.application.findMany({
      where: { property: { userId } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        property: { select: { id: true, name: true } },
      },
    });

    expect(applications.length).toBeGreaterThanOrEqual(3);
    expect(applications.length).toBeLessThanOrEqual(10);

    // Verify each app has expected fields
    for (const app of applications) {
      expect(app.id).toBeDefined();
      expect(app.channel).toBeDefined();
      expect(app.status).toBeDefined();
      expect(app.property).toBeDefined();
      expect(app.property.id).toBe(propertyId);
      expect(app.property.name).toBe("Home Test Property");
    }
  });

  it("returns applications ordered newest first", async () => {
    const applications = await prisma.application.findMany({
      where: { property: { userId } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    for (let i = 1; i < applications.length; i++) {
      expect(applications[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        applications[i].createdAt.getTime()
      );
    }
  });

  it("returns empty array when user has no applications", async () => {
    // Use the fresh user created earlier (or create new one)
    const freshUser = await prisma.user.findFirst({
      where: { email: testEmail("fresh") },
    });

    const applications = await prisma.application.findMany({
      where: { property: { userId: freshUser!.id } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    expect(applications).toEqual([]);
  });

  it("does NOT include other user's applications", async () => {
    const applications = await prisma.application.findMany({
      where: { property: { userId } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const names = applications.map((a) => a.fullName);
    expect(names).not.toContain("Other User Home App");
  });
});

// ── Properties (home page section) ──

describe("GET /api/properties (home page)", () => {
  it("returns user's properties with _count.applications", async () => {
    const properties = await prisma.property.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { applications: true, units: true },
        },
      },
    });

    expect(properties.length).toBeGreaterThanOrEqual(1);

    const prop = properties.find((p) => p.id === propertyId);
    expect(prop).toBeDefined();
    expect(prop!.name).toBe("Home Test Property");
    expect(prop!._count.applications).toBeGreaterThanOrEqual(3);
    expect(typeof prop!._count.units).toBe("number");
  });

  it("returns empty array for new user with no properties", async () => {
    const freshUser = await prisma.user.findFirst({
      where: { email: testEmail("fresh") },
    });

    const properties = await prisma.property.findMany({
      where: { userId: freshUser!.id },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { applications: true, units: true },
        },
      },
    });

    expect(properties).toEqual([]);
  });

  it("does NOT include other user's properties", async () => {
    const properties = await prisma.property.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    expect(properties.every((p) => p.userId === userId)).toBe(true);
    const names = properties.map((p) => p.name);
    expect(names).not.toContain("Other Home Property");
  });
});
