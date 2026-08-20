import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

process.env.SERVER_PORT = "3001";

// ── Mocks ──

const mockGetServerSession = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockAdminSession() {
  mockGetServerSession.mockResolvedValue({
    user: { id: "admin-1", role: "admin", email: "admin@test.com" },
  });
}

function makeRequest() {
  return new NextRequest("http://localhost:3000/api/admin/server-health");
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ──

describe("GET /api/admin/server-health", () => {
  it("returns 403 for non-admin users", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "manager" },
    });
    const { GET } = await import("../app/api/admin/server-health/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it("proxies health data from the server on SERVER_PORT", async () => {
    mockAdminSession();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", database: "connected" }),
    });

    const { GET } = await import("../app/api/admin/server-health/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/health",
      expect.objectContaining({ cache: "no-store" })
    );
    expect(data.ok).toBe(true);
    expect(data.target).toBe("http://127.0.0.1:3001/health");
    expect(data.health.status).toBe("ok");
  });

  it("reports ok=false with the target when the server is down", async () => {
    mockAdminSession();
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const { GET } = await import("../app/api/admin/server-health/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(false);
    expect(data.target).toBe("http://127.0.0.1:3001/health");
    expect(data.health).toBeUndefined();
  });
});
