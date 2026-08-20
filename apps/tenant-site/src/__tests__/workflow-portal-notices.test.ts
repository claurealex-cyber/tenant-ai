import { describe, it, expect, vi, beforeEach } from "vitest";

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
const mockNoticeFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notice: {
      findMany: (...args: any[]) => mockNoticeFindMany(...args),
    },
  },
}));

// ── Session helper ────────────────────────────────────────────────
function tenantSession(overrides: Record<string, unknown> = {}) {
  return {
    tenant: {
      id: "tenant-notice-1",
      email: "notices@test.com",
      firstName: "Notice",
      lastName: "Tenant",
      userId: "landlord-1",
      ...overrides,
    },
  };
}

describe("GET /api/portal/notices — tenant notices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/notices/route");
    const res = await GET();
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns notices visible in portal", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeNotices = [
      {
        id: "notice-1",
        type: "five_day",
        reason: "non_payment",
        amountOwed: 150000,
        serviceMethod: "personal",
        serviceDate: new Date(2026, 0, 10).toISOString(),
        effectiveDate: new Date(2026, 0, 15).toISOString(),
        expirationDate: new Date(2026, 0, 20).toISOString(),
        pdfUrl: "https://storage.example.com/notices/notice-1.pdf",
        createdAt: new Date(2026, 0, 10).toISOString(),
      },
    ];
    mockNoticeFindMany.mockResolvedValue(fakeNotices);

    const { GET } = await import("../app/api/portal/notices/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.notices).toHaveLength(1);
    expect(data.notices[0].type).toBe("five_day");
    expect(data.notices[0].reason).toBe("non_payment");
    expect(data.notices[0].amountOwed).toBe(150000);
    expect(data.notices[0].effectiveDate).toBeDefined();
    expect(data.notices[0].expirationDate).toBeDefined();
    expect(data.notices[0].pdfUrl).toBe("/api/portal/notices/notice-1/pdf");
  });

  it("returns computed pdfUrl even when DB pdfUrl is null", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeNotices = [
      {
        id: "notice-2",
        type: "ten_day",
        reason: "lease_violation",
        amountOwed: null,
        serviceMethod: null,
        serviceDate: null,
        effectiveDate: new Date(2026, 1, 1).toISOString(),
        expirationDate: new Date(2026, 1, 11).toISOString(),
        pdfUrl: null,
        createdAt: new Date(2026, 0, 25).toISOString(),
      },
    ];
    mockNoticeFindMany.mockResolvedValue(fakeNotices);

    const { GET } = await import("../app/api/portal/notices/route");
    const res = await GET();
    const data = await res.json();

    // pdfUrl is now always computed from the notice id
    expect(data.notices[0].pdfUrl).toBe("/api/portal/notices/notice-2/pdf");
    expect(data.notices[0].type).toBe("ten_day");
  });

  it("includes serviceMethod and serviceDate fields", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeNotices = [
      {
        id: "notice-3",
        type: "five_day",
        reason: "non_payment",
        amountOwed: 300000,
        serviceMethod: "mail",
        serviceDate: new Date(2026, 0, 5).toISOString(),
        effectiveDate: new Date(2026, 0, 10).toISOString(),
        expirationDate: new Date(2026, 0, 15).toISOString(),
        pdfUrl: "https://storage.example.com/notices/notice-3.pdf",
        createdAt: new Date(2026, 0, 5).toISOString(),
      },
    ];
    mockNoticeFindMany.mockResolvedValue(fakeNotices);

    const { GET } = await import("../app/api/portal/notices/route");
    const res = await GET();
    const data = await res.json();

    expect(data.notices[0].serviceMethod).toBe("mail");
    expect(data.notices[0].serviceDate).toBeDefined();
  });

  it("returns empty array when tenant has no notices", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockNoticeFindMany.mockResolvedValue([]);

    const { GET } = await import("../app/api/portal/notices/route");
    const res = await GET();
    const data = await res.json();

    expect(data.notices).toEqual([]);
  });

  it("queries only visibleInPortal notices for the correct tenant", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession({ id: "tenant-abc" }));
    mockNoticeFindMany.mockResolvedValue([]);

    const { GET } = await import("../app/api/portal/notices/route");
    await GET();

    expect(mockNoticeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-abc",
          visibleInPortal: true,
        },
        orderBy: { createdAt: "desc" },
      })
    );
  });

  it("returns multiple notices in descending order by createdAt", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeNotices = [
      {
        id: "notice-newer",
        type: "thirty_day",
        reason: "lease_termination",
        amountOwed: null,
        serviceMethod: "personal",
        serviceDate: new Date(2026, 1, 1).toISOString(),
        effectiveDate: new Date(2026, 2, 1).toISOString(),
        expirationDate: null,
        pdfUrl: "https://storage.example.com/notices/newer.pdf",
        createdAt: new Date(2026, 1, 1).toISOString(),
      },
      {
        id: "notice-older",
        type: "five_day",
        reason: "non_payment",
        amountOwed: 100000,
        serviceMethod: null,
        serviceDate: null,
        effectiveDate: new Date(2026, 0, 10).toISOString(),
        expirationDate: new Date(2026, 0, 15).toISOString(),
        pdfUrl: null,
        createdAt: new Date(2026, 0, 5).toISOString(),
      },
    ];
    mockNoticeFindMany.mockResolvedValue(fakeNotices);

    const { GET } = await import("../app/api/portal/notices/route");
    const res = await GET();
    const data = await res.json();

    expect(data.notices).toHaveLength(2);
    expect(data.notices[0].id).toBe("notice-newer");
    expect(data.notices[1].id).toBe("notice-older");
  });

  it("includes amountOwed in cents", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeNotices = [
      {
        id: "notice-amount",
        type: "five_day",
        reason: "non_payment",
        amountOwed: 275050, // $2,750.50 in cents
        serviceMethod: null,
        serviceDate: null,
        effectiveDate: new Date(2026, 0, 15).toISOString(),
        expirationDate: new Date(2026, 0, 20).toISOString(),
        pdfUrl: null,
        createdAt: new Date(2026, 0, 10).toISOString(),
      },
    ];
    mockNoticeFindMany.mockResolvedValue(fakeNotices);

    const { GET } = await import("../app/api/portal/notices/route");
    const res = await GET();
    const data = await res.json();

    expect(data.notices[0].amountOwed).toBe(275050);
  });
});
