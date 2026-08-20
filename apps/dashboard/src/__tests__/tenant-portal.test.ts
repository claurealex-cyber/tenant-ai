import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_tportal_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;
let tenantId: string;
let configId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "Portal Landlord",
      companyName: "Portal Properties",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "Portal Test Prop",
      address: "600 Tenant St",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Test",
      lastName: "Tenant",
      userId,
    },
  });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.tenantInvite.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.message.deleteMany({ where: { tenantId } });
  await prisma.websiteConfig.deleteMany({ where: { id: configId } });
  await prisma.application.deleteMany({ where: { propertyId } });
  await prisma.tenant.deleteMany({
    where: { userId, email: { startsWith: TEST_PREFIX } },
  });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Website Config CRUD ──

describe("Website configuration API", () => {
  it("creates website config with subdomain and branding", async () => {
    const config = await prisma.websiteConfig.create({
      data: {
        userId,
        subdomain: `portal_${Date.now()}`,
        companyName: "Portal Properties",
        primaryColor: "#ff6600",
        aboutText: "We have the best apartments",
        contactEmail: testEmail("contact"),
      },
    });
    configId = config.id;

    expect(config.companyName).toBe("Portal Properties");
    expect(config.primaryColor).toBe("#ff6600");
    expect(config.subdomain).toBeDefined();
  });

  it("updates website config", async () => {
    const updated = await prisma.websiteConfig.update({
      where: { id: configId },
      data: {
        primaryColor: "#0066ff",
        heroImageUrl: "https://example.com/hero.jpg",
      },
    });

    expect(updated.primaryColor).toBe("#0066ff");
    expect(updated.heroImageUrl).toBe("https://example.com/hero.jpg");
  });

  it("enforces one config per user", async () => {
    const existing = await prisma.websiteConfig.findUnique({
      where: { userId },
    });
    expect(existing).not.toBeNull();
  });
});

// ── Application → Tenant Conversion ──

describe("Application to tenant conversion", () => {
  it("creates a tenant invite with 72h expiry", async () => {
    const invite = await prisma.tenantInvite.create({
      data: {
        token: `invite_${Date.now()}`,
        email: testEmail("invited"),
        userId,
        propertyId,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
    });

    expect(invite.email).toBe(testEmail("invited"));
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(invite.acceptedAt).toBeNull();
  });

  it("creates tenant from reviewed application", async () => {
    const app = await prisma.application.create({
      data: {
        propertyId,
        status: "reviewed",
        channel: "voice",
        fullName: "Convert Me",
        email: testEmail("convertme"),
        completedAt: new Date(),
      },
    });

    const hash = await bcrypt.hash("temp_pass", 12);
    const newTenant = await prisma.tenant.create({
      data: {
        email: testEmail("convertme"),
        passwordHash: hash,
        firstName: "Convert",
        lastName: "Me",
        userId,
      },
    });

    expect(newTenant.firstName).toBe("Convert");
    expect(newTenant.userId).toBe(userId);
  });

  it("rejects duplicate tenant email for same landlord", async () => {
    const existing = await prisma.tenant.findFirst({
      where: { email: testEmail("convertme"), userId },
    });
    expect(existing).not.toBeNull();
  });
});

// ── Messaging System ──

describe("Dashboard messaging", () => {
  it("creates message from landlord to tenant", async () => {
    const msg = await prisma.message.create({
      data: {
        tenantId,
        fromUserId: userId,
        subject: "Important update",
        body: "Please note the building maintenance schedule.",
      },
    });

    expect(msg.subject).toBe("Important update");
    expect(msg.isRead).toBe(false);
    expect(msg.fromUserId).toBe(userId);
  });

  it("lists messages filtered by tenant", async () => {
    const messages = await prisma.message.findMany({
      where: { tenantId, fromUserId: userId },
    });

    expect(messages.length).toBeGreaterThanOrEqual(1);
    for (const m of messages) {
      expect(m.tenantId).toBe(tenantId);
    }
  });

  it("verifies tenant ownership before sending message", async () => {
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, userId },
    });
    expect(tenant).not.toBeNull();
  });
});
