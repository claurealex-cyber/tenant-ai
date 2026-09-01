import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/** Interval-editor plan rev.2 M2 gate — POST /api/admin/zillow/realtime. */

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

import { POST } from "../app/api/admin/zillow/realtime/route";
import { decrypt } from "@tenant-ai/shared";

const admin = { user: { role: "admin", id: "admin-1" } };
const req = (body: unknown) =>
  new NextRequest("http://x/api/admin/zillow/realtime", { method: "POST", body: JSON.stringify(body) });

const REALTIME_BLOCK = { active: true, fastPollSec: 120, configuredSec: 120, floorSec: 120 };

beforeEach(() => {
  mockGetServerSession.mockReset().mockResolvedValue(admin);
  for (const k of Object.keys(cfg)) delete cfg[k];
  cfg["zillow.fast_poll_sec"] = "180";
  mockUpsert.mockReset().mockResolvedValue({});
  mockAudit.mockReset().mockResolvedValue({});
  mockClearCache.mockReset();
  mockFetch.mockReset().mockImplementation(async (url: string) =>
    String(url).includes("auto-status")
      ? new Response(JSON.stringify({ realtime: REALTIME_BLOCK }), { status: 200 })
      : new Response("{}", { status: 200 }),
  );
});

describe("POST /api/admin/zillow/realtime", () => {
  it("403 for non-admins; nothing written", async () => {
    mockGetServerSession.mockResolvedValue({ user: { role: "client" } });
    expect((await POST(req({ minutes: 3 }))).status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("400 on garbage or missing input; nothing written", async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ minutes: "x" }))).status).toBe(400);
    expect((await POST(req({ seconds: -5 }))).status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("writes minutes → encrypted seconds, audits before/after, clears both caches, echoes the server's realtime block", async () => {
    const res = await POST(req({ minutes: 3 }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, fastPollSec: 180, clamped: false, serverRefreshed: true, realtime: REALTIME_BLOCK });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.key).toBe("zillow.fast_poll_sec");
    expect(call.create.value).toMatch(/^v1:/); // encrypted at rest
    expect(decrypt(call.create.value)).toBe("180");
    expect(mockAudit.mock.calls[0][0].data).toMatchObject({
      action: "zillow_poll_interval_update",
      resourceId: "zillow.fast_poll_sec",
      metadata: { before: "180", after: "180", clamped: false },
    });
    expect(mockClearCache).toHaveBeenCalledTimes(1);
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe("http://127.0.0.1:3001/internal/config/refresh");
    expect(urls[1]).toBe("http://127.0.0.1:3001/internal/zillow/auto-status");
    expect(mockFetch.mock.calls[0][1].headers["x-relay-secret"]).toBe("secret-x");
  });

  it("1 minute is CLAMPED to the floor and flagged (UI shows 'raised to 2 min')", async () => {
    const res = await POST(req({ minutes: 1 }));
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, fastPollSec: 120, clamped: true });
    expect(decrypt(mockUpsert.mock.calls[0][0].create.value)).toBe("120");
    expect(mockAudit.mock.calls[0][0].data.metadata.clamped).toBe(true);
  });

  it("off:true stores '0'", async () => {
    const res = await POST(req({ off: true }));
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, fastPollSec: 0, clamped: false });
    expect(decrypt(mockUpsert.mock.calls[0][0].create.value)).toBe("0");
  });

  it("seconds path works and clamps above the max", async () => {
    const res = await POST(req({ seconds: 5000 }));
    expect((await res.json()).fastPollSec).toBe(3600);
  });

  it("refresh failure → serverRefreshed:false, realtime still fetched best-effort", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      String(url).includes("auto-status")
        ? new Response(JSON.stringify({ realtime: REALTIME_BLOCK }), { status: 200 })
        : new Response("{}", { status: 500 }),
    );
    const j = await (await POST(req({ minutes: 2 }))).json();
    expect(j).toMatchObject({ ok: true, serverRefreshed: false, realtime: REALTIME_BLOCK });
  });

  it("auto-status failure → realtime null, write still succeeds", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      String(url).includes("auto-status") ? new Response("nope", { status: 500 }) : new Response("{}", { status: 200 }),
    );
    const j = await (await POST(req({ minutes: 2 }))).json();
    expect(j).toMatchObject({ ok: true, fastPollSec: 120, serverRefreshed: true, realtime: null });
  });
});
