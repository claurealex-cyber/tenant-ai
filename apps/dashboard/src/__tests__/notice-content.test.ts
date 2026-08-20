import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSessionUser = { id: "user-nc-1", role: "client", email: "nc@test.com" };

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: mockSessionUser,
  }),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

const mockNoticeFindUnique = vi.fn();
const mockNoticeUpdate = vi.fn();
const mockNoticeCreate = vi.fn();
const mockLeaseFindUnique = vi.fn();
const mockRentChargeFindMany = vi.fn();
const mockRentChargeFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notice: {
      findUnique: (...args: any[]) => mockNoticeFindUnique(...args),
      update: (...args: any[]) => mockNoticeUpdate(...args),
      create: (...args: any[]) => mockNoticeCreate(...args),
    },
    lease: {
      findUnique: (...args: any[]) => mockLeaseFindUnique(...args),
    },
    rentCharge: {
      findMany: (...args: any[]) => mockRentChargeFindMany(...args),
      findFirst: (...args: any[]) => mockRentChargeFindFirst(...args),
    },
  },
}));

vi.mock("@/lib/notice-sms", () => ({
  sendNoticeSms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tenant-ai/shared", () => ({
  NOTICE_PERIODS: { five_day: 5, ten_day: 10, thirty_day: 30 },
  logAudit: vi.fn().mockResolvedValue(undefined),
  sendEmail: vi.fn().mockResolvedValue(undefined),
  buildNoticeGeneratedEmail: vi.fn().mockReturnValue("<html>notice</html>"),
}));

// ── Helpers ──

/** Builds a mock notice row returned by findUnique in the PUT [id] route. */
function buildMockNotice(overrides: Record<string, unknown> = {}) {
  return {
    id: "notice-1",
    leaseId: "lease-1",
    tenantId: "tenant-1",
    type: "five_day",
    reason: "non_payment",
    amountOwed: 150000,
    content: "Original content",
    serviceConfirmed: false,
    lease: {
      unit: {
        property: { userId: mockSessionUser.id },
      },
    },
    ...overrides,
  };
}

/** Builds a mock lease row returned by findUnique in the POST route. */
function buildMockLease(overrides: Record<string, unknown> = {}) {
  return {
    id: "lease-1",
    tenant: {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@test.com",
      phone: "+13125551234",
    },
    unit: {
      unitNumber: "A1",
      property: {
        userId: mockSessionUser.id,
        name: "Test Property",
        address: "100 Main St, Chicago IL 60601",
        user: {
          name: "Landlord Smith",
          companyName: null,
          email: "landlord@test.com",
        },
      },
    },
    ...overrides,
  };
}

// ── PUT /api/notices/[id] — content-only update ──

