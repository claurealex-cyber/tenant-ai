import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock next-auth ────────────────────────────────────────────────
const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

// ── Mock @/lib/auth ───────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  tenantAuthOptions: { providers: [] },
}));

// ── Mock @/lib/prisma ─────────────────────────────────────────────
const mockMessageFindMany = vi.fn();
const mockMessageFindUnique = vi.fn();
const mockMessageUpdate = vi.fn();
const mockMessageCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: {
      findMany: (...args: any[]) => mockMessageFindMany(...args),
      findUnique: (...args: any[]) => mockMessageFindUnique(...args),
      update: (...args: any[]) => mockMessageUpdate(...args),
      create: (...args: any[]) => mockMessageCreate(...args),
    },
  },
}));

// ── Session helper ────────────────────────────────────────────────
function tenantSession(overrides: Record<string, unknown> = {}) {
  return {
    tenant: {
      id: "tenant-msg-1",
      email: "messages@test.com",
      firstName: "Msg",
      lastName: "Tenant",
      userId: "landlord-1",
      ...overrides,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// GET /api/portal/messages
// ─────────────────────────────────────────────────────────────────
describe("GET /api/portal/messages — tenant messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/messages/route");
    const res = await GET();
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns messages with isRead and fromTenantId fields", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeMessages = [
      {
        id: "msg-1",
        subject: "Welcome",
        body: "Your account is ready.",
        isRead: false,
        fromTenantId: null,
        replyToId: null,
        createdAt: new Date(2026, 0, 10).toISOString(),
      },
      {
        id: "msg-2",
        subject: "Re: Welcome",
        body: "Thank you!",
        isRead: true,
        fromTenantId: "tenant-msg-1",
        replyToId: "msg-1",
        createdAt: new Date(2026, 0, 11).toISOString(),
      },
    ];
    mockMessageFindMany.mockResolvedValue(fakeMessages);

    const { GET } = await import("../app/api/portal/messages/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0].fromTenantId).toBeNull();
    expect(data.messages[1].fromTenantId).toBe("tenant-msg-1");
    expect(data.messages[1].replyToId).toBe("msg-1");
  });

  it("returns empty array when tenant has no messages", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockMessageFindMany.mockResolvedValue([]);

    const { GET } = await import("../app/api/portal/messages/route");
    const res = await GET();
    const data = await res.json();

    expect(data.messages).toEqual([]);
  });

  it("queries messages for the correct tenant in desc order", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession({ id: "tenant-xyz" }));
    mockMessageFindMany.mockResolvedValue([]);

    const { GET } = await import("../app/api/portal/messages/route");
    await GET();

    expect(mockMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-xyz" },
        orderBy: { createdAt: "desc" },
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/portal/messages — tenant reply
// ─────────────────────────────────────────────────────────────────
describe("POST /api/portal/messages — tenant reply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { POST } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "POST",
      body: JSON.stringify({ replyToId: "msg-1", body: "Thanks!" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { POST } = await import("../app/api/portal/messages/route");

    // Missing body
    const req1 = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "POST",
      body: JSON.stringify({ replyToId: "msg-1" }),
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(400);

    // Missing replyToId
    const req2 = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "POST",
      body: JSON.stringify({ body: "Hello" }),
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(400);
  });

  it("returns 400 when body is whitespace-only", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { POST } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "POST",
      body: JSON.stringify({ replyToId: "msg-1", body: "   " }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when parent message does not exist", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockMessageFindUnique.mockResolvedValue(null);

    const { POST } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "POST",
      body: JSON.stringify({ replyToId: "nonexistent", body: "Reply here" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 404 when parent message belongs to another tenant", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession({ id: "tenant-A" }));
    mockMessageFindUnique.mockResolvedValue({
      id: "msg-other",
      tenantId: "tenant-B",
      subject: "Not yours",
    });

    const { POST } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "POST",
      body: JSON.stringify({ replyToId: "msg-other", body: "Sneaky reply" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it("creates reply with Re: prefix and correct fields", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession({ id: "tenant-msg-1" }));
    mockMessageFindUnique.mockResolvedValue({
      id: "msg-parent",
      tenantId: "tenant-msg-1",
      subject: "Rent reminder",
    });

    const createdReply = {
      id: "msg-reply-1",
      tenantId: "tenant-msg-1",
      fromTenantId: "tenant-msg-1",
      replyToId: "msg-parent",
      subject: "Re: Rent reminder",
      body: "I will pay tomorrow.",
      isRead: false,
    };
    mockMessageCreate.mockResolvedValue(createdReply);

    const { POST } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "POST",
      body: JSON.stringify({ replyToId: "msg-parent", body: "  I will pay tomorrow.  " }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.message.subject).toBe("Re: Rent reminder");
    expect(data.message.fromTenantId).toBe("tenant-msg-1");
    expect(data.message.replyToId).toBe("msg-parent");

    // Verify create was called with trimmed body
    expect(mockMessageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-msg-1",
        fromTenantId: "tenant-msg-1",
        replyToId: "msg-parent",
        subject: "Re: Rent reminder",
        body: "I will pay tomorrow.",
      }),
    });
  });

  it("does not double-prefix Re: on already-prefixed subjects", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession({ id: "tenant-msg-1" }));
    mockMessageFindUnique.mockResolvedValue({
      id: "msg-already-re",
      tenantId: "tenant-msg-1",
      subject: "Re: Existing thread",
    });
    mockMessageCreate.mockResolvedValue({
      id: "msg-reply-2",
      subject: "Re: Existing thread",
    });

    const { POST } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "POST",
      body: JSON.stringify({ replyToId: "msg-already-re", body: "Followup" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(mockMessageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subject: "Re: Existing thread",
      }),
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// PUT /api/portal/messages — mark message as read
// ─────────────────────────────────────────────────────────────────
describe("PUT /api/portal/messages — mark message as read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { PUT } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "PUT",
      body: JSON.stringify({ messageId: "msg-1" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when messageId is missing", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { PUT } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "PUT",
      body: JSON.stringify({}),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("messageId");
  });

  it("returns 404 when message does not exist", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockMessageFindUnique.mockResolvedValue(null);

    const { PUT } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "PUT",
      body: JSON.stringify({ messageId: "nonexistent" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toContain("not found");
  });

  it("returns 404 when message belongs to another tenant", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession({ id: "tenant-msg-1" }));
    mockMessageFindUnique.mockResolvedValue({
      id: "msg-other",
      tenantId: "tenant-someone-else",
      isRead: false,
    });

    const { PUT } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "PUT",
      body: JSON.stringify({ messageId: "msg-other" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toContain("not found");
  });

  it("marks own message as read and returns updated message", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession({ id: "tenant-msg-1" }));
    mockMessageFindUnique.mockResolvedValue({
      id: "msg-mine",
      tenantId: "tenant-msg-1",
      subject: "Test",
      body: "Body",
      isRead: false,
    });

    const updatedMessage = {
      id: "msg-mine",
      tenantId: "tenant-msg-1",
      subject: "Test",
      body: "Body",
      isRead: true,
    };
    mockMessageUpdate.mockResolvedValue(updatedMessage);

    const { PUT } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "PUT",
      body: JSON.stringify({ messageId: "msg-mine" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.message.isRead).toBe(true);
    expect(data.message.id).toBe("msg-mine");
  });

  it("calls update with isRead: true", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession({ id: "tenant-msg-1" }));
    mockMessageFindUnique.mockResolvedValue({
      id: "msg-update",
      tenantId: "tenant-msg-1",
      isRead: false,
    });
    mockMessageUpdate.mockResolvedValue({
      id: "msg-update",
      isRead: true,
    });

    const { PUT } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "PUT",
      body: JSON.stringify({ messageId: "msg-update" }),
    });

    await PUT(req);

    expect(mockMessageUpdate).toHaveBeenCalledWith({
      where: { id: "msg-update" },
      data: { isRead: true },
    });
  });

  it("does not allow updating another tenant's message", async () => {
    // Tenant A is authenticated
    mockGetServerSession.mockResolvedValue(tenantSession({ id: "tenant-A" }));
    // Message belongs to Tenant B
    mockMessageFindUnique.mockResolvedValue({
      id: "msg-B",
      tenantId: "tenant-B",
      isRead: false,
    });

    const { PUT } = await import("../app/api/portal/messages/route");
    const req = new NextRequest("http://localhost:3002/api/portal/messages", {
      method: "PUT",
      body: JSON.stringify({ messageId: "msg-B" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(404);

    // Should NOT have called update
    expect(mockMessageUpdate).not.toHaveBeenCalled();
  });
});
