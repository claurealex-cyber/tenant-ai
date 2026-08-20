import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockPrisma, mockSendEmail, mockBuildNoticeGeneratedEmail } = vi.hoisted(() => ({
  mockPrisma: {
    lease: { findUnique: vi.fn() },
    notice: { create: vi.fn() },
    rentCharge: { findMany: vi.fn(), findFirst: vi.fn() },
  },
  mockSendEmail: vi.fn().mockResolvedValue(true),
  mockBuildNoticeGeneratedEmail: vi.fn().mockReturnValue("<html>notice</html>"),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

vi.mock("../lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("../lib/notice-sms", () => ({
  sendNoticeSms: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@tenant-ai/shared", () => ({
  NOTICE_PERIODS: { five_day: 5, ten_day: 10, thirty_day: 30 },
  logAudit: vi.fn().mockResolvedValue(undefined),
  sendEmail: mockSendEmail,
  buildNoticeGeneratedEmail: mockBuildNoticeGeneratedEmail,
}));

import { POST } from "../app/api/notices/route";

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockLease = {
  id: "lease-1",
  tenant: { firstName: "John", lastName: "Doe", email: "john@test.com" },
  unit: {
    unitNumber: "101",
    property: {
      name: "Oak Apartments",
      address: "123 Oak St",
      userId: "user-1",
      user: { name: "Landlord", email: "landlord@test.com" },
    },
  },
};

function buildRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/notices", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Notice email notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.lease.findUnique.mockResolvedValue(mockLease);
    mockPrisma.notice.create.mockResolvedValue({ id: "notice-1", type: "five_day" });
    mockPrisma.rentCharge.findMany.mockResolvedValue([{ amount: 150000, paidAmount: 0 }]);
    mockPrisma.rentCharge.findFirst.mockResolvedValue({ id: "charge-1" });
  });

  it("sends email to tenant on 5-day notice creation", async () => {
    const req = buildRequest({
      type: "five_day",
      leaseId: "lease-1",
      tenantId: "tenant-1",
      content: "test content",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Allow fire-and-forget microtasks to resolve
    await vi.waitFor(() => {
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "john@test.com",
        subject: "Notice Issued - Oak Apartments",
      })
    );
  });

  it("builds email with isLandlord: false and noticeType 5-Day", async () => {
    const req = buildRequest({
      type: "five_day",
      leaseId: "lease-1",
      tenantId: "tenant-1",
      content: "test content",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    await vi.waitFor(() => {
      expect(mockBuildNoticeGeneratedEmail).toHaveBeenCalledTimes(1);
    });

    expect(mockBuildNoticeGeneratedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        isLandlord: false,
        noticeType: "5-Day",
        recipientName: "John Doe",
        propertyName: "Oak Apartments",
        unitNumber: "101",
        tenantName: "John Doe",
      })
    );
  });

  it("passes noticeType 10-Day for ten_day notice", async () => {
    mockPrisma.notice.create.mockResolvedValue({ id: "notice-2", type: "ten_day" });

    const req = buildRequest({
      type: "ten_day",
      leaseId: "lease-1",
      tenantId: "tenant-1",
      violationDescription: "Loud noise",
      content: "test",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    await vi.waitFor(() => {
      expect(mockBuildNoticeGeneratedEmail).toHaveBeenCalledTimes(1);
    });

    expect(mockBuildNoticeGeneratedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        noticeType: "10-Day",
        isLandlord: false,
      })
    );
  });

  it("does not send email when tenant has no email", async () => {
    mockPrisma.lease.findUnique.mockResolvedValue({
      ...mockLease,
      tenant: { firstName: "John", lastName: "Doe", email: null },
    });

    const req = buildRequest({
      type: "five_day",
      leaseId: "lease-1",
      tenantId: "tenant-1",
      content: "test content",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Give fire-and-forget time to execute if it were going to
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("still creates notice when sendEmail throws", async () => {
    mockSendEmail.mockRejectedValueOnce(new Error("SMTP down"));

    const req = buildRequest({
      type: "five_day",
      leaseId: "lease-1",
      tenantId: "tenant-1",
      content: "test content",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.notice).toBeDefined();
    expect(body.notice.id).toBe("notice-1");
  });
});