describe("PUT /api/notices/[id] — content-only update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates content without requiring service fields", async () => {
    const notice = buildMockNotice();
    mockNoticeFindUnique.mockResolvedValue(notice);
    mockNoticeUpdate.mockResolvedValue({ ...notice, content: "Updated notice body" });

    const { PUT } = await import("../app/api/notices/[id]/route");

    const req = new NextRequest("http://localhost/api/notices/notice-1", {
      method: "PUT",
      body: JSON.stringify({ content: "Updated notice body" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "notice-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.notice.content).toBe("Updated notice body");

    // Verify prisma.notice.update was called with content only
    expect(mockNoticeUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockNoticeUpdate.mock.calls[0][0];
    expect(updateArg.where.id).toBe("notice-1");
    expect(updateArg.data.content).toBe("Updated notice body");
  });

  it("does NOT include service tracking fields in content-only update", async () => {
    const notice = buildMockNotice();
    mockNoticeFindUnique.mockResolvedValue(notice);
    mockNoticeUpdate.mockResolvedValue({ ...notice, content: "Edited content" });

    const { PUT } = await import("../app/api/notices/[id]/route");

    const req = new NextRequest("http://localhost/api/notices/notice-1", {
      method: "PUT",
      body: JSON.stringify({ content: "Edited content" }),
      headers: { "Content-Type": "application/json" },
    });

    await PUT(req, { params: Promise.resolve({ id: "notice-1" }) });

    const updateArg = mockNoticeUpdate.mock.calls[0][0];
    // Only content should be in data — no service tracking fields
    expect(updateArg.data).toEqual({ content: "Edited content" });
    expect(updateArg.data.serviceMethod).toBeUndefined();
    expect(updateArg.data.serviceDate).toBeUndefined();
    expect(updateArg.data.servedBy).toBeUndefined();
    expect(updateArg.data.serviceConfirmed).toBeUndefined();
    expect(updateArg.data.effectiveDate).toBeUndefined();
    expect(updateArg.data.expirationDate).toBeUndefined();
  });

  it("uses service tracking mode when serviceMethod is present (existing behavior)", async () => {
    const notice = buildMockNotice();
    mockNoticeFindUnique.mockResolvedValue(notice);
    mockNoticeUpdate.mockResolvedValue({
      ...notice,
      serviceMethod: "personal",
      serviceConfirmed: true,
    });

    const { PUT } = await import("../app/api/notices/[id]/route");

    const req = new NextRequest("http://localhost/api/notices/notice-1", {
      method: "PUT",
      body: JSON.stringify({
        serviceMethod: "personal",
        serviceDate: "2026-02-10",
        servedBy: "Process Server",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "notice-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);

    // Verify update includes service tracking fields
    const updateArg = mockNoticeUpdate.mock.calls[0][0];
    expect(updateArg.data.serviceMethod).toBe("personal");
    expect(updateArg.data.servedBy).toBe("Process Server");
    expect(updateArg.data.serviceConfirmed).toBe(true);
    expect(updateArg.data.effectiveDate).toBeDefined();
    expect(updateArg.data.expirationDate).toBeDefined();
  });

  it("returns 400 when serviceMethod is present but invalid", async () => {
    const notice = buildMockNotice();
    mockNoticeFindUnique.mockResolvedValue(notice);

    const { PUT } = await import("../app/api/notices/[id]/route");

    const req = new NextRequest("http://localhost/api/notices/notice-1", {
      method: "PUT",
      body: JSON.stringify({
        serviceMethod: "email",
        serviceDate: "2026-02-10",
        servedBy: "Someone",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "notice-1" }) });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("serviceMethod");
  });

  it("returns 404 when notice does not belong to user", async () => {
    mockNoticeFindUnique.mockResolvedValue(
      buildMockNotice({
        lease: { unit: { property: { userId: "other-user-id" } } },
      })
    );

    const { PUT } = await import("../app/api/notices/[id]/route");

    const req = new NextRequest("http://localhost/api/notices/notice-1", {
      method: "PUT",
      body: JSON.stringify({ content: "Hacked content" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "notice-1" }) });
    expect(res.status).toBe(404);
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { PUT } = await import("../app/api/notices/[id]/route");

    const req = new NextRequest("http://localhost/api/notices/notice-1", {
      method: "PUT",
      body: JSON.stringify({ content: "test" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "notice-1" }) });
    expect(res.status).toBe(401);
  });
});

// ── POST /api/notices — custom content field ──

describe("POST /api/notices — custom content field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves custom content when provided in five_day notice", async () => {
    const lease = buildMockLease();
    mockLeaseFindUnique.mockResolvedValue(lease);
    mockRentChargeFindMany.mockResolvedValue([
      { amount: 150000, paidAmount: 0 },
    ]);
    mockRentChargeFindFirst.mockResolvedValue({
      id: "charge-1",
      leaseId: "lease-1",
      status: "unpaid",
      dueDate: new Date(2025, 11, 1),
    });

    const createdNotice = {
      id: "new-notice-1",
      leaseId: "lease-1",
      tenantId: "tenant-1",
      type: "five_day",
      reason: "non_payment",
      amountOwed: 150000,
      content: "My custom 5-day notice content",
      visibleInPortal: true,
    };
    mockNoticeCreate.mockResolvedValue(createdNotice);

    const { POST } = await import("../app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "five_day",
        leaseId: "lease-1",
        tenantId: "tenant-1",
        content: "My custom 5-day notice content",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.notice.content).toBe("My custom 5-day notice content");

    // Verify prisma.notice.create received the custom content
    expect(mockNoticeCreate).toHaveBeenCalledTimes(1);
    const createArg = mockNoticeCreate.mock.calls[0][0];
    expect(createArg.data.content).toBe("My custom 5-day notice content");
  });

  it("generates template content when no custom content provided", async () => {
    const lease = buildMockLease();
    mockLeaseFindUnique.mockResolvedValue(lease);
    mockRentChargeFindMany.mockResolvedValue([
      { amount: 150000, paidAmount: 0 },
    ]);
    mockRentChargeFindFirst.mockResolvedValue({
      id: "charge-1",
      leaseId: "lease-1",
      status: "unpaid",
      dueDate: new Date(2025, 11, 1),
    });

    mockNoticeCreate.mockImplementation(async (args: any) => ({
      id: "new-notice-2",
      ...args.data,
    }));

    const { POST } = await import("../app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "five_day",
        leaseId: "lease-1",
        tenantId: "tenant-1",
        // No content field — should generate template
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Verify prisma.notice.create was called with generated template content
    const createArg = mockNoticeCreate.mock.calls[0][0];
    expect(createArg.data.content).toBeDefined();
    expect(typeof createArg.data.content).toBe("string");
    expect(createArg.data.content.length).toBeGreaterThan(0);
    // Template should contain IL statute reference
    expect(createArg.data.content).toContain("FIVE-DAY NOTICE");
    expect(createArg.data.content).toContain("735 ILCS 5/9-209");
  });

  it("saves custom content for ten_day notice", async () => {
    const lease = buildMockLease();
    mockLeaseFindUnique.mockResolvedValue(lease);

    const createdNotice = {
      id: "new-notice-3",
      leaseId: "lease-1",
      tenantId: "tenant-1",
      type: "ten_day",
      reason: "lease_violation",
      content: "Custom 10-day notice body",
      visibleInPortal: true,
    };
    mockNoticeCreate.mockResolvedValue(createdNotice);

    const { POST } = await import("../app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "ten_day",
        leaseId: "lease-1",
        tenantId: "tenant-1",
        violationDescription: "Unauthorized pet",
        content: "Custom 10-day notice body",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);

    const createArg = mockNoticeCreate.mock.calls[0][0];
    expect(createArg.data.content).toBe("Custom 10-day notice body");
  });

  it("saves custom content for thirty_day notice", async () => {
    const lease = buildMockLease();
    mockLeaseFindUnique.mockResolvedValue(lease);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 35);

    const createdNotice = {
      id: "new-notice-4",
      leaseId: "lease-1",
      tenantId: "tenant-1",
      type: "thirty_day",
      reason: "termination",
      content: "Custom 30-day termination content",
      visibleInPortal: true,
    };
    mockNoticeCreate.mockResolvedValue(createdNotice);

    const { POST } = await import("../app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "thirty_day",
        leaseId: "lease-1",
        tenantId: "tenant-1",
        effectiveDate: futureDate.toISOString(),
        content: "Custom 30-day termination content",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);

    const createArg = mockNoticeCreate.mock.calls[0][0];
    expect(createArg.data.content).toBe("Custom 30-day termination content");
  });

  it("returns 400 when required fields are missing", async () => {
    const { POST } = await import("../app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({ type: "five_day" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("required");
  });

  it("returns 404 when lease does not belong to user", async () => {
    mockLeaseFindUnique.mockResolvedValue(
      buildMockLease({
        unit: {
          unitNumber: "A1",
          property: {
            userId: "other-user",
            name: "Other Property",
            address: "999 Other St",
            user: { name: "Other", companyName: null, email: "other@test.com" },
          },
        },
      })
    );

    const { POST } = await import("../app/api/notices/route");

    const req = new NextRequest("http://localhost/api/notices", {
      method: "POST",
      body: JSON.stringify({
        type: "five_day",
        leaseId: "lease-1",
        tenantId: "tenant-1",
        content: "Should not be saved",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});
