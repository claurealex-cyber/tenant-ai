import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_wf_msg_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

// ── Shared state ──

let userId: string;
let otherUserId: string;
let tenantId: string;
let tenant2Id: string;
let otherTenantId: string;
let propertyId: string;
let otherPropertyId: string;

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
      name: "WF Msg Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;
  mockSession.user.id = userId;
  mockSession.user.email = user.email;

  const otherUser = await prisma.user.create({
    data: {
      email: testEmail("other"),
      name: "Other Msg Landlord",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
    },
  });
  otherUserId = otherUser.id;

  // Properties (needed for context even though messages don't directly reference them)
  const property = await prisma.property.create({
    data: { name: "WF Msg Property", address: "500 Msg St", userId, isActive: true },
  });
  propertyId = property.id;

  const otherProperty = await prisma.property.create({
    data: { name: "Other Msg Property", address: "600 Msg St", userId: otherUserId, isActive: true },
  });
  otherPropertyId = otherProperty.id;

  // Tenants
  const tenant = await prisma.tenant.create({
    data: {
      email: testEmail("tenant1"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Alice",
      lastName: "Msg",
      userId,
    },
  });
  tenantId = tenant.id;

  const tenant2 = await prisma.tenant.create({
    data: {
      email: testEmail("tenant2"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Bob",
      lastName: "Msg",
      userId,
    },
  });
  tenant2Id = tenant2.id;

  const otherTenant = await prisma.tenant.create({
    data: {
      email: testEmail("othertenant"),
      passwordHash: await bcrypt.hash("password123", 12),
      firstName: "Other",
      lastName: "Tenant",
      userId: otherUserId,
    },
  });
  otherTenantId = otherTenant.id;

  // Seed messages (landlord → tenant)
  await prisma.message.createMany({
    data: [
      {
        tenantId,
        fromUserId: userId,
        subject: "Rent reminder",
        body: "Your rent is due tomorrow.",
        isRead: false,
      },
      {
        tenantId,
        fromUserId: userId,
        subject: "Maintenance update",
        body: "The plumber will visit on Monday.",
        isRead: true,
      },
      {
        tenantId: tenant2Id,
        fromUserId: userId,
        subject: "Lease renewal",
        body: "Your lease is up for renewal next month.",
        isRead: false,
      },
      // Other user's message (should NOT be visible)
      {
        tenantId: otherTenantId,
        fromUserId: otherUserId,
        subject: "Other landlord msg",
        body: "This should not be visible.",
        isRead: false,
      },
    ],
  });

  // Seed a tenant reply (tenant → landlord)
  const parentMsg = await prisma.message.findFirst({
    where: { tenantId, subject: "Rent reminder" },
  });
  if (parentMsg) {
    await prisma.message.create({
      data: {
        tenantId,
        fromTenantId: tenantId,
        replyToId: parentMsg.id,
        subject: "Re: Rent reminder",
        body: "I will pay tomorrow, thanks!",
        isRead: false,
      },
    });
  }
});

