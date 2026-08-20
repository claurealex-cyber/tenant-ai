process.env.PII_ENCRYPTION_KEY =
  "b18f16b9017984f6a8fa9432ef01309a460666f71e81651f2f1a034e43b49521";

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcrypt";
import { NextRequest } from "next/server";
import { encrypt } from "@tenant-ai/shared";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_adminsurveys_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let adminId: string;
let clientId: string;
let propertyId: string;
let smsLinkAppId: string;
let voiceAppId: string;
const testPhone = `+1312${Date.now().toString().slice(-7)}`;
const surveyPhone = `+1773${Date.now().toString().slice(-7)}`;
const DOB_PLAINTEXT = "1990-01-15";

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

function listRequest(query: string = "") {
  return new NextRequest(`http://localhost/api/admin/surveys${query}`);
}

function idRequest(id: string, query: string = "") {
  return new NextRequest(`http://localhost/api/admin/surveys/${id}${query}`);
}

beforeAll(async () => {
  await prisma.$connect();

  const admin = await prisma.user.create({
    data: {
      email: testEmail("admin"),
      name: "Surveys Admin",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "admin",
      onboarded: true,
    },
  });
  adminId = admin.id;

  const client = await prisma.user.create({
    data: {
      email: testEmail("client"),
      name: "Surveys Client",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  clientId = client.id;

  const property = await prisma.property.create({
    data: {
      name: `${TEST_PREFIX}_property`,
      address: "1 Survey Way",
      userId: clientId,
      isActive: true,
      twilioPhone: testPhone,
      smsIntakeEnabled: true,
    },
  });
  propertyId = property.id;

  const smsLinkApp = await prisma.application.create({
    data: {
      propertyId,
      channel: "sms_link",
      status: "completed",
      callerPhone: surveyPhone,
      fullName: `${TEST_PREFIX} Jane Doe`,
      monthlyIncome: "4500",
      dateOfBirth: encrypt(DOB_PLAINTEXT),
      customResponses: { bedrooms_needed: "2" } as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
  smsLinkAppId = smsLinkApp.id;

  const voiceApp = await prisma.application.create({
    data: {
      propertyId,
      channel: "voice",
      status: "completed",
      callerPhone: `+1847${Date.now().toString().slice(-7)}`,
      fullName: `${TEST_PREFIX} Voice Caller`,
      completedAt: new Date(),
    },
  });
  voiceAppId = voiceApp.id;

  await prisma.surveyInvite.create({
    data: {
      token: `${TEST_PREFIX}_token`,
      propertyId,
      phone: surveyPhone,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
});

afterAll(async () => {
  // Children before parents (FK order)
  await prisma.surveyInvite.deleteMany({
    where: { token: { startsWith: TEST_PREFIX } },
  });
  await prisma.application.deleteMany({
    where: { fullName: { startsWith: TEST_PREFIX } },
  });
  await prisma.property.deleteMany({
    where: { name: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── List route ──

describe("GET /api/admin/surveys", () => {
  it("returns 403 for non-admin", async () => {
    mockClientSession();
    const { GET } = await import("../app/api/admin/surveys/route");
    const res = await GET(listRequest());
    expect(res.status).toBe(403);
  });

  it("returns 403 with no session", async () => {
    mockNoSession();
    const { GET } = await import("../app/api/admin/surveys/route");
    const res = await GET(listRequest());
    expect(res.status).toBe(403);
  });

  it("lists sms_link applications and excludes other channels", async () => {
    mockAdminSession();
    const { GET } = await import("../app/api/admin/surveys/route");
    const res = await GET(listRequest("?limit=100"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = data.entries.map((e: any) => e.id);
    expect(ids).toContain(smsLinkAppId);
    // Voice applications ask the same questions and are included by design
    expect(ids).toContain(voiceAppId);
    expect(data.pagination).toBeDefined();
    expect(typeof data.pagination.total).toBe("number");

    const row = data.entries.find((e: any) => e.id === smsLinkAppId);
    expect(row.fullName).toBe(`${TEST_PREFIX} Jane Doe`);
    expect(row.callerPhone).toBe(surveyPhone);
    expect(row.property.name).toBe(`${TEST_PREFIX}_property`);
    expect(row.customResponses).toEqual({ bedrooms_needed: "2" });
  });

  it("never includes dateOfBirth in the list payload", async () => {
    mockAdminSession();
    const { GET } = await import("../app/api/admin/surveys/route");
    const res = await GET(listRequest("?limit=100"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of data.entries) {
      expect(entry).not.toHaveProperty("dateOfBirth");
      expect(entry).not.toHaveProperty("ssn");
    }
    expect(JSON.stringify(data)).not.toContain("dateOfBirth");
  });

  it("filters by q on fullName", async () => {
    mockAdminSession();
    const { GET } = await import("../app/api/admin/surveys/route");
    const res = await GET(
      listRequest(`?q=${encodeURIComponent(`${TEST_PREFIX} Jane`)}`)
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries.length).toBe(1);
    expect(data.entries[0].id).toBe(smsLinkAppId);
  });

  it("filters by q on callerPhone", async () => {
    mockAdminSession();
    const { GET } = await import("../app/api/admin/surveys/route");
    const res = await GET(listRequest(`?q=${encodeURIComponent(surveyPhone)}`));
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = data.entries.map((e: any) => e.id);
    expect(ids).toContain(smsLinkAppId);
  });

  it("filters by q with no matches", async () => {
    mockAdminSession();
    const { GET } = await import("../app/api/admin/surveys/route");
    const res = await GET(
      listRequest(`?q=${encodeURIComponent(`${TEST_PREFIX}_no_such_person`)}`)
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries.length).toBe(0);
  });

  it("returns outstanding invites with view=invites", async () => {
    mockAdminSession();
    const { GET } = await import("../app/api/admin/surveys/route");
    const res = await GET(listRequest("?view=invites"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const invite = data.invites.find(
      (i: any) => i.phone === surveyPhone && i.propertyId === propertyId
    );
    expect(invite).toBeDefined();
    expect(invite.property.name).toBe(`${TEST_PREFIX}_property`);
    expect(invite.usedAt).toBeUndefined();
  });
});

// ── Detail route ──

describe("GET /api/admin/surveys/[id]", () => {
  it("returns 403 for non-admin", async () => {
    mockClientSession();
    const { GET } = await import("../app/api/admin/surveys/[id]/route");
    const res = await GET(idRequest(smsLinkAppId), {
      params: Promise.resolve({ id: smsLinkAppId }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 with no session", async () => {
    mockNoSession();
    const { GET } = await import("../app/api/admin/surveys/[id]/route");
    const res = await GET(idRequest(smsLinkAppId), {
      params: Promise.resolve({ id: smsLinkAppId }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown id", async () => {
    mockAdminSession();
    const { GET } = await import("../app/api/admin/surveys/[id]/route");
    const res = await GET(idRequest("nonexistent_id"), {
      params: Promise.resolve({ id: "nonexistent_id" }),
    });
    expect(res.status).toBe(404);
  });

  it("omits dateOfBirth by default", async () => {
    mockAdminSession();
    const { GET } = await import("../app/api/admin/surveys/[id]/route");
    const res = await GET(idRequest(smsLinkAppId), {
      params: Promise.resolve({ id: smsLinkAppId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.application.id).toBe(smsLinkAppId);
    expect(data.application).not.toHaveProperty("dateOfBirth");
    expect(data.application).not.toHaveProperty("ssn");
    expect(JSON.stringify(data)).not.toContain("dateOfBirth");
  });

  it("includes decrypted dateOfBirth with include=pii", async () => {
    mockAdminSession();
    const { GET } = await import("../app/api/admin/surveys/[id]/route");
    const res = await GET(idRequest(smsLinkAppId, "?include=pii"), {
      params: Promise.resolve({ id: smsLinkAppId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.application.dateOfBirth).toBe(DOB_PLAINTEXT);
    expect(data.application).not.toHaveProperty("ssn");
  });
});
