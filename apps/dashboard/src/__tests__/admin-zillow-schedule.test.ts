import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

process.env.SERVER_PORT = "3001";
process.env.PII_ENCRYPTION_KEY = "a".repeat(64);

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...args: any[]) => mockGetServerSession(...args) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const mockUpsert = vi.fn();
const mockAudit = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemConfig: { upsert: (...a: any[]) => mockUpsert(...a) },
    auditLog: { create: (...a: any[]) => mockAudit(...a) },
  },
}));

const cfg: Record<string, string | null> = {};
const mockClearCache = vi.fn();
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return {
    ...actual,
    resolveConfig: async (ns: string, key: string) => cfg[`${ns}.${key}`] ?? (key === "internal_secret" ? "secret-x" : null),
    clearConfigCache: () => mockClearCache(),
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { POST } from "../app/api/admin/zillow/schedule/route";
import { POST as togglePost } from "../app/api/admin/zillow/auto-toggle/route";
import { decrypt } from "@tenant-ai/shared";

const admin = { user: { role: "admin", id: "admin-1" } };
const req = (body: unknown, path = "schedule") =>
  new NextRequest(`http://x/api/admin/zillow/${path}`, { method: "POST", body: JSON.stringify(body) });
const writes = () => Object.fromEntries(mockUpsert.mock.calls.map((c) => [c[0].where.key, decrypt(c[0].create.value)]));

beforeEach(() => {
  mockGetServerSession.mockReset().mockResolvedValue(admin);
  for (const k of Object.keys(cfg)) delete cfg[k];
  cfg["zillow.auto_enabled"] = "true";
  cfg["zillow.auto_run_hours"] = "10,16,22";
  cfg["zillow.send_channel"] = "textemall";
  mockUpsert.mockReset().mockResolvedValue({});
  mockAudit.mockReset().mockResolvedValue({});
  mockClearCache.mockReset();
  mockFetch.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("POST /api/admin/zillow/schedule", () => {
  it("rejects non-admins and bad modes", async () => {
    mockGetServerSession.mockResolvedValue({ user: { role: "client" } });
    expect((await POST(req({ mode: "fixed", hours: [10] }))).status).toBe(403);
    mockGetServerSession.mockResolvedValue(admin);
    expect((await POST(req({ mode: "weekly" }))).status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("fixed: invalid hours → 400 with every error named; nothing written", async () => {
    const res = await POST(req({ mode: "fixed", hours: [10, 24, "x"] }));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.errors).toHaveLength(2);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect((await POST(req({ mode: "fixed", hours: [] }))).status).toBe(400);
  });

  it("fixed 3×/day on Text-Em-All: writes the ENCRYPTED CSV, audits before/after, clears both caches, returns the summary", async () => {
    const res = await POST(req({ mode: "fixed", hours: [22, 10, "16"] }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.schedule).toMatchObject({ mode: "fixed", hours: [10, 16, 22], runsPerDay: 3, monthlyEstimate: 93, capWarning: false, label: "3×/day at 10:00, 16:00, 22:00" });
    expect(j.serverRefreshed).toBe(true);
    const w = writes();
    expect(Object.keys(w)).toEqual(["zillow.auto_run_hours"]);
    expect(w["zillow.auto_run_hours"]).toBe("10,16,22");
    expect(mockUpsert.mock.calls[0][0].create.value).toMatch(/^v1:/);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][0].data).toMatchObject({ action: "zillow_schedule", metadata: { before: { runHours: "10,16,22" }, after: { mode: "fixed", runHours: "10,16,22" } } });
    expect(mockClearCache).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3001/internal/config/refresh");
    expect(init.headers["x-relay-secret"]).toBe("secret-x");
  });

  it("free-tier guard: 4×/day on Text-Em-All → 400 needsAck; with acknowledgeCap → 200 and audited as acknowledged", async () => {
    const refused = await POST(req({ mode: "fixed", hours: [9, 12, 16, 20] }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ needsAck: true, estimate: 124, cap: 96 });
    expect(mockUpsert).not.toHaveBeenCalled();
    const ok = await POST(req({ mode: "fixed", hours: [9, 12, 16, 20], acknowledgeCap: true }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).schedule.capWarning).toBe(true);
    expect(mockAudit.mock.calls[0][0].data.metadata.acknowledgedCap).toBe(true);
  });

  it("free-tier guard respects a raised cap and does not apply on the relay channel", async () => {
    cfg["textemall.monthly_fire_cap"] = "130";
    expect((await POST(req({ mode: "fixed", hours: [9, 12, 16, 20] }))).status).toBe(200);
    delete cfg["textemall.monthly_fire_cap"];
    cfg["zillow.send_channel"] = "relay";
    expect((await POST(req({ mode: "fixed", hours: [9, 12, 16, 20] }))).status).toBe(200);
  });

  it("hourly: blanks auto_run_hours (one upsert path), writes the window and the broadcast hour; validates the window", async () => {
    const res = await POST(req({ mode: "hourly", startHour: 8, endHour: 22, broadcastHour: 12, acknowledgeCap: true }));
    expect(res.status).toBe(200);
    expect(writes()).toEqual({ "zillow.auto_run_hours": "", "zillow.auto_start_hour": "8", "zillow.auto_end_hour": "22", "zillow.textemall_broadcast_hour": "12" });
    expect((await res.json()).schedule).toMatchObject({ mode: "hourly", runsPerDay: 15, label: "hourly from 08:00 to 22:00" });
    mockUpsert.mockClear();
    expect((await POST(req({ mode: "hourly", startHour: 20, endHour: 8 }))).status).toBe(400);
    expect((await POST(req({ mode: "hourly", startHour: 8 }))).status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("server refresh failure is best-effort: still 200, serverRefreshed=false", async () => {
    mockFetch.mockRejectedValue(new Error("down"));
    const res = await POST(req({ mode: "fixed", hours: [10, 16, 22] }));
    expect(res.status).toBe(200);
    expect((await res.json()).serverRefreshed).toBe(false);
  });

  it("re-saving the same schedule is idempotent (same write, same result)", async () => {
    const a = await (await POST(req({ mode: "fixed", hours: [10, 16, 22] }))).json();
    const b = await (await POST(req({ mode: "fixed", hours: [10, 16, 22] }))).json();
    expect(a.schedule).toEqual(b.schedule);
  });
});

describe("auto-toggle is flag-only and refreshes the server cache", () => {
  it("ignores startHour/endHour and proxies /internal/config/refresh", async () => {
    const res = await togglePost(req({ enabled: false, startHour: 1, endHour: 2 }, "auto-toggle"));
    expect(res.status).toBe(200);
    expect(Object.keys(writes())).toEqual(["zillow.auto_enabled"]);
    expect(mockFetch.mock.calls.map((c) => c[0])).toContain("http://127.0.0.1:3001/internal/config/refresh");
  });
});
