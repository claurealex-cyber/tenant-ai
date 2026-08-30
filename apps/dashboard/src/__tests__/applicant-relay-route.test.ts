import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: any[]) => mockSession(...a) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const cfg: Record<string, string | null> = {};
const upserts: { key: string; value: string }[] = [];
vi.mock("@/lib/prisma", () => ({
  prisma: {
    zillowLead: { count: vi.fn(async (q: any) => (q?.where?.applicantSentBatchId === null ? 3 : 7)) },
    systemConfig: { upsert: (a: any) => { upserts.push({ key: a.where.key, value: a.create.value }); return Promise.resolve({}); } },
    auditLog: { create: () => Promise.resolve({}) },
  },
}));
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return { ...actual, encrypt: (v: string) => v, clearConfigCache: () => {}, resolveConfig: async (ns: string, k: string) => cfg[`${ns}.${k}`] ?? null };
});
const mockProxy = vi.fn(async (..._a: any[]) => ({ ok: true }));
vi.mock("@/lib/zillow-admin", () => ({ proxyToServer: (...a: any[]) => mockProxy(...a) }));

beforeEach(() => { vi.clearAllMocks(); upserts.length = 0; for (const k of Object.keys(cfg)) delete cfg[k]; });

describe("/api/admin/zillow/applicant-relay", () => {
  it("GET 403 for non-admin", async () => {
    mockSession.mockResolvedValue({ user: { role: "manager" } });
    const { GET } = await import("../app/api/admin/zillow/applicant-relay/route");
    expect((await GET()).status).toBe(403);
  });

  it("GET returns enabled + counts", async () => {
    mockSession.mockResolvedValue({ user: { role: "admin", id: "u" } });
    cfg["textemall.applicant_relay_enabled"] = "true";
    const { GET } = await import("../app/api/admin/zillow/applicant-relay/route");
    const body = await (await GET()).json();
    expect(body.enabled).toBe(true);
    expect(body.applicantCount).toBe(7);
    expect(body.pendingCount).toBe(3);
  });

  it("POST writes enabled + message and refreshes the server", async () => {
    mockSession.mockResolvedValue({ user: { role: "admin", id: "u" } });
    const { POST } = await import("../app/api/admin/zillow/applicant-relay/route");
    const req = new NextRequest("http://localhost/api/admin/zillow/applicant-relay", { method: "POST", body: JSON.stringify({ enabled: true, message: "Thanks for applying!" }) });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const keys = Object.fromEntries(upserts.map((u) => [u.key, u.value]));
    expect(keys["textemall.applicant_relay_enabled"]).toBe("true");
    expect(keys["textemall.applicant_broadcast_message"]).toBe("Thanks for applying!");
    expect(mockProxy).toHaveBeenCalledWith("/internal/config/refresh", expect.objectContaining({ method: "POST" }));
  });
});
