import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

process.env.SERVER_PORT = "3001";

const PUBLIC_URL = "https://example.ngrok-free.dev";
const NGROK_API = "http://127.0.0.1:4040";

// ── Mocks ──

const mockGetServerSession = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

const mockPropertyFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    property: {
      findMany: (...args: any[]) => mockPropertyFindMany(...args),
    },
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

const mockNumberUpdate = vi.fn();
const mockNumberFetch = vi.fn();
const mockIncomingPhoneNumbers = vi.fn(() => ({
  update: mockNumberUpdate,
  fetch: mockNumberFetch,
}));

vi.mock("twilio", () => ({
  default: vi.fn(() => ({
    incomingPhoneNumbers: mockIncomingPhoneNumbers,
  })),
}));

const mockSpawn = vi.fn();

vi.mock("child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ──

function mockAdminSession() {
  mockGetServerSession.mockResolvedValue({
    user: { id: "admin-1", role: "admin", email: "admin@test.com" },
  });
}

function mockConfig({
  sid = "ACtest",
  token = "tok",
  publicUrl = PUBLIC_URL,
}: { sid?: string | null; token?: string | null; publicUrl?: string | null } = {}) {
  mockResolveConfig.mockImplementation(async (_ns: string, key: string) => {
    if (key === "account_sid") return sid;
    if (key === "auth_token") return token;
    if (key === "public_url") return publicUrl;
    return null;
  });
}

const RUNNING_TUNNEL = {
  name: "tenant-ai",
  public_url: PUBLIC_URL,
  config: { addr: "http://localhost:3001" },
};

/** Route fetch calls by URL: ngrok agent API + public health check. */
function mockFetchRoutes({
  tunnels,
  healthOk = true,
}: {
  tunnels: unknown[] | null; // null = agent not running
  healthOk?: boolean;
}) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.startsWith(`${NGROK_API}/api/tunnels`)) {
      if (tunnels === null) throw new Error("ECONNREFUSED");
      return {
        ok: true,
        json: async () => ({ tunnels }),
      };
    }
    if (url === `${PUBLIC_URL}/health`) {
      return { ok: healthOk, json: async () => ({ status: "ok" }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

const REAL_SID = "PN340c9568d2381380dca04c7ea297aa6b";

const REAL_PROPERTY = {
  id: "prop-1",
  name: "Ghem Properties",
  twilioPhone: "+17088158559",
  twilioPhoneSid: REAL_SID,
};

function makeRequest(method: string) {
  return new NextRequest("http://localhost:3000/api/admin/phone-system", {
    method,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPropertyFindMany.mockResolvedValue([REAL_PROPERTY]);
});

// ── Tests ──

describe("GET /api/admin/phone-system", () => {
  it("returns 403 for non-admin users", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "manager" },
    });
    const { GET } = await import("../app/api/admin/phone-system/route");
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(403);
  });

  it("reports ready when tunnel, health, and webhooks are all correct", async () => {
    mockAdminSession();
    mockConfig();
    mockFetchRoutes({ tunnels: [RUNNING_TUNNEL] });
    mockNumberFetch.mockResolvedValue({
      voiceUrl: `${PUBLIC_URL}/voice/incoming`,
      smsUrl: `${PUBLIC_URL}/sms/incoming`,
    });

    const { GET } = await import("../app/api/admin/phone-system/route");
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(200);
    const { status } = await res.json();

    expect(status.ready).toBe(true);
    expect(status.tunnel).toEqual({
      running: true,
      forwardsTo: "http://localhost:3001",
      correct: true,
      target: "server", // SERVER_PORT=3001 in this file → server-direct = healthy
    });
    expect(status.publicHealthOk).toBe(true);
    expect(status.numbers).toHaveLength(1);
    expect(status.numbers[0]).toMatchObject({
      phone: "+17088158559",
      webhooksOk: true,
    });
  });

  it("reports not ready with stale webhooks", async () => {
    mockAdminSession();
    mockConfig();
    mockFetchRoutes({ tunnels: [RUNNING_TUNNEL] });
    mockNumberFetch.mockResolvedValue({
      voiceUrl: `${PUBLIC_URL}/twilio/voice`,
      smsUrl: `${PUBLIC_URL}/twilio/sms`,
    });

    const { GET } = await import("../app/api/admin/phone-system/route");
    const res = await GET(makeRequest("GET"));
    const { status } = await res.json();

    expect(status.ready).toBe(false);
    expect(status.numbers[0].webhooksOk).toBe(false);
  });

  it("reports tunnel not running when the ngrok agent is down", async () => {
    mockAdminSession();
    mockConfig();
    mockFetchRoutes({ tunnels: null });

    const { GET } = await import("../app/api/admin/phone-system/route");
    const res = await GET(makeRequest("GET"));
    const { status } = await res.json();

    expect(status.ready).toBe(false);
    expect(status.tunnel.running).toBe(false);
    expect(status.publicHealthOk).toBe(false);
  });

  it("ignores mock- and demo-provisioned numbers", async () => {
    mockAdminSession();
    mockConfig();
    mockFetchRoutes({ tunnels: [RUNNING_TUNNEL] });
    mockPropertyFindMany.mockResolvedValue([
      { ...REAL_PROPERTY, twilioPhoneSid: "PN_mock_123" },
      { ...REAL_PROPERTY, id: "prop-2", twilioPhoneSid: "PN_DEMO_001" },
      { ...REAL_PROPERTY, id: "prop-3", twilioPhoneSid: "PN_1770760838900" },
    ]);

    const { GET } = await import("../app/api/admin/phone-system/route");
    const res = await GET(makeRequest("GET"));
    const { status } = await res.json();

    expect(status.numbers).toHaveLength(0);
    expect(mockNumberFetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/phone-system", () => {
  it("returns 403 for non-admin users", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "manager" },
    });
    const { POST } = await import("../app/api/admin/phone-system/route");
    const res = await POST(makeRequest("POST"));
    expect(res.status).toBe(403);
  });

  it("reuses a running tunnel and syncs webhooks to the server routes", async () => {
    mockAdminSession();
    mockConfig();
    mockFetchRoutes({ tunnels: [RUNNING_TUNNEL] });
    mockNumberUpdate.mockResolvedValue({});

    const { POST } = await import("../app/api/admin/phone-system/route");
    const res = await POST(makeRequest("POST"));
    expect(res.status).toBe(200);
    const result = await res.json();

    expect(result.ready).toBe(true);
    expect(result.steps.every((s: { ok: boolean }) => s.ok)).toBe(true);
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockIncomingPhoneNumbers).toHaveBeenCalledWith(REAL_SID);
    expect(mockNumberUpdate).toHaveBeenCalledWith({
      voiceUrl: `${PUBLIC_URL}/voice/incoming`,
      voiceMethod: "POST",
      voiceFallbackUrl: `${PUBLIC_URL}/voice/fallback`,
      voiceFallbackMethod: "POST",
      smsUrl: `${PUBLIC_URL}/sms/incoming`,
      smsMethod: "POST",
    });
  });

  it("spawns ngrok when the agent is not running", async () => {
    mockAdminSession();
    mockConfig();
    // Agent down at first; running with the tunnel after spawn.
    let spawned = false;
    mockSpawn.mockImplementation(() => {
      spawned = true;
      return { unref: () => undefined };
    });
    mockFetch.mockImplementation(async (url: string) => {
      if (url.startsWith(`${NGROK_API}/api/tunnels`)) {
        if (!spawned) throw new Error("ECONNREFUSED");
        return { ok: true, json: async () => ({ tunnels: [RUNNING_TUNNEL] }) };
      }
      if (url === `${PUBLIC_URL}/health`) {
        return { ok: true, json: async () => ({ status: "ok" }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    mockNumberUpdate.mockResolvedValue({});

    const { POST } = await import("../app/api/admin/phone-system/route");
    const res = await POST(makeRequest("POST"));
    const result = await res.json();

    expect(mockSpawn).toHaveBeenCalledWith(
      "ngrok",
      expect.arrayContaining(["http", "--url=example.ngrok-free.dev", "3001"]),
      expect.objectContaining({ detached: true })
    );
    expect(result.ready).toBe(true);
  }, 20000);

  it("fails early when no public URL is configured", async () => {
    mockAdminSession();
    mockConfig({ publicUrl: null });
    delete process.env.PUBLIC_URL;

    const { POST } = await import("../app/api/admin/phone-system/route");
    const res = await POST(makeRequest("POST"));
    const result = await res.json();

    expect(result.ready).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].ok).toBe(false);
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockNumberUpdate).not.toHaveBeenCalled();
  });

  it("skips webhook sync when Twilio credentials are missing", async () => {
    mockAdminSession();
    mockConfig({ sid: null, token: null });
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    mockFetchRoutes({ tunnels: [RUNNING_TUNNEL] });

    const { POST } = await import("../app/api/admin/phone-system/route");
    const res = await POST(makeRequest("POST"));
    const result = await res.json();

    expect(result.ready).toBe(false);
    const webhookStep = result.steps.find(
      (s: { name: string }) => s.name === "Twilio webhooks"
    );
    expect(webhookStep.skipped).toBe(true);
    expect(mockNumberUpdate).not.toHaveBeenCalled();
  });

  it("only syncs webhooks for numbers with real Twilio SIDs", async () => {
    mockAdminSession();
    mockConfig();
    mockFetchRoutes({ tunnels: [RUNNING_TUNNEL] });
    mockPropertyFindMany.mockResolvedValue([
      REAL_PROPERTY,
      { ...REAL_PROPERTY, id: "prop-2", twilioPhoneSid: "PN_DEMO_001" },
    ]);
    mockNumberUpdate.mockResolvedValue({});

    const { POST } = await import("../app/api/admin/phone-system/route");
    const res = await POST(makeRequest("POST"));
    const result = await res.json();

    expect(result.ready).toBe(true);
    expect(mockIncomingPhoneNumbers).toHaveBeenCalledTimes(1);
    expect(mockIncomingPhoneNumbers).toHaveBeenCalledWith(REAL_SID);
  });

  it("reports failure when the public health check never passes", async () => {
    mockAdminSession();
    mockConfig();
    mockFetchRoutes({ tunnels: [RUNNING_TUNNEL], healthOk: false });

    const { POST } = await import("../app/api/admin/phone-system/route");
    const res = await POST(makeRequest("POST"));
    const result = await res.json();

    expect(result.ready).toBe(false);
    const healthStep = result.steps.find(
      (s: { name: string }) => s.name === "Public health check"
    );
    expect(healthStep.ok).toBe(false);
    expect(mockNumberUpdate).not.toHaveBeenCalled();
  }, 20000);
});

