import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────────────────────
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    notice: { findUnique: vi.fn() },
  },
}));

vi.mock("../lib/notice-sms", () => ({
  sendNoticeSms: vi.fn(),
}));

vi.mock("../lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";
import { prisma } from "../lib/prisma";
import { sendNoticeSms } from "../lib/notice-sms";
import { POST } from "../app/api/notices/[id]/sms/route";

// ── Helpers ────────────────────────────────────────────────────────────
const mockSession = { user: { id: "user-1" } };

const mockNotice = {
  id: "notice-1",
  lease: { unit: { property: { userId: "user-1" } } },
};

function buildRequest() {
  return new NextRequest("http://localhost/api/notices/notice-1/sms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: "notice-1" }) };

// ── Tests ──────────────────────────────────────────────────────────────
describe("POST /api/notices/[id]/sms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const res = await POST(buildRequest(), params);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when notice is not found", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(prisma.notice.findUnique).mockResolvedValue(null);

    const res = await POST(buildRequest(), params);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Notice not found");
  });

  it("returns 404 when the notice belongs to a different owner", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(prisma.notice.findUnique).mockResolvedValue({
      id: "notice-1",
      lease: { unit: { property: { userId: "other-user" } } },
    } as any);

    const res = await POST(buildRequest(), params);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Notice not found");
  });

  it("returns 200 with sid and smsSentAt on success", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(prisma.notice.findUnique).mockResolvedValue(mockNotice as any);
    vi.mocked(sendNoticeSms).mockResolvedValue({
      success: true,
      sid: "SM123abc",
    });

    const res = await POST(buildRequest(), params);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sid).toBe("SM123abc");
    expect(body.smsSentAt).toBeDefined();

    expect(sendNoticeSms).toHaveBeenCalledWith("notice-1");
  });

  it("returns 422 when sendNoticeSms reports an error", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(prisma.notice.findUnique).mockResolvedValue(mockNotice as any);
    vi.mocked(sendNoticeSms).mockResolvedValue({
      success: false,
      error: "Tenant has no phone number on file",
    });

    const res = await POST(buildRequest(), params);
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error).toBe("Tenant has no phone number on file");
  });
});
