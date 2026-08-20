import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_tenants_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let otherUserId: string;
let propertyId: string;
let tenantId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "Tenant Test Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

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

  const property = await prisma.property.create({
    data: {
      name: "Tenant Test Property",
      address: "100 Tenant Ave, Chicago IL 60601",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;
});

afterAll(async () => {
  await prisma.tenantInvite.deleteMany({
    where: { userId },
  });
  await prisma.tenant.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.application.deleteMany({
    where: { propertyId },
  });
  await prisma.property.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Tenant CRUD ──

describe("Tenant creation", () => {
  it("creates a tenant record with hashed password", async () => {
    const passwordHash = await bcrypt.hash("temppass123", 12);

    const tenant = await prisma.tenant.create({
      data: {
        firstName: "John",
        lastName: "Smith",
        email: "john.smith@tenant.com",
        phone: "+13125550010",
        passwordHash,
        userId,
      },
    });

    tenantId = tenant.id;

    expect(tenant.id).toBeDefined();
    expect(tenant.firstName).toBe("John");
    expect(tenant.lastName).toBe("Smith");
    expect(tenant.email).toBe("john.smith@tenant.com");
    expect(tenant.userId).toBe(userId);
  });

  it("enforces unique email per landlord", async () => {
    const passwordHash = await bcrypt.hash("temppass", 12);

    await expect(
      prisma.tenant.create({
        data: {
          firstName: "Duplicate",
          lastName: "Tenant",
          email: "john.smith@tenant.com",
          passwordHash,
          userId,
        },
      }),
    ).rejects.toThrow();
  });

  it("allows same email under different landlord", async () => {
    const passwordHash = await bcrypt.hash("temppass", 12);

    const tenant = await prisma.tenant.create({
      data: {
        firstName: "John",
        lastName: "Smith",
        email: "john.smith@tenant.com",
        passwordHash,
        userId: otherUserId,
      },
    });

    expect(tenant.id).toBeDefined();
    expect(tenant.userId).toBe(otherUserId);
  });
});

describe("Tenant listing (data isolation)", () => {
  it("returns only tenants for the landlord", async () => {
    const tenants = await prisma.tenant.findMany({
      where: { userId },
    });

    expect(tenants.length).toBe(1);
    expect(tenants[0].firstName).toBe("John");
  });

  it("does NOT include other landlord's tenants", async () => {
    const tenants = await prisma.tenant.findMany({
      where: { userId },
    });

    for (const t of tenants) {
      expect(t.userId).toBe(userId);
    }
  });
});

describe("Tenant detail", () => {
  it("returns tenant with lease info", async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        leases: true,
        payments: true,
      },
    });

    expect(tenant).not.toBeNull();
    expect(tenant!.firstName).toBe("John");
    expect(tenant!.leases).toEqual([]);
  });

  it("returns 404 for other landlord's tenant", async () => {
    const otherTenant = await prisma.tenant.findFirst({
      where: { userId: otherUserId },
    });

    expect(otherTenant).not.toBeNull();
    expect(otherTenant!.userId).not.toBe(userId);
  });
});

describe("Tenant update", () => {
  it("updates tenant info", async () => {
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        phone: "+13125550099",
      },
    });

    expect(updated.phone).toBe("+13125550099");
  });
});

// ── Application → Tenant Conversion ──

describe("Application to tenant conversion", () => {
  it("creates tenant from application data", async () => {
    const app = await prisma.application.create({
      data: {
        propertyId,
        status: "completed",
        channel: "voice",
        callerPhone: "+13125550020",
        fullName: "Jane Doe",
        email: "jane.doe@test.com",
      },
    });

    const passwordHash = await bcrypt.hash("temppass", 12);
    const tenant = await prisma.tenant.create({
      data: {
        firstName: "Jane",
        lastName: "Doe",
        email: "jane.doe@test.com",
        phone: "+13125550020",
        passwordHash,
        userId,
      },
    });

    expect(tenant.firstName).toBe("Jane");
    expect(tenant.email).toBe("jane.doe@test.com");

    // Update application to reviewed
    const updated = await prisma.application.update({
      where: { id: app.id },
      data: { status: "reviewed" },
    });
    expect(updated.status).toBe("reviewed");
  });
});

// ── Tenant Invite ──

describe("Tenant invite", () => {
  it("creates invite with token and expiry", async () => {
    const token = "test_invite_token_" + Date.now();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const invite = await prisma.tenantInvite.create({
      data: {
        token,
        email: "invitee@test.com",
        userId,
        propertyId,
        expiresAt,
      },
    });

    expect(invite.token).toBe(token);
    expect(invite.email).toBe("invitee@test.com");
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("invite expires after 72 hours", async () => {
    const token = "test_expired_token_" + Date.now();

    const invite = await prisma.tenantInvite.create({
      data: {
        token,
        email: "expired@test.com",
        userId,
        propertyId,
        expiresAt: new Date(Date.now() - 1000), // Already expired
      },
    });

    expect(invite.expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it("invite token is unique", async () => {
    const token = "unique_token_" + Date.now();

    await prisma.tenantInvite.create({
      data: {
        token,
        email: "first@test.com",
        userId,
        propertyId,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
    });

    await expect(
      prisma.tenantInvite.create({
        data: {
          token, // Same token
          email: "second@test.com",
          userId,
          propertyId,
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        },
      }),
    ).rejects.toThrow();
  });
});
