import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { NextRequest } from "next/server";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_smsrelay_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let adminId: string;
let clientId: string;
let propertyId: string;
const testPhone = `+1708${Date.now().toString().slice(-7)}`;

// ── Mocks ──

const mockGetServerSession = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: new PrismaClient(),
}));

function mockAdminSession() {
  mockGetServerSession.mockResolvedValue({
    user: { id: adminId, role: "admin", email: testEmail("admin") },
  });
}

function mockClientSession() {
  mockGetServerSession.mockResolvedValue({
    user: { id: clientId, role: "client", email: testEmail("client") },
  });
}

function mockNoSession() {
  mockGetServerSession.mockResolvedValue(null);
}

beforeAll(async () => {
  await prisma.$connect();

  const admin = await prisma.user.create({
    data: {
      email: testEmail("admin"),
      name: "Relay Admin",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "admin",
      onboarded: true,
    },
  });
  adminId = admin.id;

  const client = await prisma.user.create({
    data: {
      email: testEmail("client"),
      name: "Relay Client",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  clientId = client.id;

  const property = await prisma.property.create({
    data: {
      name: `${TEST_PREFIX}_property`,
      address: "1 Relay Way",
      userId: clientId,
      isActive: true,
      twilioPhone: testPhone,
      smsIntakeEnabled: false,
    },
  });
  propertyId = property.id;
});

afterAll(async () => {
  await prisma.smsOptOut.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Property route ──

describe("GET /api/admin/sms-relay/property", () => {
  it("returns 403 for non-admin", async () => {
    mockClientSession();
    const { GET } = await import("../app/api/admin/sms-relay/property/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns 403 with no session", async () => {
    mockNoSession();
    const { GET } = await import("../app/api/admin/sms-relay/property/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("lists phone-bearing properties with intake state", async () => {
    mockAdminSession();
    const { GET } = await import("../app/api/admin/sms-relay/property/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    const row = data.properties.find((p: any) => p.id === propertyId);
    expect(row).toBeDefined();
    expect(row.twilioPhone).toBe(testPhone);
    expect(row.smsIntakeEnabled).toBe(false);
  });
});

describe("PATCH /api/admin/sms-relay/property", () => {
  it("returns 403 for non-admin", async () => {
    mockClientSession();
    const { PATCH } = await import("../app/api/admin/sms-relay/property/route");
    const req = new NextRequest("http://localhost/api/admin/sms-relay/property", {
      method: "PATCH",
      body: JSON.stringify({ propertyId, smsIntakeEnabled: true }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 without propertyId", async () => {
    mockAdminSession();
    const { PATCH } = await import("../app/api/admin/sms-relay/property/route");
    const req = new NextRequest("http://localhost/api/admin/sms-relay/property", {
      method: "PATCH",
      body: JSON.stringify({ smsIntakeEnabled: true }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("toggles smsIntakeEnabled and updates the auto-reply", async () => {
    mockAdminSession();
    const { PATCH } = await import("../app/api/admin/sms-relay/property/route");
    const req = new NextRequest("http://localhost/api/admin/sms-relay/property", {
      method: "PATCH",
      body: JSON.stringify({
        propertyId,
        smsIntakeEnabled: true,
        intakeAutoReply: "Fill out our application: ",
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.property.smsIntakeEnabled).toBe(true);
    expect(data.property.intakeAutoReply).toBe("Fill out our application: ");

    const db = await prisma.property.findUnique({ where: { id: propertyId } });
    expect(db?.smsIntakeEnabled).toBe(true);
  });

  it("clears the auto-reply when given an empty string", async () => {
    mockAdminSession();
    const { PATCH } = await import("../app/api/admin/sms-relay/property/route");
    const req = new NextRequest("http://localhost/api/admin/sms-relay/property", {
      method: "PATCH",
      body: JSON.stringify({ propertyId, intakeAutoReply: "" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.property.intakeAutoReply).toBeNull();
  });
});

// ── Opt-out route ──

describe("POST /api/admin/sms-relay/optout", () => {
  const optOutPhone = `+1773${Date.now().toString().slice(-7)}`;

  it("returns 403 for non-admin", async () => {
    mockClientSession();
    const { POST } = await import("../app/api/admin/sms-relay/optout/route");
    const req = new NextRequest("http://localhost/api/admin/sms-relay/optout", {
      method: "POST",
      body: JSON.stringify({ phone: optOutPhone, propertyId }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("rejects non-E.164 phones", async () => {
    mockAdminSession();
    const { POST } = await import("../app/api/admin/sms-relay/optout/route");
    const req = new NextRequest("http://localhost/api/admin/sms-relay/optout", {
      method: "POST",
      body: JSON.stringify({ phone: "708-555-1234", propertyId }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("records an opt-out and is idempotent", async () => {
    mockAdminSession();
    const { POST } = await import("../app/api/admin/sms-relay/optout/route");
    const make = () =>
      new NextRequest("http://localhost/api/admin/sms-relay/optout", {
        method: "POST",
        body: JSON.stringify({ phone: optOutPhone, propertyId }),
      });
    const res1 = await POST(make());
    expect(res1.status).toBe(200);
    const res2 = await POST(make());
    expect(res2.status).toBe(200);

    const rows = await prisma.smsOptOut.findMany({
      where: { phone: optOutPhone, propertyId },
    });
    expect(rows.length).toBe(1);
  });
});

// ── Status route ──

describe("GET /api/admin/sms-relay/status", () => {
  it("returns 403 for non-admin", async () => {
    mockClientSession();
    const { GET } = await import("../app/api/admin/sms-relay/status/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns counts and ledger totals", async () => {
    mockAdminSession();
    const { GET } = await import("../app/api/admin/sms-relay/status/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.intakeProperties).toBe("number");
    expect(data.intakeProperties).toBeGreaterThanOrEqual(1); // ours is toggled on above
    expect(typeof data.outstandingInvites).toBe("number");
    expect(typeof data.optOutCount).toBe("number");
    expect(data.optOutCount).toBeGreaterThanOrEqual(1);
    // With the relay engine deployed the ledger reports real counts
    expect(data.ledger).not.toBeNull();
    expect(typeof data.ledger.sent).toBe("number");
    expect(typeof data.ledger.pending).toBe("number");
    expect(typeof data.ledger.failed).toBe("number");
  });
});
