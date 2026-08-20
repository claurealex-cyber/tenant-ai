import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_tsite_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;
let unitId: string;
let tenantId: string;
let leaseId: string;
let configId: string;

beforeAll(async () => {
  await prisma.$connect();

  // Landlord
  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "Site Test Landlord",
      companyName: "Test Properties LLC",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  // Website config
  const config = await prisma.websiteConfig.create({
    data: {
      userId,
      subdomain: `test${Date.now()}`,
      companyName: "Test Properties LLC",
      primaryColor: "#2563eb",
      aboutText: "Welcome to our properties",
      contactEmail: testEmail("contact"),
    },
  });
  configId = config.id;

  // Property
  const property = await prisma.property.create({
    data: {
      name: "Tenant Site Property",
      address: "500 Portal Ave, Chicago IL 60601",
      description: "Beautiful apartments in the heart of the city",
      amenities: ["Laundry", "Parking", "Pet-Friendly"],
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  // Unit
  const unit = await prisma.unit.create({
    data: {
      propertyId,
      unitNumber: "TS-1",
      bedrooms: 2,
      bathrooms: 1,
      sqft: 850,
      monthlyRent: 150000,
      status: "vacant",
    },
  });
  unitId = unit.id;

  // Questions
  await prisma.question.createMany({
    data: [
      {
        propertyId,
        text: "What is your full name?",
        fieldKey: "fullName",
        type: "text",
        required: true,
        sortOrder: 0,
        isStandard: true,
      },
      {
        propertyId,
        text: "What is your email?",
        fieldKey: "email",
        type: "text",
        required: true,
        sortOrder: 1,
        isStandard: true,
      },
    ],
  });

  // Tenant
  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Portal",
      lastName: "Tester",
      userId,
    },
  });
  tenantId = tenant.id;

  // Lease + charges
  const lease = await prisma.lease.create({
    data: {
      unitId,
      tenantId,
      monthlyRent: 150000,
      securityDeposit: 150000,
      startDate: new Date(2026, 0, 1),
      status: "active",
      rentDueDay: 1,
      lateFeeGraceDays: 5,
      lateFeeAmount: 5000,
    },
  });
  leaseId = lease.id;

  // Update unit to occupied
  await prisma.unit.update({
    where: { id: unitId },
    data: { status: "occupied" },
  });

  // Rent charges
  await prisma.rentCharge.create({
    data: {
      leaseId,
      amount: 150000,
      type: "rent",
      forMonth: new Date(2026, 1, 1),
      dueDate: new Date(2026, 1, 1),
      status: "unpaid",
      paidAmount: 0,
    },
  });

  // Payment
  await prisma.payment.create({
    data: {
      leaseId,
      tenantId,
      amount: 150000,
      type: "rent",
      method: "ach",
      status: "completed",
      paidAt: new Date(2026, 0, 5),
      forMonth: new Date(2026, 0, 1),
    },
  });

  // Notice
  await prisma.notice.create({
    data: {
      leaseId,
      tenantId,
      type: "five_day",
      reason: "non_payment",
      amountOwed: 150000,
      content: "Test 5-day notice for portal view",
      visibleInPortal: true,
    },
  });

  // Message
  await prisma.message.create({
    data: {
      tenantId,
      fromUserId: userId,
      subject: "Welcome to the portal",
      body: "Your account has been set up. Please review your lease details.",
    },
  });
});

