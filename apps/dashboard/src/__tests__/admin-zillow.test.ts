import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

process.env.SERVER_PORT = "3001";

// ── Mocks ──

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

// zillow-admin imports @/lib/prisma only for its config-resolver side effect
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

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

import { POST as importPost } from "../app/api/admin/zillow/import/route";
import { GET as leadsGet } from "../app/api/admin/zillow/leads/route";
import { GET as csvGet } from "../app/api/admin/zillow/csv/route";
import { POST as sendPost } from "../app/api/admin/zillow/send/route";
import { POST as batchPost } from "../app/api/admin/zillow/send-batch/route";
import { GET as runsGet } from "../app/api/admin/zillow/runs/route";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const adminSession = { user: { role: "admin", email: "admin@test.com" } };

beforeEach(() => {
  mockGetServerSession.mockReset();
  mockResolveConfig.mockReset();
  mockFetch.mockReset();
  mockGetServerSession.mockResolvedValue(adminSession);
  mockResolveConfig.mockResolvedValue("shh-internal-secret");
});

describe("admin/zillow auth", () => {
  it("rejects non-admin sessions on every route", async () => {
    mockGetServerSession.mockResolvedValue({ user: { role: "client" } });
    expect((await importPost()).status).toBe(403);
    expect((await leadsGet(new NextRequest("http://x/api/admin/zillow/leads"))).status).toBe(403);
    expect((await csvGet()).status).toBe(403);
    expect((await runsGet()).status).toBe(403);
    expect(
      (await sendPost(new NextRequest("http://x/api/admin/zillow/send", { method: "POST", body: "{}" }))).status,
    ).toBe(403);
    expect(
      (await batchPost(new NextRequest("http://x/api/admin/zillow/send-batch", { method: "POST", body: "{}" }))).status,
    ).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects signed-out sessions", async () => {
    mockGetServerSession.mockResolvedValue(null);
    expect((await importPost()).status).toBe(403);
  });
});

describe("admin/zillow proxying", () => {
  it("import: proxies POST with the secret header and returns the summary", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ runId: "r1", status: "done", leadsFound: 200, leadsNew: 5 }));
    const res = await importPost();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "done", leadsNew: 5 });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3001/internal/zillow/import");
    expect(init.method).toBe("POST");
    expect(init.headers["x-relay-secret"]).toBe("shh-internal-secret");
    expect(init.body).toBe("{}");
  });

  it("leads: passes the status filter through", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ leads: [] }));
    const res = await leadsGet(new NextRequest("http://x/api/admin/zillow/leads?status=new"));
    expect(res.status).toBe(200);
    expect(mockFetch.mock.calls[0][0]).toBe("http://127.0.0.1:3001/internal/zillow/leads?status=new");
  });

  it("csv: returns text/csv with a download disposition", async () => {
    mockFetch.mockResolvedValue(
      new Response("nombre,telefono\nA,+13120000000\n", {
        status: 200,
        headers: { "Content-Disposition": 'attachment; filename="zillow_leads_x.csv"' },
      }),
    );
    const res = await csvGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(await res.text()).toContain("nombre,telefono");
  });

  it("send: requires a leadId", async () => {
    const res = await sendPost(
      new NextRequest("http://x/api/admin/zillow/send", { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("send: proxies to the lead's send endpoint", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ leadId: "L1", result: "sent" }));
    const res = await sendPost(
      new NextRequest("http://x/api/admin/zillow/send", { method: "POST", body: JSON.stringify({ leadId: "L1" }) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "sent" });
    expect(mockFetch.mock.calls[0][0]).toBe("http://127.0.0.1:3001/internal/zillow/leads/L1/send");
  });

  it("send-batch: forwards only sanctioned fields", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ eligible: 3, sent: 1, deferred: 2, skipped: 0, failed: 0 }));
    const res = await batchPost(
      new NextRequest("http://x/api/admin/zillow/send-batch", {
        method: "POST",
        body: JSON.stringify({ includeOlder: true, propertyId: "p1", evil: "x" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ includeOlder: true, propertyId: "p1" });
  });

  it("returns 502 when the API server is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect((await importPost()).status).toBe(502);
    expect((await leadsGet(new NextRequest("http://x/api/admin/zillow/leads"))).status).toBe(502);
  });

  it("errors when the internal secret is missing instead of calling unauthenticated", async () => {
    mockResolveConfig.mockResolvedValue(null);
    const res = await runsGet();
    expect(res.status).toBe(500);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
