import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

// Set PII encryption key for SSN tests
process.env.PII_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_wf_apps_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

// ── Test IDs ──
let userId: string;
let otherUserId: string;
let propertyId: string;
let otherPropertyId: string;
let appInProgressId: string;
let appCompletedId: string;
let appWithSsnId: string;
let otherUserAppId: string;

// ── Mock getServerSession ──
let mockSessionUserId: string;

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      user: { id: mockSessionUserId, role: "client", email: "test@test.com" },
    });
  }),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

// ── Setup & Teardown ──

beforeAll(async () => {
  await prisma.$connect();

  // Create two users for isolation testing
  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "Workflow App Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;
  mockSessionUserId = userId;

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
      name: "Workflow Test Property",
      address: "100 Workflow Ave, Chicago IL 60601",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const otherProperty = await prisma.property.create({
    data: {
      name: "Other User Property",
      address: "200 Other St",
      userId: otherUserId,
    },
  });
  otherPropertyId = otherProperty.id;

  // Create applications for main user
  const app1 = await prisma.application.create({
    data: {
      propertyId,
      status: "in_progress",
      channel: "voice",
      callerPhone: "+13125550001",
      fullName: "Alice Williams",
      email: "alice@test.com",
      customResponses: { pets: "no", parking: "yes" },
    },
  });
  appInProgressId = app1.id;

  const app2 = await prisma.application.create({
    data: {
      propertyId,
      status: "completed",
      channel: "sms",
      callerPhone: "+13125550002",
      fullName: "Bob Johnson",
      email: "bob@test.com",
      completedAt: new Date(),
    },
  });
  appCompletedId = app2.id;

  // Application with encrypted SSN
  const { encrypt } = await import("@tenant-ai/shared");
  const encryptedSsn = encrypt("987-65-4321");
  const app3 = await prisma.application.create({
    data: {
      propertyId,
      status: "completed",
      channel: "web",
      callerPhone: "+13125550003",
      fullName: "Carol Davis",
      ssn: encryptedSsn,
      email: "carol@test.com",
    },
  });
  appWithSsnId = app3.id;

  // Application belonging to OTHER user (for IDOR tests)
  const otherApp = await prisma.application.create({
    data: {
      propertyId: otherPropertyId,
      status: "completed",
      channel: "web",
      fullName: "Hidden Person",
      email: "hidden@test.com",
    },
  });
  otherUserAppId = otherApp.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
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

// ────────────────────────────────────────────────────────────────
// GET /api/applications
// ────────────────────────────────────────────────────────────────

describe("GET /api/applications", () => {
  it("returns applications array with expected fields", async () => {
    mockSessionUserId = userId;
    const { GET } = await import(
      "@/app/api/applications/route"
    );

    const req = new NextRequest("http://localhost/api/applications");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.applications).toBeDefined();
    expect(Array.isArray(data.applications)).toBe(true);
    expect(data.applications.length).toBeGreaterThanOrEqual(3);

    // Verify expected fields
    const app = data.applications.find(
      (a: any) => a.id === appInProgressId,
    );
    expect(app).toBeDefined();
    expect(app.fullName).toBe("Alice Williams");
    expect(app.callerPhone).toBe("+13125550001");
    expect(app.channel).toBe("voice");
    expect(app.status).toBe("in_progress");
    expect(app.property).toBeDefined();
    expect(app.property.id).toBe(propertyId);
    expect(app.property.name).toBe("Workflow Test Property");
  });

  it("supports ?status=in_progress filter", async () => {
    mockSessionUserId = userId;
    const { GET } = await import(
      "@/app/api/applications/route"
    );

    const req = new NextRequest(
      "http://localhost/api/applications?status=in_progress",
    );
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    for (const app of data.applications) {
      expect(app.status).toBe("in_progress");
    }
    expect(data.applications.length).toBeGreaterThanOrEqual(1);
  });

  it("supports pagination with page and limit", async () => {
    mockSessionUserId = userId;
    const { GET } = await import(
      "@/app/api/applications/route"
    );

    const req = new NextRequest(
      "http://localhost/api/applications?page=1&limit=2",
    );
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.applications.length).toBeLessThanOrEqual(2);
    expect(data.pagination).toBeDefined();
    expect(data.pagination.page).toBe(1);
    expect(data.pagination.limit).toBe(2);
    expect(data.pagination.total).toBeGreaterThanOrEqual(3);
    expect(data.pagination.totalPages).toBeGreaterThanOrEqual(2);
  });

  it("only returns current user's applications (data isolation)", async () => {
    mockSessionUserId = userId;
    const { GET } = await import(
      "@/app/api/applications/route"
    );

    const req = new NextRequest("http://localhost/api/applications");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    const ids = data.applications.map((a: any) => a.id);
    expect(ids).not.toContain(otherUserAppId);
    const names = data.applications.map((a: any) => a.fullName);
    expect(names).not.toContain("Hidden Person");
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { GET } = await import(
      "@/app/api/applications/route"
    );

    const req = new NextRequest("http://localhost/api/applications");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});

// ────────────────────────────────────────────────────────────────
// GET /api/applications/[id]
// ────────────────────────────────────────────────────────────────

describe("GET /api/applications/[id]", () => {
  it("returns full application detail including customResponses", async () => {
    mockSessionUserId = userId;
    const { GET } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appInProgressId}`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ id: appInProgressId }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.application).toBeDefined();
    expect(data.application.id).toBe(appInProgressId);
    expect(data.application.fullName).toBe("Alice Williams");
    expect(data.application.customResponses).toEqual({
      pets: "no",
      parking: "yes",
    });
    expect(data.application.property).toBeDefined();
    expect(data.application.property.name).toBe("Workflow Test Property");
  });

  it("masks SSN in detail response", async () => {
    mockSessionUserId = userId;
    const { GET } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appWithSsnId}`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ id: appWithSsnId }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.application.ssn).not.toBe("987-65-4321");
    expect(data.application.ssnPresent).toBe(true);
  });

  it("returns 404 for non-existent ID", async () => {
    mockSessionUserId = userId;
    const { GET } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      "http://localhost/api/applications/nonexistent-id-12345",
    );
    const res = await GET(req, {
      params: Promise.resolve({ id: "nonexistent-id-12345" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 404 for another user's application (IDOR protection)", async () => {
    mockSessionUserId = userId;
    const { GET } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${otherUserAppId}`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ id: otherUserAppId }),
    });

    expect(res.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────
// PUT /api/applications/[id]
// ────────────────────────────────────────────────────────────────

describe("PUT /api/applications/[id]", () => {
  it("updates status to 'reviewed' with reviewedAt timestamp", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appCompletedId}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "reviewed" }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: appCompletedId }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.application.status).toBe("reviewed");
    expect(data.application.reviewedAt).not.toBeNull();
  });

  it("updates status to 'rejected'", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appCompletedId}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "rejected" }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: appCompletedId }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.application.status).toBe("rejected");
  });

  it("adds reviewNotes", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appCompletedId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          reviewNotes: "Excellent candidate, income verified",
        }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: appCompletedId }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.application.reviewNotes).toBe(
      "Excellent candidate, income verified",
    );
  });

  it("returns 400 for invalid status", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appCompletedId}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "invalid_status" }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: appCompletedId }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 404 for other user's application", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${otherUserAppId}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "reviewed" }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: otherUserAppId }),
    });

    expect(res.status).toBe(404);
  });

  // ── Status transition guards ──

  it("blocks in_progress → reviewed (must go through completed first)", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appInProgressId}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "reviewed" }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: appInProgressId }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Cannot change status");
  });

  it("blocks in_progress → rejected (must complete first)", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appInProgressId}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "rejected" }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: appInProgressId }),
    });

    expect(res.status).toBe(400);
  });

  it("allows completed → reviewed (valid transition)", async () => {
    // Reset appCompletedId to completed state
    await prisma.application.update({
      where: { id: appCompletedId },
      data: { status: "completed" },
    });

    mockSessionUserId = userId;
    const { PUT } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appCompletedId}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "reviewed" }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: appCompletedId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.application.status).toBe("reviewed");
  });

  it("allows reviewed → rejected (valid transition)", async () => {
    // appCompletedId is now in "reviewed" state from the previous test
    mockSessionUserId = userId;
    const { PUT } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appCompletedId}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "rejected" }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: appCompletedId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.application.status).toBe("rejected");
  });

  it("allows rejected → reviewed (can re-review a rejection)", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appCompletedId}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "reviewed" }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: appCompletedId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.application.status).toBe("reviewed");
  });

  it("allows setting same status (no-op transition)", async () => {
    mockSessionUserId = userId;
    const { PUT } = await import(
      "@/app/api/applications/[id]/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appCompletedId}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "reviewed", reviewNotes: "Updated note for same-status" }),
      },
    );
    const res = await PUT(req, {
      params: Promise.resolve({ id: appCompletedId }),
    });

    expect(res.status).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────
// POST /api/applications/[id]/reveal-ssn
// ────────────────────────────────────────────────────────────────

describe("POST /api/applications/[id]/reveal-ssn", () => {
  it("returns decrypted SSN for application with encrypted SSN", async () => {
    mockSessionUserId = userId;
    const { POST } = await import(
      "@/app/api/applications/[id]/reveal-ssn/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appWithSsnId}/reveal-ssn`,
      { method: "POST" },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: appWithSsnId }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ssn).toBe("987-65-4321");
  });

  it("creates audit log entry on SSN reveal", async () => {
    // The previous test already triggered the audit log creation.
    // Verify it exists.
    const log = await prisma.auditLog.findFirst({
      where: {
        userId,
        action: "ssn_reveal",
        resourceType: "application",
        resourceId: appWithSsnId,
      },
    });

    expect(log).not.toBeNull();
    expect(log!.action).toBe("ssn_reveal");
    expect(log!.resourceType).toBe("application");
    expect(log!.resourceId).toBe(appWithSsnId);
    expect(log!.userId).toBe(userId);
    expect(log!.createdAt).toBeDefined();

    // Verify metadata
    const metadata = log!.metadata as Record<string, unknown>;
    expect(metadata.applicantName).toBe("Carol Davis");
  });

  it("returns 404 for application with no SSN", async () => {
    mockSessionUserId = userId;
    const { POST } = await import(
      "@/app/api/applications/[id]/reveal-ssn/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${appInProgressId}/reveal-ssn`,
      { method: "POST" },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: appInProgressId }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("No SSN");
  });

  it("returns 404 for other user's application", async () => {
    mockSessionUserId = userId;
    const { POST } = await import(
      "@/app/api/applications/[id]/reveal-ssn/route"
    );

    const req = new NextRequest(
      `http://localhost/api/applications/${otherUserAppId}/reveal-ssn`,
      { method: "POST" },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: otherUserAppId }),
    });

    expect(res.status).toBe(404);
  });
});