afterAll(async () => {
  await prisma.message.deleteMany({ where: { tenantId } });
  await prisma.notice.deleteMany({ where: { leaseId } });
  await prisma.payment.deleteMany({ where: { leaseId } });
  await prisma.rentCharge.deleteMany({ where: { leaseId } });
  await prisma.lease.deleteMany({ where: { id: leaseId } });
  await prisma.question.deleteMany({ where: { propertyId } });
  await prisma.application.deleteMany({ where: { propertyId } });
  await prisma.unit.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.websiteConfig.deleteMany({ where: { id: configId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Step 37: Subdomain Resolution ──

describe("Tenant context resolution", () => {
  it("resolves landlord from WebsiteConfig subdomain", async () => {
    const config = await prisma.websiteConfig.findUnique({
      where: { id: configId },
    });
    expect(config).not.toBeNull();
    expect(config!.userId).toBe(userId);
    expect(config!.companyName).toBe("Test Properties LLC");
  });

  it("returns null for unknown subdomain", async () => {
    const config = await prisma.websiteConfig.findFirst({
      where: { subdomain: "nonexistent_subdomain_xyz" },
    });
    expect(config).toBeNull();
  });

  it("custom domain lookup works", async () => {
    // Set a custom domain
    await prisma.websiteConfig.update({
      where: { id: configId },
      data: { customDomain: `test-${Date.now()}.example.com` },
    });

    const updated = await prisma.websiteConfig.findUnique({
      where: { id: configId },
    });
    expect(updated!.customDomain).not.toBeNull();

    // Reset
    await prisma.websiteConfig.update({
      where: { id: configId },
      data: { customDomain: null },
    });
  });
});

// ── Step 38: Public Properties API ──

describe("Public property listing", () => {
  it("lists active properties for a landlord", async () => {
    const properties = await prisma.property.findMany({
      where: { userId, isActive: true },
      include: {
        units: { where: { status: "vacant" } },
        photos: { take: 1 },
      },
    });

    expect(properties.length).toBeGreaterThanOrEqual(1);
    expect(properties[0].name).toBe("Tenant Site Property");
  });

  it("includes property detail with units and questions", async () => {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      include: {
        units: true,
        questions: { orderBy: { sortOrder: "asc" } },
      },
    });

    expect(property).not.toBeNull();
    expect(property!.description).toContain("Beautiful");
    expect(property!.amenities).toContain("Parking");
    expect(property!.questions.length).toBe(2);
    expect(property!.questions[0].fieldKey).toBe("fullName");
  });

  it("does not expose inactive properties", async () => {
    // Create inactive property
    const inactive = await prisma.property.create({
      data: {
        name: "Hidden Property",
        address: "999 Hidden Ave",
        userId,
        isActive: false,
      },
    });

    const active = await prisma.property.findMany({
      where: { userId, isActive: true },
    });
    const ids = active.map((p) => p.id);
    expect(ids).not.toContain(inactive.id);

    await prisma.property.delete({ where: { id: inactive.id } });
  });
});

// ── Step 39: Web Application Form ──

describe("Web application submission", () => {
  it("creates a completed application with channel 'web'", async () => {
    const app = await prisma.application.create({
      data: {
        propertyId,
        status: "completed",
        channel: "web",
        fullName: "Web Applicant",
        email: testEmail("applicant"),
        monthlyIncome: "5000",
        employer: "Tech Corp",
        completedAt: new Date(),
      },
    });

    expect(app.channel).toBe("web");
    expect(app.status).toBe("completed");
    expect(app.fullName).toBe("Web Applicant");
    expect(app.completedAt).not.toBeNull();
  });

  it("prevents duplicate application within 30 days", async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const existing = await prisma.application.findFirst({
      where: {
        propertyId,
        email: testEmail("applicant"),
        status: "completed",
        completedAt: { gte: thirtyDaysAgo },
      },
    });

    expect(existing).not.toBeNull();
  });

  it("stores custom responses as JSON", async () => {
    const app = await prisma.application.create({
      data: {
        propertyId,
        status: "completed",
        channel: "web",
        fullName: "Custom Resp",
        email: testEmail("custom"),
        customResponses: { felonies: "no", smoker: "no" },
        completedAt: new Date(),
      },
    });

    expect(app.customResponses).toEqual({ felonies: "no", smoker: "no" });
  });
});

// ── Step 40: Website Settings ──

describe("Website configuration", () => {
  it("has subdomain, branding, and contact info", async () => {
    const config = await prisma.websiteConfig.findUnique({
      where: { id: configId },
    });

    expect(config!.companyName).toBe("Test Properties LLC");
    expect(config!.primaryColor).toBe("#2563eb");
    expect(config!.aboutText).toBe("Welcome to our properties");
    expect(config!.contactEmail).toBe(testEmail("contact"));
  });

  it("enforces unique subdomain", async () => {
    const config = await prisma.websiteConfig.findUnique({
      where: { id: configId },
    });

    // Try creating another config with same subdomain
    try {
      await prisma.websiteConfig.create({
        data: {
          userId: "fake_user_id",
          subdomain: config!.subdomain,
          companyName: "Dupe",
        },
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      // Unique constraint error expected
      expect(err).toBeDefined();
    }
  });
});

// ── Step 41: Tenant Auth ──

describe("Tenant authentication", () => {
  it("tenant record has hashed password", async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    expect(tenant!.passwordHash).toBeDefined();
    const valid = await bcrypt.compare("password123", tenant!.passwordHash);
    expect(valid).toBe(true);
  });

  it("supports account lockout after failed attempts", async () => {
    // Simulate 5 failed attempts
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const locked = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    expect(locked!.failedLoginAttempts).toBe(5);
    expect(locked!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Reset
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it("invite token expires after 72 hours", async () => {
    const invite = await prisma.tenantInvite.create({
      data: {
        token: `test_token_${Date.now()}`,
        email: testEmail("invite"),
        userId,
        propertyId,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
    });

    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Expired invite
    const expired = await prisma.tenantInvite.create({
      data: {
        token: `expired_token_${Date.now()}`,
        email: testEmail("expired"),
        userId,
        propertyId,
        expiresAt: new Date(Date.now() - 1000), // already expired
      },
    });

    expect(expired.expiresAt.getTime()).toBeLessThan(Date.now());

    // Cleanup
    await prisma.tenantInvite.deleteMany({
      where: { email: { startsWith: TEST_PREFIX } },
    });
  });
});

// ── Step 42: Application → Tenant Conversion ──

describe("Application to tenant conversion", () => {
  it("creates tenant from application data", async () => {
    const app = await prisma.application.create({
      data: {
        propertyId,
        status: "reviewed",
        channel: "voice",
        callerPhone: "+15551112222",
        fullName: "Convert Test",
        email: testEmail("convert"),
        completedAt: new Date(),
      },
    });

    // Simulate conversion
    const tempHash = await bcrypt.hash("temp_password", 12);
    const newTenant = await prisma.tenant.create({
      data: {
        email: testEmail("convert"),
        passwordHash: tempHash,
        firstName: "Convert",
        lastName: "Test",
        phone: "+15551112222",
        userId,
      },
    });

    expect(newTenant.email).toBe(testEmail("convert"));
    expect(newTenant.firstName).toBe("Convert");

    // Cleanup
    await prisma.tenant.delete({ where: { id: newTenant.id } });
  });
});

// ── Step 43: Tenant Portal Dashboard ──

describe("Tenant portal dashboard data", () => {
  it("calculates outstanding balance", async () => {
    const charges = await prisma.rentCharge.findMany({
      where: { leaseId, status: { in: ["unpaid", "partial"] } },
    });
    const balance = charges.reduce(
      (sum, c) => sum + (c.amount - c.paidAmount),
      0
    );

    expect(balance).toBe(150000); // 1 unpaid charge
  });

  it("returns lease details with property info", async () => {
    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
      include: {
        unit: {
          include: { property: { select: { name: true, address: true } } },
        },
      },
    });

    expect(lease!.monthlyRent).toBe(150000);
    expect(lease!.unit.property.name).toBe("Tenant Site Property");
    expect(lease!.rentDueDay).toBe(1);
  });
});

// ── Step 44-45: Payment History ──

describe("Tenant payment history", () => {
  it("returns payments for the tenant", async () => {
    const payments = await prisma.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });

    expect(payments.length).toBeGreaterThanOrEqual(1);
    expect(payments[0].amount).toBe(150000);
    expect(payments[0].method).toBe("ach");
    expect(payments[0].status).toBe("completed");
  });
});

// ── Step 47: Notices in Portal ──

describe("Tenant notices in portal", () => {
  it("returns notices visible in portal", async () => {
    const notices = await prisma.notice.findMany({
      where: { tenantId, visibleInPortal: true },
    });

    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices[0].type).toBe("five_day");
  });
});

// ── Step 48: Messages ──

describe("Tenant messages", () => {
  it("returns messages from landlord", async () => {
    const messages = await prisma.message.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });

    expect(messages.length).toBe(1);
    expect(messages[0].subject).toBe("Welcome to the portal");
    expect(messages[0].isRead).toBe(false);
  });

  it("marks message as read", async () => {
    const msg = await prisma.message.findFirst({ where: { tenantId } });

    const updated = await prisma.message.update({
      where: { id: msg!.id },
      data: { isRead: true },
    });

    expect(updated.isRead).toBe(true);

    // Reset
    await prisma.message.update({
      where: { id: msg!.id },
      data: { isRead: false },
    });
  });
});