// ── Tunnel target model (proxy vs server vs other) + web access switch ──

describe("tunnel target model", () => {
  const PROXY_TUNNEL = { ...RUNNING_TUNNEL, config: { addr: "http://localhost:3010" } };
  const WRONG_TUNNEL = { ...RUNNING_TUNNEL, config: { addr: "http://localhost:9999" } };

  /** Like mockFetchRoutes, plus the local Caddy /health probe. */
  function mockRoutesWithProxy({ tunnels, proxyUp }: { tunnels: unknown[] | null; proxyUp: boolean }) {
    mockFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "http://127.0.0.1:3010/health") {
        if (!proxyUp) throw new Error("ECONNREFUSED");
        return { ok: true, json: async () => ({ status: "ok" }) };
      }
      if (url.startsWith(`${NGROK_API}/api/tunnels`)) {
        if (tunnels === null) throw new Error("ECONNREFUSED");
        if (init?.method === "DELETE" || init?.method === "POST") return { ok: true, json: async () => ({}) };
        return { ok: true, json: async () => ({ tunnels }) };
      }
      if (url === `${PUBLIC_URL}/health`) return { ok: true, json: async () => ({ status: "ok" }) };
      throw new Error(`Unexpected fetch: ${url}`);
    });
  }

  it("classifyTunnelTarget: proxy / server / other by port", async () => {
    const { classifyTunnelTarget } = await import("../lib/phone-system");
    const ports = { server: 3005, proxy: 3010 };
    expect(classifyTunnelTarget("http://localhost:3010", ports)).toBe("proxy");
    expect(classifyTunnelTarget("http://localhost:3005", ports)).toBe("server");
    expect(classifyTunnelTarget("http://localhost:3005/", ports)).toBe("server");
    expect(classifyTunnelTarget("http://localhost:3001", ports)).toBe("other");
    expect(classifyTunnelTarget("localhost", ports)).toBe("other");
  });

  it("a tunnel pointed at the PROXY is healthy (web public) — not 'wrong'", async () => {
    mockAdminSession();
    mockConfig();
    mockRoutesWithProxy({ tunnels: [PROXY_TUNNEL], proxyUp: true });
    mockNumberFetch.mockResolvedValue({ voiceUrl: `${PUBLIC_URL}/voice/incoming`, smsUrl: `${PUBLIC_URL}/sms/incoming` });

    const { GET } = await import("../app/api/admin/phone-system/route");
    const { status } = await (await GET(makeRequest("GET"))).json();
    expect(status.tunnel).toMatchObject({ running: true, correct: true, target: "proxy" });
    expect(status.webPublic).toBe(true);
    expect(status.proxyUp).toBe(true);
    expect(status.ready).toBe(true);
  });

  it("a tunnel pointed at the SERVER is healthy too (web off) — the kill-switch is not an error", async () => {
    mockAdminSession();
    mockConfig();
    mockRoutesWithProxy({ tunnels: [RUNNING_TUNNEL], proxyUp: true }); // addr :3001 = SERVER_PORT in this file
    mockNumberFetch.mockResolvedValue({ voiceUrl: `${PUBLIC_URL}/voice/incoming`, smsUrl: `${PUBLIC_URL}/sms/incoming` });

    const { GET } = await import("../app/api/admin/phone-system/route");
    const { status } = await (await GET(makeRequest("GET"))).json();
    expect(status.tunnel).toMatchObject({ correct: true, target: "server" });
    expect(status.webPublic).toBe(false);
    expect(status.ready).toBe(true);
  });

  it("a tunnel pointed anywhere else is wrong", async () => {
    mockAdminSession();
    mockConfig();
    mockRoutesWithProxy({ tunnels: [WRONG_TUNNEL], proxyUp: false });
    mockNumberFetch.mockResolvedValue({ voiceUrl: `${PUBLIC_URL}/voice/incoming`, smsUrl: `${PUBLIC_URL}/sms/incoming` });

    const { GET } = await import("../app/api/admin/phone-system/route");
    const { status } = await (await GET(makeRequest("GET"))).json();
    expect(status.tunnel).toMatchObject({ correct: false, target: "other" });
    expect(status.ready).toBe(false);
  });

  it("Start never downgrades a proxy tunnel while Caddy is up", async () => {
    mockAdminSession();
    mockConfig();
    mockRoutesWithProxy({ tunnels: [PROXY_TUNNEL], proxyUp: true });
    mockNumberUpdate.mockResolvedValue({});

    const { POST } = await import("../app/api/admin/phone-system/route");
    const result = await (await POST(makeRequest("POST"))).json();
    expect(result.ready).toBe(true);
    const deletes = mockFetch.mock.calls.filter((c) => c[1]?.method === "DELETE");
    expect(deletes).toHaveLength(0); // reused as-is
    const tunnelStep = result.steps.find((s: { name: string }) => s.name === "ngrok tunnel");
    expect(tunnelStep.detail).toContain("proxy");
  });

  it("Start targets the proxy when Caddy is up and the agent must be spawned", async () => {
    mockAdminSession();
    mockConfig();
    let spawned = false;
    mockSpawn.mockImplementation(() => { spawned = true; return { unref: () => undefined }; });
    mockFetch.mockImplementation(async (url: string) => {
      if (url === "http://127.0.0.1:3010/health") return { ok: true, json: async () => ({}) };
      if (url.startsWith(`${NGROK_API}/api/tunnels`)) {
        if (!spawned) throw new Error("ECONNREFUSED");
        return { ok: true, json: async () => ({ tunnels: [PROXY_TUNNEL] }) };
      }
      if (url === `${PUBLIC_URL}/health`) return { ok: true, json: async () => ({}) };
      throw new Error(`Unexpected fetch: ${url}`);
    });
    mockNumberUpdate.mockResolvedValue({});

    const { POST } = await import("../app/api/admin/phone-system/route");
    await POST(makeRequest("POST"));
    expect(mockSpawn).toHaveBeenCalledWith("ngrok", expect.arrayContaining(["3010"]), expect.anything());
  }, 20000);

  it("Start falls back to the server when Caddy is down (phones never wait on the proxy)", async () => {
    mockAdminSession();
    mockConfig();
    mockRoutesWithProxy({ tunnels: [RUNNING_TUNNEL], proxyUp: false });
    mockNumberUpdate.mockResolvedValue({});

    const { POST } = await import("../app/api/admin/phone-system/route");
    const result = await (await POST(makeRequest("POST"))).json();
    expect(result.ready).toBe(true);
    const tunnelStep = result.steps.find((s: { name: string }) => s.name === "ngrok tunnel");
    expect(tunnelStep.detail).toContain("server direct");
  });

  function postAction(action: string) {
    return new NextRequest("http://localhost:3000/api/admin/phone-system", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  }

  it("web-off retargets the domain to the server via the agent API", async () => {
    mockAdminSession();
    mockConfig();
    mockRoutesWithProxy({ tunnels: [PROXY_TUNNEL], proxyUp: true });

    const { POST } = await import("../app/api/admin/phone-system/route");
    const result = await (await POST(postAction("web-off"))).json();
    expect(result.ok).toBe(true);
    const post = mockFetch.mock.calls.find((c) => c[1]?.method === "POST" && String(c[0]).endsWith("/api/tunnels"));
    expect(JSON.parse(post![1].body)).toMatchObject({ addr: "3001", domain: "example.ngrok-free.dev" });
    expect(mockNumberUpdate).not.toHaveBeenCalled(); // no webhook churn
  });

  it("web-on retargets to the proxy, but refuses when Caddy is not running", async () => {
    mockAdminSession();
    mockConfig();
    mockRoutesWithProxy({ tunnels: [RUNNING_TUNNEL], proxyUp: false });
    const { POST } = await import("../app/api/admin/phone-system/route");
    const refused = await (await POST(postAction("web-on"))).json();
    expect(refused.ok).toBe(false);
    expect(refused.steps[0].detail).toContain("Caddy proxy is not answering");

    mockRoutesWithProxy({ tunnels: [RUNNING_TUNNEL], proxyUp: true });
    const result = await (await POST(postAction("web-on"))).json();
    expect(result.ok).toBe(true);
    const post = mockFetch.mock.calls.find((c) => c[1]?.method === "POST" && String(c[0]).endsWith("/api/tunnels"));
    expect(JSON.parse(post![1].body)).toMatchObject({ addr: "3010" });
  });

  it("web-on/off is a no-op when the tunnel already points at the target", async () => {
    mockAdminSession();
    mockConfig();
    mockRoutesWithProxy({ tunnels: [PROXY_TUNNEL], proxyUp: true });
    const { POST } = await import("../app/api/admin/phone-system/route");
    const result = await (await POST(postAction("web-on"))).json();
    expect(result.ok).toBe(true);
    expect(mockFetch.mock.calls.filter((c) => c[1]?.method === "DELETE")).toHaveLength(0);
  });

  it("rejects unknown actions", async () => {
    mockAdminSession();
    const { POST } = await import("../app/api/admin/phone-system/route");
    const res = await POST(postAction("explode"));
    expect(res.status).toBe(400);
  });
});
