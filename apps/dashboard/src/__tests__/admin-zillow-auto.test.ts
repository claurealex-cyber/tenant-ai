import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

process.env.SERVER_PORT = "3001";
// encrypt()/decrypt() in the toggle route need the key (see project gotchas)
process.env.PII_ENCRYPTION_KEY = "a".repeat(64); // 64-char hex (32 bytes)

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const mockUpsert = vi.fn();
const mockAudit = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemConfig: { upsert: (...a: any[]) => mockUpsert(...a) },
    auditLog: { create: (...a: any[]) => mockAudit(...a) },
  },
}));

const mockResolveConfig = vi.fn();
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return {
    ...actual,
    resolveConfig: (...args: any[]) => mockResolveConfig(...args),
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { GET as statusGet } from "../app/api/admin/zillow/auto-status/route";
import { POST as runPost } from "../app/api/admin/zillow/auto-run/route";
import { POST as togglePost } from "../app/api/admin/zillow/auto-toggle/route";
import { decrypt } from "@tenant-ai/shared";

const adminSession = { user: { role: "admin", id: "admin-1" } };
let existingBaseline: string | null = null;

function toggleReq(body: unknown) {
  return new NextRequest("http://x/api/admin/zillow/auto-toggle", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockGetServerSession.mockReset().mockResolvedValue(adminSession);
  existingBaseline = null;
  mockResolveConfig.mockReset().mockImplementation(async (ns: string, key: string) => {
    if (ns === "zillow" && key === "auto_baseline") return existingBaseline;
    return "secret-x";
  });
  mockFetch.mockReset();
  mockUpsert.mockReset().mockResolvedValue({});
  mockAudit.mockReset().mockResolvedValue({});
});

describe("auto-status / auto-run proxies", () => {
  it("rejects non-admins", async () => {
    mockGetServerSession.mockResolvedValue({ user: { role: "client" } });
    expect((await statusGet()).status).toBe(403);
    expect((await runPost()).status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("auto-status proxies with the secret", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ enabled: false, totals: { leads: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await statusGet();
    expect(res.status).toBe(200);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3001/internal/zillow/auto-status");
    expect(init.headers["x-relay-secret"]).toBe("secret-x");
  });

  it("auto-run forces", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ outcome: "ran" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const res = await runPost();
    expect(res.status).toBe(200);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3001/internal/zillow/auto-run");
    expect(JSON.parse(init.body)).toEqual({ force: true });
  });
});

describe("auto-toggle", () => {
  it("rejects non-admins and bad bodies", async () => {
    mockGetServerSession.mockResolvedValue({ user: { role: "client" } });
    expect((await togglePost(toggleReq({ enabled: true }))).status).toBe(403);

    mockGetServerSession.mockResolvedValue(adminSession);
    expect((await togglePost(toggleReq({}))).status).toBe(400);
    expect((await togglePost(toggleReq({ enabled: "yes" }))).status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("enabling writes ENCRYPTED flag + today-baseline and audit-logs", async () => {
    const res = await togglePost(toggleReq({ enabled: true, baselineMode: "new" }));
    expect(res.status).toBe(200);

    const writes = Object.fromEntries(
      mockUpsert.mock.calls.map(([args]: any[]) => [args.where.key, args.create.value]),
    );
    expect(Object.keys(writes).sort()).toEqual(["zillow.auto_baseline", "zillow.auto_enabled"]);
    expect(writes["zillow.auto_enabled"]).toMatch(/^v1:/);
    expect(decrypt(writes["zillow.auto_enabled"])).toBe("true");
    // First enable with no existing baseline → baseline = NOW (import-time boundary).
    const baseline = new Date(decrypt(writes["zillow.auto_baseline"]));
    expect(Date.now() - baseline.getTime()).toBeLessThan(60_000);

    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][0].data).toMatchObject({
      action: "zillow_automation_toggle",
      metadata: { enabled: true, baselineMode: "new", resetBaseline: false },
    });
  });

  it("baselineMode=all writes the epoch baseline", async () => {
    await togglePost(toggleReq({ enabled: true, baselineMode: "all" }));
    const writes = Object.fromEntries(
      mockUpsert.mock.calls.map(([args]: any[]) => [args.where.key, args.create.value]),
    );
    expect(decrypt(writes["zillow.auto_baseline"])).toBe(new Date(0).toISOString());
  });

  it("re-enable PRESERVES an existing baseline (set-once) — does not move it forward", async () => {
    existingBaseline = "2026-08-01T12:00:00.000Z"; // a real earlier baseline
    await togglePost(toggleReq({ enabled: true, baselineMode: "new" }));
    const keys = mockUpsert.mock.calls.map(([a]: any[]) => a.where.key);
    expect(keys).toContain("zillow.auto_enabled");
    expect(keys).not.toContain("zillow.auto_baseline"); // baseline untouched on re-enable
  });

  it("resetBaseline forces the baseline to now even when one exists", async () => {
    existingBaseline = "2026-08-01T12:00:00.000Z";
    await togglePost(toggleReq({ enabled: true, baselineMode: "new", resetBaseline: true }));
    const writes = Object.fromEntries(mockUpsert.mock.calls.map(([a]: any[]) => [a.where.key, a.create.value]));
    expect(writes["zillow.auto_baseline"]).toBeTruthy();
    expect(Date.now() - new Date(decrypt(writes["zillow.auto_baseline"])).getTime()).toBeLessThan(60_000);
  });

  it("disabling writes only the flag and never touches the baseline", async () => {
    await togglePost(toggleReq({ enabled: false }));
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][0].where.key).toBe("zillow.auto_enabled");
    expect(decrypt(mockUpsert.mock.calls[0][0].create.value)).toBe("false");
  });
});
