import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// PII_ENCRYPTION_KEY must be set before any encrypt/decrypt calls
const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.PII_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

// ── Mocks ──

const mockGetServerSession = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

const mockFindMany = vi.fn();
const mockDeleteMany = vi.fn();
const mockUpsert = vi.fn();
const mockAuditLogCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemConfig: {
      findMany: (...args: any[]) => mockFindMany(...args),
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
      upsert: (...args: any[]) => mockUpsert(...args),
    },
    auditLog: {
      create: (...args: any[]) => mockAuditLogCreate(...args),
    },
  },
}));

// Mock resolveConfig / resolveIntegration for test-connection routes
const mockResolveConfig = vi.fn();
const mockResolveIntegration = vi.fn();
const mockClearConfigCache = vi.fn();

// Mock S3 send for the S3 test route (createStorageClient returns a client with .send())
const mockS3Send = vi.fn();
const mockCreateStorageClient = vi.fn().mockReturnValue({ send: mockS3Send });

vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return {
    ...actual,
    resolveConfig: (...args: any[]) => mockResolveConfig(...args),
    resolveIntegration: (...args: any[]) => mockResolveIntegration(...args),
    clearConfigCache: (...args: any[]) => mockClearConfigCache(...args),
    createStorageClient: (...args: any[]) => mockCreateStorageClient(...args),
  };
});

// Mock global fetch for test-connection routes
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock @aws-sdk/client-s3 HeadBucketCommand (used directly by S3 test route)
vi.mock("@aws-sdk/client-s3", () => ({
  HeadBucketCommand: class HeadBucketCommand {
    Bucket: string;
    constructor(args: any) {
      this.Bucket = args.Bucket;
    }
  },
}));

// ── Helpers ──

function mockAdminSession() {
  mockGetServerSession.mockResolvedValue({
    user: { id: "admin-1", role: "admin", email: "admin@test.com" },
  });
}

function mockClientSession() {
  mockGetServerSession.mockResolvedValue({
    user: { id: "client-1", role: "client", email: "client@test.com" },
  });
}

function mockNoSession() {
  mockGetServerSession.mockResolvedValue(null);
}

// ── Tests ──

