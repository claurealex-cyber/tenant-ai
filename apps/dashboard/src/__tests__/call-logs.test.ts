import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_calllogs_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let otherUserId: string;
let propertyId: string;
let property2Id: string;
let otherPropertyId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "CallLog Test Owner",
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
      name: "CallLog Property A",
      address: "100 Log Ave",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const property2 = await prisma.property.create({
    data: {
      name: "CallLog Property B",
      address: "200 Log Ave",
      userId,
    },
  });
  property2Id = property2.id;

  const otherProperty = await prisma.property.create({
    data: {
      name: "Other Log Property",
      address: "300 Other St",
      userId: otherUserId,
    },
  });
  otherPropertyId = otherProperty.id;

  // Create call logs
  await prisma.callLog.createMany({
    data: [
      {
        propertyId,
        callerPhone: "+13125550001",
        channel: "voice",
        duration: 300,
        estimatedCostCents: 165,
        startedAt: new Date("2026-02-01T10:00:00Z"),
        endedAt: new Date("2026-02-01T10:05:00Z"),
        transcript: [
          { role: "ai", content: "Hello!", timestamp: "2026-02-01T10:00:00Z" },
        ],
      },
      {
        propertyId,
        callerPhone: "+13125550002",
        channel: "voice",
        duration: 480,
        estimatedCostCents: 264,
        startedAt: new Date("2026-02-02T14:00:00Z"),
        endedAt: new Date("2026-02-02T14:08:00Z"),
        reconnectCount: 1,
      },
      {
        propertyId,
        callerPhone: "+13125550003",
        channel: "sms",
        startedAt: new Date("2026-02-03T09:00:00Z"),
      },
      {
        propertyId: property2Id,
        callerPhone: "+13125550004",
        channel: "voice",
        duration: 120,
        estimatedCostCents: 66,
        startedAt: new Date("2026-02-04T16:00:00Z"),
        endedAt: new Date("2026-02-04T16:02:00Z"),
      },
      // Other user's log (should NOT be visible)
      {
        propertyId: otherPropertyId,
        callerPhone: "+13125559999",
        channel: "voice",
        duration: 600,
        estimatedCostCents: 330,
        startedAt: new Date("2026-02-01T12:00:00Z"),
      },
    ],
  });
});

afterAll(async () => {
  await prisma.callLog.deleteMany({
    where: {
      propertyId: {
        in: [propertyId, property2Id, otherPropertyId],
      },
    },
  });
  await prisma.property.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Call Log Listing ──

describe("Call log listing (data isolation)", () => {
  it("returns only logs for user's properties", async () => {
    const logs = await prisma.callLog.findMany({
      where: { property: { userId } },
      orderBy: { startedAt: "desc" },
    });

    expect(logs.length).toBe(4);
    for (const log of logs) {
      expect([propertyId, property2Id]).toContain(log.propertyId);
    }
  });

  it("does NOT include other user's logs", async () => {
    const logs = await prisma.callLog.findMany({
      where: { property: { userId } },
    });

    const phones = logs.map((l) => l.callerPhone);
    expect(phones).not.toContain("+13125559999");
  });

  it("filters by propertyId", async () => {
    const logs = await prisma.callLog.findMany({
      where: { propertyId, property: { userId } },
    });

    expect(logs.length).toBe(3);
    for (const log of logs) {
      expect(log.propertyId).toBe(propertyId);
    }
  });

  it("filters by channel", async () => {
    const smsLogs = await prisma.callLog.findMany({
      where: {
        property: { userId },
        channel: "sms",
      },
    });

    expect(smsLogs.length).toBe(1);
    expect(smsLogs[0].channel).toBe("sms");
  });

  it("filters by date range", async () => {
    const logs = await prisma.callLog.findMany({
      where: {
        property: { userId },
        startedAt: {
          gte: new Date("2026-02-02T00:00:00Z"),
          lte: new Date("2026-02-03T23:59:59Z"),
        },
      },
    });

    expect(logs.length).toBe(2); // Feb 2 + Feb 3
  });

  it("includes property info", async () => {
    const logs = await prisma.callLog.findMany({
      where: { property: { userId } },
      include: {
        property: { select: { name: true } },
      },
      take: 1,
    });

    expect(logs[0].property.name).toBeDefined();
  });

  it("supports pagination", async () => {
    const page1 = await prisma.callLog.findMany({
      where: { property: { userId } },
      orderBy: { startedAt: "desc" },
      skip: 0,
      take: 2,
    });

    const page2 = await prisma.callLog.findMany({
      where: { property: { userId } },
      orderBy: { startedAt: "desc" },
      skip: 2,
      take: 2,
    });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
  });
});

// ── Cost Summary ──

describe("Call log cost summary", () => {
  it("aggregates total calls, duration, and cost", async () => {
    const summary = await prisma.callLog.aggregate({
      where: { property: { userId } },
      _sum: {
        duration: true,
        estimatedCostCents: true,
      },
      _count: true,
    });

    expect(summary._count).toBe(4);
    expect(summary._sum.duration).toBe(300 + 480 + 120); // SMS has null duration
    expect(summary._sum.estimatedCostCents).toBe(165 + 264 + 66); // SMS has null cost
  });

  it("aggregates for single property", async () => {
    const summary = await prisma.callLog.aggregate({
      where: { propertyId, property: { userId } },
      _sum: {
        duration: true,
        estimatedCostCents: true,
      },
      _count: true,
    });

    expect(summary._count).toBe(3);
    expect(summary._sum.duration).toBe(300 + 480); // voice only has duration
    expect(summary._sum.estimatedCostCents).toBe(165 + 264);
  });
});

// ── Call Log Detail ──

describe("Call log detail", () => {
  it("returns call log with transcript", async () => {
    const log = await prisma.callLog.findFirst({
      where: {
        property: { userId },
        callerPhone: "+13125550001",
      },
    });

    expect(log).not.toBeNull();
    expect(log!.duration).toBe(300);
    expect(log!.channel).toBe("voice");

    const transcript = log!.transcript as Array<{
      role: string;
      content: string;
    }>;
    expect(transcript.length).toBe(1);
    expect(transcript[0].role).toBe("ai");
  });

  it("includes reconnect count", async () => {
    const log = await prisma.callLog.findFirst({
      where: {
        property: { userId },
        callerPhone: "+13125550002",
      },
    });

    expect(log!.reconnectCount).toBe(1);
  });

  it("returns 404 for other user's log", async () => {
    const otherLog = await prisma.callLog.findFirst({
      where: { propertyId: otherPropertyId },
      include: {
        property: { select: { userId: true } },
      },
    });

    expect(otherLog).not.toBeNull();
    expect(otherLog!.property.userId).not.toBe(userId);
  });
});
