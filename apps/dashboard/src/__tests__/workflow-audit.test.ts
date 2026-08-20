import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_audit_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

// ── Shared state ──

let adminUserId: string;
let clientUserId: string;
let auditLogIds: string[] = [];

// ── Mock session ──

const mockSession = {
  user: { id: "", email: "", role: "admin" as string },
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

  const admin = await prisma.user.create({
    data: {
      email: testEmail("admin"),
      name: "Audit Admin",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "admin",
      onboarded: true,
    },
  });
  adminUserId = admin.id;

  const client = await prisma.user.create({
    data: {
      email: testEmail("client"),
      name: "Audit Client",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  clientUserId = client.id;

  // Seed some audit log entries
  const entries = await Promise.all([
    prisma.auditLog.create({
      data: {
        userId: clientUserId,
        action: "create_lease",
        resourceType: "Lease",
        resourceId: `lease-${TEST_PREFIX}-1`,
        metadata: { monthlyRent: 150000 },
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: clientUserId,
        action: "record_offline_payment",
        resourceType: "Payment",
        resourceId: `payment-${TEST_PREFIX}-1`,
        metadata: { amount: 150000, method: "cash" },
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: clientUserId,
        action: "create_notice",
        resourceType: "Notice",
        resourceId: `notice-${TEST_PREFIX}-1`,
        metadata: { type: "five_day" },
      },
    }),
  ]);
  auditLogIds = entries.map((e) => e.id);

  mockSession.user.id = adminUserId;
  mockSession.user.email = admin.email;
  mockSession.user.role = "admin";
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { id: { in: auditLogIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, clientUserId] } } });
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/audit
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/audit — admin audit log", () => {
  it("returns 403 for non-admin user", async () => {
    mockSession.user.role = "client";
    mockSession.user.id = clientUserId;

    const { GET } = await import("../app/api/admin/audit/route");
    const req = new NextRequest("http://localhost:3000/api/admin/audit");
    const res = await GET(req);

    expect(res.status).toBe(403);

    // Restore admin
    mockSession.user.role = "admin";
    mockSession.user.id = adminUserId;
  });

  it("returns 403 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { GET } = await import("../app/api/admin/audit/route");
    const req = new NextRequest("http://localhost:3000/api/admin/audit");
    const res = await GET(req);

    expect(res.status).toBe(403);
  });

  it("returns audit entries with user info", async () => {
    const { GET } = await import("../app/api/admin/audit/route");
    const req = new NextRequest("http://localhost:3000/api/admin/audit?limit=100");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.entries).toBeDefined();
    expect(data.pagination).toBeDefined();
    expect(data.pagination.total).toBeGreaterThanOrEqual(3);

    // Our seeded entries should be present
    const ourEntries = data.entries.filter((e: any) =>
      auditLogIds.includes(e.id)
    );
    expect(ourEntries.length).toBe(3);

    // Each entry should have user info
    const leaseEntry = ourEntries.find((e: any) => e.action === "create_lease");
    expect(leaseEntry.user.name).toBe("Audit Client");
    expect(leaseEntry.user.email).toBe(testEmail("client"));
    expect(leaseEntry.resourceType).toBe("Lease");
  });

  it("filters by resourceType", async () => {
    const { GET } = await import("../app/api/admin/audit/route");
    const req = new NextRequest(
      "http://localhost:3000/api/admin/audit?resourceType=Payment&limit=100"
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    const ourEntries = data.entries.filter((e: any) =>
      auditLogIds.includes(e.id)
    );
    expect(ourEntries.length).toBe(1);
    expect(ourEntries[0].action).toBe("record_offline_payment");
  });

  it("supports pagination with skip/limit", async () => {
    const { GET } = await import("../app/api/admin/audit/route");
    const req = new NextRequest(
      "http://localhost:3000/api/admin/audit?skip=0&limit=2"
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.entries.length).toBeLessThanOrEqual(2);
    expect(data.pagination.limit).toBe(2);
  });

  it("clamps limit to max 100", async () => {
    const { GET } = await import("../app/api/admin/audit/route");
    const req = new NextRequest(
      "http://localhost:3000/api/admin/audit?limit=500"
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pagination.limit).toBe(100);
  });

  it("filters by date range", async () => {
    const { GET } = await import("../app/api/admin/audit/route");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const req = new NextRequest(
      `http://localhost:3000/api/admin/audit?from=${yesterday.toISOString()}&to=${tomorrow.toISOString()}&limit=100`
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    const ourEntries = data.entries.filter((e: any) =>
      auditLogIds.includes(e.id)
    );
    expect(ourEntries.length).toBe(3);
  });
});