describe("Admin Integrations API - GET /api/admin/integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockDeleteMany.mockResolvedValue({ count: 0 });
    mockUpsert.mockResolvedValue({});
    mockAuditLogCreate.mockResolvedValue({});
  });

  afterEach(() => {
    // Clean up env vars that tests may have set
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.S3_BUCKET;
    delete process.env.AI_VALIDATION_API_KEY;
    delete process.env.AI_VALIDATION_MODEL;
  });

  it("returns all integrations with field statuses when no DB values exist and no env vars", async () => {
    mockAdminSession();
    mockFindMany.mockResolvedValue([]);

    const { GET } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.integrations).toBeDefined();
    expect(Array.isArray(data.integrations)).toBe(true);

    // Should have all integrations from registry
    const ids = data.integrations.map((i: any) => i.id);
    expect(ids).toContain("twilio");
    expect(ids).toContain("openai");
    expect(ids).toContain("stripe");
    expect(ids).toContain("sendgrid");
    expect(ids).toContain("s3");
    expect(ids).toContain("plaid");
    expect(ids).toContain("ai_validation");

    // All fields should have source "none" and hasValue false when nothing is set
    const twilio = data.integrations.find((i: any) => i.id === "twilio");
    expect(twilio).toBeDefined();
    for (const field of twilio.fields) {
      expect(field.hasValue).toBe(false);
      expect(field.source).toBe("none");
    }
  });

  it("returns source 'environment' when env vars are set but no DB values", async () => {
    mockAdminSession();
    mockFindMany.mockResolvedValue([]);
    process.env.TWILIO_ACCOUNT_SID = "ACtest123";

    const { GET } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations");
    const res = await GET(req);
    const data = await res.json();

    const twilio = data.integrations.find((i: any) => i.id === "twilio");
    const sidField = twilio.fields.find((f: any) => f.key === "account_sid");
    expect(sidField.hasValue).toBe(true);
    expect(sidField.source).toBe("environment");
    expect(sidField.updatedAt).toBeNull();

    // Auth token should still be "none" since we didn't set it
    const tokenField = twilio.fields.find((f: any) => f.key === "auth_token");
    expect(tokenField.hasValue).toBe(false);
    expect(tokenField.source).toBe("none");
  });

  it("returns source 'database' when DB values exist (overrides env)", async () => {
    mockAdminSession();
    const updatedAt = new Date("2025-06-01T12:00:00Z");
    mockFindMany.mockResolvedValue([
      { key: "twilio.account_sid", value: "encrypted-value", updatedAt },
    ]);
    process.env.TWILIO_ACCOUNT_SID = "ACfromenv";

    const { GET } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations");
    const res = await GET(req);
    const data = await res.json();

    const twilio = data.integrations.find((i: any) => i.id === "twilio");
    const sidField = twilio.fields.find((f: any) => f.key === "account_sid");
    expect(sidField.hasValue).toBe(true);
    expect(sidField.source).toBe("database");
    expect(sidField.updatedAt).toBe(updatedAt.toISOString());
  });

  it("includes correct metadata on each field", async () => {
    mockAdminSession();
    mockFindMany.mockResolvedValue([]);

    const { GET } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations");
    const res = await GET(req);
    const data = await res.json();

    const openai = data.integrations.find((i: any) => i.id === "openai");
    const apiKeyField = openai.fields.find((f: any) => f.key === "api_key");
    expect(apiKeyField.label).toBe("API Key");
    expect(apiKeyField.sensitive).toBe(true);
    expect(apiKeyField.required).toBe(true);
    expect(apiKeyField.placeholder).toBe("sk-...");

    // Verify integration-level metadata
    expect(openai.name).toBe("OpenAI");
    expect(openai.category).toBe("ai");
    expect(openai.testEndpoint).toBe("/api/admin/integrations/openai/test");
  });

  it("never returns actual key values in GET response", async () => {
    mockAdminSession();
    const { encrypt } = await import("@tenant-ai/shared");
    mockFindMany.mockResolvedValue([
      { key: "openai.api_key", value: "v1:encrypted-blob", updatedAt: new Date() },
      { key: "twilio.auth_token", value: "v1:encrypted-blob2", updatedAt: new Date() },
    ]);
    process.env.STRIPE_SECRET_KEY = "sk_live_realkey";

    const { GET } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations");
    const res = await GET(req);
    const data = await res.json();

    // Stringify the entire response to check no secrets leak
    const responseStr = JSON.stringify(data);
    expect(responseStr).not.toContain("sk_live_realkey");
    expect(responseStr).not.toContain("v1:encrypted-blob");

    // Fields should only have hasValue/source, not actual values
    for (const integration of data.integrations) {
      for (const field of integration.fields) {
        expect(field).not.toHaveProperty("value");
        expect(field).toHaveProperty("hasValue");
        expect(field).toHaveProperty("source");
      }
    }
  });

  it("returns Plaid with testEndpoint and correct description", async () => {
    mockAdminSession();
    mockFindMany.mockResolvedValue([]);

    const { GET } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations");
    const res = await GET(req);
    const data = await res.json();

    const plaid = data.integrations.find((i: any) => i.id === "plaid");
    expect(plaid.testEndpoint).toBe("/api/admin/integrations/plaid/test");
    expect(plaid.description).not.toContain("coming soon");
    expect(plaid.description).toContain("ACH");
  });
});