afterAll(async () => {
  // Delete by tenantId to catch ALL messages (landlord-sent + tenant replies)
  await prisma.message.deleteMany({
    where: { tenantId: { in: [tenantId, tenant2Id, otherTenantId] } },
  });
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantId, tenant2Id, otherTenantId] } },
  });
  await prisma.property.deleteMany({
    where: { id: { in: [propertyId, otherPropertyId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── GET /api/messages ──

describe("GET /api/messages", () => {
  it("returns messages for authenticated user (including tenant replies)", async () => {
    const { GET } = await import("@/app/api/messages/route");
    const req = new NextRequest("http://localhost/api/messages");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.messages).toBeDefined();
    expect(Array.isArray(data.messages)).toBe(true);
    // 3 landlord-sent + 1 tenant reply = 4
    expect(data.messages.length).toBe(4);
  });

  it("only returns the authenticated user's tenant messages (data isolation)", async () => {
    const { GET } = await import("@/app/api/messages/route");
    const req = new NextRequest("http://localhost/api/messages");
    const res = await GET(req);
    const data = await res.json();

    // All messages should belong to this landlord's tenants
    const subjects = data.messages.map((m: any) => m.subject);
    expect(subjects).not.toContain("Other landlord msg");
  });

  it("includes tenant reply with fromTenantId set", async () => {
    const { GET } = await import("@/app/api/messages/route");
    const req = new NextRequest("http://localhost/api/messages");
    const res = await GET(req);
    const data = await res.json();

    const reply = data.messages.find((m: any) => m.subject === "Re: Rent reminder");
    expect(reply).toBeDefined();
    expect(reply.fromTenantId).toBe(tenantId);
    expect(reply.fromUserId).toBeNull();
    expect(reply.fromTenant).toBeDefined();
    expect(reply.fromTenant.firstName).toBe("Alice");
  });

  it("landlord-sent messages have fromTenantId null", async () => {
    const { GET } = await import("@/app/api/messages/route");
    const req = new NextRequest("http://localhost/api/messages");
    const res = await GET(req);
    const data = await res.json();

    const landlordMsg = data.messages.find((m: any) => m.subject === "Rent reminder");
    expect(landlordMsg).toBeDefined();
    expect(landlordMsg.fromTenantId).toBeNull();
    expect(landlordMsg.fromUserId).toBe(userId);
  });

  it("includes read/unread status on each message", async () => {
    const { GET } = await import("@/app/api/messages/route");
    const req = new NextRequest("http://localhost/api/messages");
    const res = await GET(req);
    const data = await res.json();

    for (const msg of data.messages) {
      expect(typeof msg.isRead).toBe("boolean");
    }

    const readMessages = data.messages.filter((m: any) => m.isRead === true);
    const unreadMessages = data.messages.filter((m: any) => m.isRead === false);
    expect(readMessages.length).toBeGreaterThanOrEqual(1);
    expect(unreadMessages.length).toBeGreaterThanOrEqual(1);
  });

  it("includes tenant info in each message", async () => {
    const { GET } = await import("@/app/api/messages/route");
    const req = new NextRequest("http://localhost/api/messages");
    const res = await GET(req);
    const data = await res.json();

    for (const msg of data.messages) {
      expect(msg.tenant).toBeDefined();
      expect(msg.tenant.firstName).toBeDefined();
      expect(msg.tenant.lastName).toBeDefined();
    }
  });

  it("filters by tenantId", async () => {
    const { GET } = await import("@/app/api/messages/route");
    const req = new NextRequest(`http://localhost/api/messages?tenantId=${tenantId}`);
    const res = await GET(req);
    const data = await res.json();

    // 2 landlord-sent to this tenant + 1 tenant reply = 3
    expect(data.messages.length).toBe(3);
    for (const msg of data.messages) {
      expect(msg.tenantId).toBe(tenantId);
    }
  });

  it("orders messages by createdAt descending", async () => {
    const { GET } = await import("@/app/api/messages/route");
    const req = new NextRequest("http://localhost/api/messages");
    const res = await GET(req);
    const data = await res.json();

    for (let i = 1; i < data.messages.length; i++) {
      const prev = new Date(data.messages[i - 1].createdAt).getTime();
      const curr = new Date(data.messages[i].createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/messages/route");
    const req = new NextRequest("http://localhost/api/messages");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});

// ── POST /api/messages ──

describe("POST /api/messages", () => {
  it("sends a new message to a tenant", async () => {
    const { POST } = await import("@/app/api/messages/route");

    const req = new NextRequest("http://localhost/api/messages", {
      method: "POST",
      body: JSON.stringify({
        tenantId,
        subject: "Welcome to the building",
        body: "We are glad to have you as our tenant.",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.message).toBeDefined();
    expect(data.message.tenantId).toBe(tenantId);
    expect(data.message.fromUserId).toBe(userId);
    expect(data.message.subject).toBe("Welcome to the building");
    expect(data.message.body).toBe("We are glad to have you as our tenant.");
    expect(data.message.isRead).toBe(false);
  });

  it("trims subject and body whitespace", async () => {
    const { POST } = await import("@/app/api/messages/route");

    const req = new NextRequest("http://localhost/api/messages", {
      method: "POST",
      body: JSON.stringify({
        tenantId,
        subject: "   Trimmed subject   ",
        body: "   Trimmed body   ",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.message.subject).toBe("Trimmed subject");
    expect(data.message.body).toBe("Trimmed body");
  });

  it("returns 400 when required fields are missing", async () => {
    const { POST } = await import("@/app/api/messages/route");

    const req = new NextRequest("http://localhost/api/messages", {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("required");
  });

  it("returns 400 when subject is empty string", async () => {
    const { POST } = await import("@/app/api/messages/route");

    const req = new NextRequest("http://localhost/api/messages", {
      method: "POST",
      body: JSON.stringify({
        tenantId,
        subject: "   ",
        body: "Some body",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is empty string", async () => {
    const { POST } = await import("@/app/api/messages/route");

    const req = new NextRequest("http://localhost/api/messages", {
      method: "POST",
      body: JSON.stringify({
        tenantId,
        subject: "Some subject",
        body: "   ",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when tenant does not belong to user", async () => {
    const { POST } = await import("@/app/api/messages/route");

    const req = new NextRequest("http://localhost/api/messages", {
      method: "POST",
      body: JSON.stringify({
        tenantId: otherTenantId,
        subject: "Sneaky message",
        body: "Should fail.",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Tenant not found");
  });

  it("returns 404 for non-existent tenantId", async () => {
    const { POST } = await import("@/app/api/messages/route");

    const req = new NextRequest("http://localhost/api/messages", {
      method: "POST",
      body: JSON.stringify({
        tenantId: "nonexistent-tenant-id",
        subject: "Hello",
        body: "World",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("newly created message appears in GET listing", async () => {
    const { POST, GET } = await import("@/app/api/messages/route");

    // Create a message
    const postReq = new NextRequest("http://localhost/api/messages", {
      method: "POST",
      body: JSON.stringify({
        tenantId: tenant2Id,
        subject: "Unique verification message",
        body: "This should appear in listing.",
      }),
    });
    const postRes = await POST(postReq);
    expect(postRes.status).toBe(201);

    // Fetch messages
    const getReq = new NextRequest(`http://localhost/api/messages?tenantId=${tenant2Id}`);
    const getRes = await GET(getReq);
    const data = await getRes.json();

    const subjects = data.messages.map((m: any) => m.subject);
    expect(subjects).toContain("Unique verification message");
  });
});

// ── PUT /api/messages — mark as read ──

describe("PUT /api/messages", () => {
  let unreadReplyId: string;

  beforeAll(async () => {
    // Find the unread tenant reply
    const reply = await prisma.message.findFirst({
      where: { tenantId, fromTenantId: tenantId, isRead: false },
    });
    unreadReplyId = reply!.id;
  });

  it("marks a tenant reply as read", async () => {
    const { PUT } = await import("@/app/api/messages/route");

    const req = new NextRequest("http://localhost/api/messages", {
      method: "PUT",
      body: JSON.stringify({ messageId: unreadReplyId }),
    });

    const res = await PUT(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message.isRead).toBe(true);
  });

  it("returns 400 when messageId is missing", async () => {
    const { PUT } = await import("@/app/api/messages/route");

    const req = new NextRequest("http://localhost/api/messages", {
      method: "PUT",
      body: JSON.stringify({}),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 for other landlord's tenant messages", async () => {
    // Get the other landlord's message
    const otherMsg = await prisma.message.findFirst({
      where: { tenantId: otherTenantId },
    });

    const { PUT } = await import("@/app/api/messages/route");

    const req = new NextRequest("http://localhost/api/messages", {
      method: "PUT",
      body: JSON.stringify({ messageId: otherMsg!.id }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(404);
  });

  it("returns 404 for non-existent messageId", async () => {
    const { PUT } = await import("@/app/api/messages/route");

    const req = new NextRequest("http://localhost/api/messages", {
      method: "PUT",
      body: JSON.stringify({ messageId: "nonexistent-id" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(404);
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { PUT } = await import("@/app/api/messages/route");

    const req = new NextRequest("http://localhost/api/messages", {
      method: "PUT",
      body: JSON.stringify({ messageId: unreadReplyId }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(401);
  });
});
