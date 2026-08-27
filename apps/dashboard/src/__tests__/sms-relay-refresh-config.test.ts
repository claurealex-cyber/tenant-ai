import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: any[]) => mockGetServerSession(...a) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const mockClear = vi.fn();
const mockResolveConfig = vi.fn(async (..._a: unknown[]) => "the-secret");
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return { ...actual, clearConfigCache: (...a: any[]) => mockClear(...a), resolveConfig: (...a: unknown[]) => mockResolveConfig(...a) };
});
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function req() {
  return new NextRequest("http://localhost:3000/api/admin/sms-relay/refresh-config", { method: "POST" });
}

describe("POST /api/admin/sms-relay/refresh-config", () => {
  beforeEach(() => vi.clearAllMocks());

  it("403 for non-admin", async () => {
    mockGetServerSession.mockResolvedValue({ user: { role: "manager" } });
    const { POST } = await import("../app/api/admin/sms-relay/refresh-config/route");
    expect((await POST()).status).toBe(403);
  });

  it("clears the dashboard cache AND hops to the server internal refresh", async () => {
    mockGetServerSession.mockResolvedValue({ user: { role: "admin" } });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const { POST } = await import("../app/api/admin/sms-relay/refresh-config/route");
    const res = await POST();
    const body = await res.json();
    expect(mockClear).toHaveBeenCalled();
    const call = mockFetch.mock.calls.find((c) => String(c[0]).includes("/internal/config/refresh"));
    expect(call).toBeTruthy();
    expect(call![1].headers["x-relay-secret"]).toBe("the-secret");
    expect(body).toEqual({ ok: true, serverRefreshed: true });
  });

  it("still succeeds (serverRefreshed:false) when the server hop fails", async () => {
    mockGetServerSession.mockResolvedValue({ user: { role: "admin" } });
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const { POST } = await import("../app/api/admin/sms-relay/refresh-config/route");
    const body = await (await POST()).json();
    expect(mockClear).toHaveBeenCalled();
    expect(body).toEqual({ ok: true, serverRefreshed: false });
  });
});
