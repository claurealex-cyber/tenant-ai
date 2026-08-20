import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_csvexp_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

// ── Shared state ──

let userId: string;
let otherUserId: string;
let propertyId: string;
let unitId: string;
let tenantId: string;
let leaseId: string;

// ── Mock session ──

const mockSession = {
  user: { id: "", email: "", role: "client" },
};

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => {
  const { PrismaClient: RealPrisma } = require("@prisma/client");
  return { prisma: new RealPrisma() };
});

// ── Setup ──

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("landlord"),
      name: "CSV Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;
  mockSession.user.id = userId;
  mockSession.user.email = user.email;

  const other = await prisma.user.create({
    data: {
      email: testEmail("other"),
      name: "Other User",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
    },
  });
  otherUserId = other.id;

  const property = await prisma.property.create({
    data: { name: "CSV Prop", address: "100 CSV St", userId, isActive: true },
  });
  propertyId = property.id;

  const unit = await prisma.unit.create({
    data: { propertyId, unitNumber: "CSV-1", monthlyRent: 100000 },
  });
  unitId = unit.id;

  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "CSV",
      lastName: "Tenant",
      userId,
    },
  });
  tenantId = tenant.id;

  const lease = await prisma.lease.create({
    data: {
      unitId,
      tenantId,
      monthlyRent: 100000,
      startDate: new Date(2025, 6, 1),
      status: "active",
      rentDueDay: 1,
      lateFeeGraceDays: 5,
    },
  });
  leaseId = lease.id;

  // Create a payment
  await prisma.payment.create({
    data: {
      leaseId,
      tenantId,
      amount: 100000,
      type: "rent",
      method: "cash",
      status: "completed",
      paidAt: new Date(),
    },
  });

  // Create an application
  await prisma.application.create({
    data: {
      propertyId,
      fullName: "CSV Applicant",
      email: testEmail("applicant"),
      channel: "web",
      status: "completed",
      completedAt: new Date(),
    },
  });
});

afterAll(async () => {
  await prisma.application.deleteMany({ where: { propertyId } });
  await prisma.payment.deleteMany({ where: { leaseId } });
  await prisma.lease.deleteMany({ where: { id: leaseId } });
  await prisma.unit.deleteMany({ where: { id: unitId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
// Payment export
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/payments/export — payments CSV", () => {
  it("returns valid CSV with header and data rows", async () => {
    const { GET } = await import("../app/api/payments/export/route");
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/payments-.*\.csv/);

    const csv = await res.text();
    const lines = csv.split("\n");

    // Header
    expect(lines[0]).toContain('"Date"');
    expect(lines[0]).toContain('"Tenant"');
    expect(lines[0]).toContain('"Amount ($)"');

    // At least one data row with our payment
    const dataLines = lines.slice(1).filter((l) => l.includes("CSV Tenant"));
    expect(dataLines.length).toBeGreaterThanOrEqual(1);
    expect(dataLines[0]).toContain('"1000.00"');
    expect(dataLines[0]).toContain('"cash"');
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { GET } = await import("../app/api/payments/export/route");
    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("only includes landlord's own payments (data isolation)", async () => {
    mockSession.user.id = otherUserId;

    const { GET } = await import("../app/api/payments/export/route");
    const res = await GET();

    const csv = await res.text();
    expect(csv).not.toContain("CSV Tenant");

    mockSession.user.id = userId;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Application export
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/applications/export — applications CSV", () => {
  it("returns valid CSV with application data", async () => {
    const { GET } = await import("../app/api/applications/export/route");
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv");

    const csv = await res.text();
    expect(csv).toContain('"Name"');
    expect(csv).toContain("CSV Applicant");
    expect(csv).toContain('"web"');
  });
});