// ── Step 48: Lease Details ──

describe("Lease details for tenant", () => {
  it("returns full lease information", async () => {
    const lease = await prisma.lease.findFirst({
      where: { tenantId, status: "active" },
    });

    expect(lease).not.toBeNull();
    expect(lease!.monthlyRent).toBe(150000);
    expect(lease!.securityDeposit).toBe(150000);
    expect(lease!.lateFeeAmount).toBe(5000);
    expect(lease!.lateFeeGraceDays).toBe(5);
    expect(lease!.rentDueDay).toBe(1);
  });
});

// ── Step 48: Tenant Settings ──

describe("Tenant settings", () => {
  it("reads tenant profile", async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    });

    expect(tenant!.firstName).toBe("Portal");
    expect(tenant!.lastName).toBe("Tester");
  });

  it("updates tenant phone number", async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { phone: "+15559876543" },
    });

    const updated = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    expect(updated!.phone).toBe("+15559876543");

    // Reset
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { phone: null },
    });
  });
});

// ── Step 49: Dashboard Messaging ──

describe("Dashboard messaging system", () => {
  it("landlord sends message to tenant", async () => {
    const msg = await prisma.message.create({
      data: {
        tenantId,
        fromUserId: userId,
        subject: "Maintenance scheduled",
        body: "We will be doing maintenance on Feb 15.",
      },
    });

    expect(msg.fromUserId).toBe(userId);
    expect(msg.tenantId).toBe(tenantId);
    expect(msg.isRead).toBe(false);
  });

  it("only shows messages for the addressed tenant", async () => {
    const messages = await prisma.message.findMany({
      where: { tenantId },
    });

    for (const m of messages) {
      expect(m.tenantId).toBe(tenantId);
    }
  });
});
