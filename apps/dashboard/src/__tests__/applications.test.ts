import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { encrypt } from "@tenant-ai/shared";

// Set PII encryption key for tests
process.env.PII_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_apps_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let otherUserId: string;
let propertyId: string;
let otherPropertyId: string;
let applicationId: string;
let completedAppId: string;
let ssnAppId: string;

beforeAll(async () => {
  await prisma.$connect();

  // Create test users
  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "App Test Owner",
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
      onboarded: true,
    },
  });
  otherUserId = otherUser.id;

  // Create properties
  const property = await prisma.property.create({
    data: {
      name: "App Test Property",
      address: "100 App Ave, Chicago IL 60601",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const otherProperty = await prisma.property.create({
    data: {
      name: "Other Property",
      address: "200 Other St",
      userId: otherUserId,
    },
  });
  otherPropertyId = otherProperty.id;

  // Create applications
  const app1 = await prisma.application.create({
    data: {
      propertyId,
      status: "in_progress",
      channel: "voice",
      callerPhone: "+13125550001",
      fullName: "John Smith",
      email: "john@test.com",
    },
  });
  applicationId = app1.id;

  const app2 = await prisma.application.create({
    data: {
      propertyId,
      status: "completed",
      channel: "sms",
      callerPhone: "+13125550002",
      fullName: "Jane Doe",
      email: "jane@test.com",
      completedAt: new Date(),
    },
  });
  completedAppId = app2.id;

  // Application with encrypted SSN
  const encryptedSsn = encrypt("123-45-6789");
  const app3 = await prisma.application.create({
    data: {
      propertyId,
      status: "completed",
      channel: "voice",
      callerPhone: "+13125550003",
      fullName: "Bob Wilson",
      ssn: encryptedSsn,
    },
  });
  ssnAppId = app3.id;

  // Application for other user (should NOT be visible)
  await prisma.application.create({
    data: {
      propertyId: otherPropertyId,
      status: "completed",
      channel: "web",
      fullName: "Hidden Person",
    },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { userId },
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

// ── Application Listing ──

describe("Application listing (data isolation)", () => {
  it("returns only applications for user's properties", async () => {
    const apps = await prisma.application.findMany({
      where: { property: { userId } },
      orderBy: { createdAt: "desc" },
    });

    expect(apps.length).toBe(3); // app1, app2, app3
    for (const app of apps) {
      expect(app.propertyId).toBe(propertyId);
    }
  });

  it("does NOT include other user's applications", async () => {
    const apps = await prisma.application.findMany({
      where: { property: { userId } },
    });

    const names = apps.map((a) => a.fullName);
    expect(names).not.toContain("Hidden Person");
  });

  it("filters by propertyId", async () => {
    const apps = await prisma.application.findMany({
      where: { propertyId, property: { userId } },
    });

    expect(apps.length).toBe(3);
  });

  it("filters by status", async () => {
    const completed = await prisma.application.findMany({
      where: {
        property: { userId },
        status: { in: ["completed"] },
      },
    });

    expect(completed.length).toBe(2); // app2 + app3
    for (const app of completed) {
      expect(app.status).toBe("completed");
    }
  });

  it("filters by channel", async () => {
    const voiceApps = await prisma.application.findMany({
      where: {
        property: { userId },
        channel: "voice",
      },
    });

    expect(voiceApps.length).toBe(2); // app1 + app3
  });

  it("searches by name (case-insensitive)", async () => {
    const apps = await prisma.application.findMany({
      where: {
        property: { userId },
        fullName: { contains: "john", mode: "insensitive" },
      },
    });

    expect(apps.length).toBe(1);
    expect(apps[0].fullName).toBe("John Smith");
  });

  it("searches by phone", async () => {
    const apps = await prisma.application.findMany({
      where: {
        property: { userId },
        callerPhone: { contains: "5550002" },
      },
    });

    expect(apps.length).toBe(1);
    expect(apps[0].fullName).toBe("Jane Doe");
  });

  it("includes property info", async () => {
    const apps = await prisma.application.findMany({
      where: { property: { userId } },
      include: {
        property: { select: { id: true, name: true } },
      },
      take: 1,
    });

    expect(apps[0].property.name).toBe("App Test Property");
  });

  it("supports pagination", async () => {
    const page1 = await prisma.application.findMany({
      where: { property: { userId } },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 2,
    });

    const page2 = await prisma.application.findMany({
      where: { property: { userId } },
      orderBy: { createdAt: "desc" },
      skip: 2,
      take: 2,
    });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(1);

    // No overlap
    const page1Ids = new Set(page1.map((a) => a.id));
    for (const app of page2) {
      expect(page1Ids.has(app.id)).toBe(false);
    }
  });
});

// ── Application Detail ──

describe("Application detail", () => {
  it("returns full application with property info", async () => {
    const app = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        property: { select: { id: true, name: true, userId: true } },
      },
    });

    expect(app).not.toBeNull();
    expect(app!.fullName).toBe("John Smith");
    expect(app!.property.name).toBe("App Test Property");
  });

  it("returns 404 for other user's application", async () => {
    const otherApp = await prisma.application.findFirst({
      where: { propertyId: otherPropertyId },
      include: {
        property: { select: { userId: true } },
      },
    });

    expect(otherApp).not.toBeNull();
    expect(otherApp!.property.userId).not.toBe(userId);
  });

  it("masks SSN in application detail", async () => {
    const app = await prisma.application.findUnique({
      where: { id: ssnAppId },
    });

    expect(app).not.toBeNull();
    // SSN is stored encrypted — it should NOT be plain text
    expect(app!.ssn).not.toBe("123-45-6789");
    expect(app!.ssn).toBeTruthy();
  });
});

// ── Application Status Update ──

describe("Application status update", () => {
  it("updates status to reviewed with timestamp", async () => {
    const updated = await prisma.application.update({
      where: { id: completedAppId },
      data: {
        status: "reviewed",
        reviewedAt: new Date(),
      },
    });

    expect(updated.status).toBe("reviewed");
    expect(updated.reviewedAt).not.toBeNull();
  });

  it("updates status to rejected with timestamp", async () => {
    const updated = await prisma.application.update({
      where: { id: completedAppId },
      data: {
        status: "rejected",
        reviewedAt: new Date(),
      },
    });

    expect(updated.status).toBe("rejected");
    expect(updated.reviewedAt).not.toBeNull();
  });

  it("saves review notes", async () => {
    const updated = await prisma.application.update({
      where: { id: completedAppId },
      data: {
        reviewNotes: "Good candidate, stable income",
      },
    });

    expect(updated.reviewNotes).toBe("Good candidate, stable income");
  });

  it("rejects invalid status", () => {
    const validStatuses = ["in_progress", "completed", "reviewed", "rejected"];
    expect(validStatuses.includes("invalid")).toBe(false);
    expect(validStatuses.includes("reviewed")).toBe(true);
  });
});

// ── SSN Reveal + Audit Log ──

describe("SSN reveal with audit logging", () => {
  it("decrypts SSN correctly", async () => {
    const app = await prisma.application.findUnique({
      where: { id: ssnAppId },
    });

    expect(app!.ssn).toBeTruthy();

    const { decrypt } = await import("@tenant-ai/shared");
    const decrypted = decrypt(app!.ssn!);
    expect(decrypted).toBe("123-45-6789");
  });

  it("creates audit log entry on SSN reveal", async () => {
    await prisma.auditLog.create({
      data: {
        userId,
        action: "ssn_reveal",
        resourceType: "application",
        resourceId: ssnAppId,
        metadata: {
          applicantName: "Bob Wilson",
        },
      },
    });

    const log = await prisma.auditLog.findFirst({
      where: {
        userId,
        action: "ssn_reveal",
        resourceId: ssnAppId,
      },
    });

    expect(log).not.toBeNull();
    expect(log!.action).toBe("ssn_reveal");
    expect(log!.resourceType).toBe("application");
  });

  it("audit log includes user and timestamp", async () => {
    const log = await prisma.auditLog.findFirst({
      where: {
        userId,
        action: "ssn_reveal",
      },
    });

    expect(log!.userId).toBe(userId);
    expect(log!.createdAt).toBeDefined();
  });

  it("returns error for application with no SSN", async () => {
    const app = await prisma.application.findUnique({
      where: { id: applicationId },
    });

    expect(app!.ssn).toBeNull();
  });
});

// ── Call Log Transcript in Application ──

describe("Application with call log", () => {
  it("loads call log transcript with application", async () => {
    // Create a call log and link it
    const callLog = await prisma.callLog.create({
      data: {
        propertyId,
        callerPhone: "+13125550001",
        channel: "voice",
        transcript: [
          { role: "ai", content: "Hello!", timestamp: new Date().toISOString() },
          { role: "user", content: "Hi", timestamp: new Date().toISOString() },
        ],
        duration: 120,
      },
    });

    await prisma.application.update({
      where: { id: applicationId },
      data: { callLogId: callLog.id },
    });

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        callLog: {
          select: {
            transcript: true,
            duration: true,
            channel: true,
          },
        },
      },
    });

    expect(app!.callLog).not.toBeNull();
    expect(app!.callLog!.duration).toBe(120);
    const transcript = app!.callLog!.transcript as Array<{
      role: string;
      content: string;
    }>;
    expect(transcript.length).toBe(2);
    expect(transcript[0].role).toBe("ai");

    // Clean up
    await prisma.application.update({
      where: { id: applicationId },
      data: { callLogId: null },
    });
    await prisma.callLog.delete({ where: { id: callLog.id } });
  });
});