describe("Admin Integrations API - PUT /api/admin/integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockDeleteMany.mockResolvedValue({ count: 0 });
    mockUpsert.mockResolvedValue({});
    mockAuditLogCreate.mockResolvedValue({});
  });

  it("encrypts and stores a value via upsert", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify({
        integrationId: "openai",
        values: { api_key: "sk-newkey-123" },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.fieldsUpdated).toBe(1);

    // Verify upsert was called with encrypted value
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const upsertArgs = mockUpsert.mock.calls[0][0];
    expect(upsertArgs.where.key).toBe("openai.api_key");
    expect(upsertArgs.create.key).toBe("openai.api_key");
    expect(upsertArgs.create.updatedBy).toBe("admin-1");
    expect(upsertArgs.update.updatedBy).toBe("admin-1");

    // The stored value should be an encrypted string (starts with "v1:")
    const encryptedValue = upsertArgs.create.value;
    expect(encryptedValue).toMatch(/^v1:/);

    // Decrypt and verify it matches the original
    const { decrypt } = await import("@tenant-ai/shared");
    const decrypted = decrypt(encryptedValue);
    expect(decrypted).toBe("sk-newkey-123");
  });

  it("stores multiple fields in a single PUT", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify({
        integrationId: "twilio",
        values: {
          account_sid: "ACnewsid",
          auth_token: "newtoken123",
        },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.fieldsUpdated).toBe(2);
    expect(mockUpsert).toHaveBeenCalledTimes(2);

    // Check first upsert (account_sid)
    const call1 = mockUpsert.mock.calls[0][0];
    expect(call1.where.key).toBe("twilio.account_sid");

    // Check second upsert (auth_token)
    const call2 = mockUpsert.mock.calls[1][0];
    expect(call2.where.key).toBe("twilio.auth_token");
  });

  it("deletes DB entry when value is null (reverts to env fallback)", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify({
        integrationId: "openai",
        values: { api_key: null },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.fieldsUpdated).toBe(1);

    // Should have called deleteMany, not upsert
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { key: "openai.api_key" },
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("deletes DB entry when value is empty string", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify({
        integrationId: "stripe",
        values: { secret_key: "" },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { key: "stripe.secret_key" },
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("creates an audit log entry on successful update", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify({
        integrationId: "sendgrid",
        values: { api_key: "SG.newkey", from_email: "noreply@test.com" },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
    const auditArgs = mockAuditLogCreate.mock.calls[0][0];
    expect(auditArgs.data.userId).toBe("admin-1");
    expect(auditArgs.data.action).toBe("integration_config_update");
    expect(auditArgs.data.resourceType).toBe("system_config");
    expect(auditArgs.data.resourceId).toBe("sendgrid");
    expect(auditArgs.data.metadata.fields).toEqual(["api_key", "from_email"]);
  });

  it("clears config cache after successful update", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify({
        integrationId: "openai",
        values: { api_key: "sk-test" },
      }),
    });

    await PUT(req);

    expect(mockClearConfigCache).toHaveBeenCalledTimes(1);
  });

  it("ignores unknown field keys (not in the integration registry)", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify({
        integrationId: "openai",
        values: {
          api_key: "sk-valid",
          unknown_field: "should-be-ignored",
        },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    // Only api_key should count as updated
    expect(data.fieldsUpdated).toBe(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when integrationId is missing", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify({
        values: { api_key: "sk-test" },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("required");
  });

  it("returns 400 when values is missing", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify({
        integrationId: "openai",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("required");
  });

  it("returns 400 for unknown integrationId", async () => {
    mockAdminSession();

    const { PUT } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify({
        integrationId: "nonexistent_service",
        values: { key: "value" },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("Unknown integration");
  });
});

describe("Admin Integrations API - Access Control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
  });

  it("returns 403 for non-admin user on GET", async () => {
    mockClientSession();

    const { GET } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations");
    const res = await GET(req);
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toBe("Forbidden");
  });

  it("returns 403 for non-admin user on PUT", async () => {
    mockClientSession();

    const { PUT } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify({
        integrationId: "openai",
        values: { api_key: "sk-stolen" },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toBe("Forbidden");

    // Ensure no DB writes occurred
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("returns 403 when no session exists on GET", async () => {
    mockNoSession();

    const { GET } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when no session exists on PUT", async () => {
    mockNoSession();

    const { PUT } = await import("../app/api/admin/integrations/route");

    const req = new NextRequest("http://localhost/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify({
        integrationId: "openai",
        values: { api_key: "sk-test" },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(403);
  });
});

// ── Test Connection Routes ──

describe("Twilio Test Connection - POST /api/admin/integrations/twilio/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("returns 403 for non-admin user", async () => {
    mockClientSession();

    const { POST } = await import(
      "../app/api/admin/integrations/twilio/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/twilio/test",
      { method: "POST" }
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns connected: false when credentials are missing", async () => {
    mockAdminSession();
    mockResolveIntegration.mockResolvedValue({
      account_sid: null,
      auth_token: null,
      public_url: null,
    });

    const { POST } = await import(
      "../app/api/admin/integrations/twilio/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/twilio/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("required");
  });

  it("returns connected: true when Twilio API responds OK", async () => {
    mockAdminSession();
    mockResolveIntegration.mockResolvedValue({
      account_sid: "AC123",
      auth_token: "token456",
      public_url: "https://example.com",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ friendly_name: "My Twilio Account" }),
    });

    const { POST } = await import(
      "../app/api/admin/integrations/twilio/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/twilio/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(true);
    expect(data.message).toContain("My Twilio Account");

    // Verify correct Twilio API URL was called
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.twilio.com/2010-04-01/Accounts/AC123.json",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("Basic"),
        }),
      })
    );
  });

  it("returns connected: false when Twilio API returns error", async () => {
    mockAdminSession();
    mockResolveIntegration.mockResolvedValue({
      account_sid: "ACbad",
      auth_token: "badtoken",
      public_url: null,
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });

    const { POST } = await import(
      "../app/api/admin/integrations/twilio/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/twilio/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("401");
  });

  it("returns connected: false when fetch throws", async () => {
    mockAdminSession();
    mockResolveIntegration.mockResolvedValue({
      account_sid: "AC123",
      auth_token: "token",
      public_url: null,
    });
    mockFetch.mockRejectedValue(new Error("Network error"));

    const { POST } = await import(
      "../app/api/admin/integrations/twilio/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/twilio/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("Network error");
  });
});

describe("OpenAI Test Connection - POST /api/admin/integrations/openai/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("returns 403 for non-admin user", async () => {
    mockClientSession();

    const { POST } = await import(
      "../app/api/admin/integrations/openai/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/openai/test",
      { method: "POST" }
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns connected: false when API key is missing", async () => {
    mockAdminSession();
    mockResolveConfig.mockResolvedValue(null);

    const { POST } = await import(
      "../app/api/admin/integrations/openai/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/openai/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("required");
  });

  it("returns connected: true when OpenAI API responds OK", async () => {
    mockAdminSession();
    mockResolveConfig.mockResolvedValue("sk-test-key");
    mockFetch.mockResolvedValue({ ok: true });

    const { POST } = await import(
      "../app/api/admin/integrations/openai/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/openai/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(true);
    expect(data.message).toContain("Connected to OpenAI");
  });

  it("returns connected: false when OpenAI API returns error", async () => {
    mockAdminSession();
    mockResolveConfig.mockResolvedValue("sk-bad-key");
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const { POST } = await import(
      "../app/api/admin/integrations/openai/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/openai/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("401");
  });
});

describe("Stripe Test Connection - POST /api/admin/integrations/stripe/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("returns 403 for non-admin user", async () => {
    mockClientSession();

    const { POST } = await import(
      "../app/api/admin/integrations/stripe/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/stripe/test",
      { method: "POST" }
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns connected: false when secret key is missing", async () => {
    mockAdminSession();
    mockResolveConfig.mockResolvedValue(null);

    const { POST } = await import(
      "../app/api/admin/integrations/stripe/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/stripe/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("required");
  });

  it("returns connected: true when Stripe API responds OK", async () => {
    mockAdminSession();
    mockResolveConfig.mockResolvedValue("sk_test_123");
    mockFetch.mockResolvedValue({ ok: true });

    const { POST } = await import(
      "../app/api/admin/integrations/stripe/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/stripe/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(true);
    expect(data.message).toContain("Connected to Stripe");
  });

  it("returns connected: false when Stripe API returns error", async () => {
    mockAdminSession();
    mockResolveConfig.mockResolvedValue("sk_test_bad");
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    const { POST } = await import(
      "../app/api/admin/integrations/stripe/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/stripe/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("403");
  });
});

describe("SendGrid Test Connection - POST /api/admin/integrations/sendgrid/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("returns 403 for non-admin user", async () => {
    mockClientSession();

    const { POST } = await import(
      "../app/api/admin/integrations/sendgrid/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/sendgrid/test",
      { method: "POST" }
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns connected: false when API key is missing", async () => {
    mockAdminSession();
    mockResolveConfig.mockResolvedValue(null);

    const { POST } = await import(
      "../app/api/admin/integrations/sendgrid/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/sendgrid/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("required");
  });

  it("returns connected: true when SendGrid API responds OK", async () => {
    mockAdminSession();
    mockResolveConfig.mockResolvedValue("SG.testkey");
    mockFetch.mockResolvedValue({ ok: true });

    const { POST } = await import(
      "../app/api/admin/integrations/sendgrid/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/sendgrid/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(true);
    expect(data.message).toContain("Connected to SendGrid");
  });

  it("returns connected: false when SendGrid API returns error", async () => {
    mockAdminSession();
    mockResolveConfig.mockResolvedValue("SG.badkey");
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const { POST } = await import(
      "../app/api/admin/integrations/sendgrid/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/sendgrid/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("401");
  });
});

describe("S3 Test Connection - POST /api/admin/integrations/s3/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockS3Send.mockReset();
  });

  it("returns 403 for non-admin user", async () => {
    mockClientSession();

    const { POST } = await import(
      "../app/api/admin/integrations/s3/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/s3/test",
      { method: "POST" }
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns connected: false when required credentials are missing", async () => {
    mockAdminSession();
    mockResolveIntegration.mockResolvedValue({
      bucket: null,
      region: "us-east-1",
      endpoint: null,
      access_key_id: null,
      secret_access_key: null,
    });

    const { POST } = await import(
      "../app/api/admin/integrations/s3/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/s3/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("required");
  });

  it("returns connected: true when S3 HeadBucket succeeds", async () => {
    mockAdminSession();
    mockResolveIntegration.mockResolvedValue({
      bucket: "my-bucket",
      region: "us-east-1",
      endpoint: null,
      access_key_id: "AKIATEST",
      secret_access_key: "secrettest",
    });
    mockS3Send.mockResolvedValue({});

    const { POST } = await import(
      "../app/api/admin/integrations/s3/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/s3/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(true);
    expect(data.message).toContain("my-bucket");
  });

  it("returns connected: false when S3 HeadBucket throws", async () => {
    mockAdminSession();
    mockResolveIntegration.mockResolvedValue({
      bucket: "bad-bucket",
      region: "us-east-1",
      endpoint: null,
      access_key_id: "AKIATEST",
      secret_access_key: "secrettest",
    });
    mockS3Send.mockRejectedValue(new Error("Bucket not found"));

    const { POST } = await import(
      "../app/api/admin/integrations/s3/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/s3/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("Bucket not found");
  });
});

describe("Plaid Test Connection - POST /api/admin/integrations/plaid/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("returns 403 for non-admin user", async () => {
    mockClientSession();

    const { POST } = await import(
      "../app/api/admin/integrations/plaid/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/plaid/test",
      { method: "POST" }
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns connected: false when credentials are missing", async () => {
    mockAdminSession();
    mockResolveConfig.mockResolvedValue(null);

    const { POST } = await import(
      "../app/api/admin/integrations/plaid/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/plaid/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("required");
  });

  it("returns connected: true when Plaid API responds OK", async () => {
    mockAdminSession();
    mockResolveConfig.mockImplementation(async (_id: string, key: string) => {
      if (key === "client_id") return "test_client_id";
      if (key === "secret") return "test_secret";
      if (key === "env") return "sandbox";
      return null;
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ institutions: [] }),
    });

    const { POST } = await import(
      "../app/api/admin/integrations/plaid/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/plaid/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(true);
    expect(data.message).toContain("Connected to Plaid");
    expect(data.message).toContain("sandbox");
  });

  it("returns connected: false when Plaid API returns error", async () => {
    mockAdminSession();
    mockResolveConfig.mockImplementation(async (_id: string, key: string) => {
      if (key === "client_id") return "bad_id";
      if (key === "secret") return "bad_secret";
      if (key === "env") return "sandbox";
      return null;
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error_message: "INVALID_API_KEYS" }),
    });

    const { POST } = await import(
      "../app/api/admin/integrations/plaid/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/plaid/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("INVALID_API_KEYS");
  });

  it("returns connected: false on network failure", async () => {
    mockAdminSession();
    mockResolveConfig.mockImplementation(async (_id: string, key: string) => {
      if (key === "client_id") return "test_client_id";
      if (key === "secret") return "test_secret";
      if (key === "env") return "sandbox";
      return null;
    });
    mockFetch.mockRejectedValue(new Error("Network unreachable"));

    const { POST } = await import(
      "../app/api/admin/integrations/plaid/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/plaid/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("Network unreachable");
  });
});

describe("AI Validation Test Connection - POST /api/admin/integrations/ai-validation/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("returns 403 for non-admin user", async () => {
    mockClientSession();

    const { POST } = await import(
      "../app/api/admin/integrations/ai-validation/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/ai-validation/test",
      { method: "POST" }
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns connected with AI Validation source when dedicated key is configured", async () => {
    mockAdminSession();
    mockResolveConfig.mockImplementation(async (ns: string, key: string) => {
      if (ns === "ai_validation" && key === "api_key") return "sk-val-key";
      return null;
    });
    mockFetch.mockResolvedValue({ ok: true });

    const { POST } = await import(
      "../app/api/admin/integrations/ai-validation/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/ai-validation/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(true);
    expect(data.message).toContain("AI Validation");
    expect(data.message).not.toContain("fallback");
  });

  it("returns connected with OpenAI fallback when only OpenAI key configured", async () => {
    mockAdminSession();
    mockResolveConfig.mockImplementation(async (ns: string, key: string) => {
      if (ns === "ai_validation") return null;
      if (ns === "openai" && key === "api_key") return "sk-openai-key";
      return null;
    });
    mockFetch.mockResolvedValue({ ok: true });

    const { POST } = await import(
      "../app/api/admin/integrations/ai-validation/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/ai-validation/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(true);
    expect(data.message).toContain("OpenAI (fallback)");
  });

  it("returns connected: false when neither key is configured", async () => {
    mockAdminSession();
    mockResolveConfig.mockResolvedValue(null);

    const { POST } = await import(
      "../app/api/admin/integrations/ai-validation/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/ai-validation/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("No API key configured");
  });

  it("returns connected: false when API returns error", async () => {
    mockAdminSession();
    mockResolveConfig.mockImplementation(async (ns: string, key: string) => {
      if (ns === "ai_validation" && key === "api_key") return "sk-bad-key";
      return null;
    });
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const { POST } = await import(
      "../app/api/admin/integrations/ai-validation/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/ai-validation/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("401");
  });
});

describe("Telnyx Test Connection - POST /api/admin/integrations/telnyx/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("returns 403 for non-admin user", async () => {
    mockClientSession();

    const { POST } = await import(
      "../app/api/admin/integrations/telnyx/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/telnyx/test",
      { method: "POST" }
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns connected: false when API key is missing", async () => {
    mockAdminSession();
    mockResolveIntegration.mockResolvedValue({
      api_key: null,
      account_sid: null,
      public_key: null,
    });

    const { POST } = await import(
      "../app/api/admin/integrations/telnyx/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/telnyx/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("required");
  });

  it("returns connected: true when Telnyx API responds OK", async () => {
    mockAdminSession();
    mockResolveIntegration.mockResolvedValue({
      api_key: "KEYtest123",
      account_sid: "acct_123",
      public_key: "pubkey",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], meta: { total_results: 2 } }),
    });

    const { POST } = await import(
      "../app/api/admin/integrations/telnyx/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/telnyx/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(true);
    expect(data.message).toContain("Connected to Telnyx");
    expect(data.message).toContain("2 messaging profiles");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.telnyx.com/v2/messaging_profiles?page[size]=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer KEYtest123",
        }),
      })
    );
  });

  it("returns connected: false when Telnyx API returns error", async () => {
    mockAdminSession();
    mockResolveIntegration.mockResolvedValue({
      api_key: "KEYbad",
      account_sid: null,
      public_key: null,
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });

    const { POST } = await import(
      "../app/api/admin/integrations/telnyx/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/telnyx/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("401");
  });

  it("returns connected: false when fetch throws", async () => {
    mockAdminSession();
    mockResolveIntegration.mockResolvedValue({
      api_key: "KEYtest",
      account_sid: null,
      public_key: null,
    });
    mockFetch.mockRejectedValue(new Error("Network error"));

    const { POST } = await import(
      "../app/api/admin/integrations/telnyx/test/route"
    );

    const req = new NextRequest(
      "http://localhost/api/admin/integrations/telnyx/test",
      { method: "POST" }
    );
    const res = await POST(req);
    const data = await res.json();

    expect(data.connected).toBe(false);
    expect(data.message).toContain("Network error");
  });
});
