import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.PII_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: any[]) => mockGetServerSession(...a) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockUpsert = vi.fn();
const mockAudit = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemConfig: {
      findUnique: (...a: any[]) => mockFindUnique(...a),
      findMany: (...a: any[]) => mockFindMany(...a),
      upsert: (...a: any[]) => mockUpsert(...a),
    },
    auditLog: { create: (...a: any[]) => mockAudit(...a) },
  },
}));

const mockClearCache = vi.fn();
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return { ...actual, clearConfigCache: (...a: any[]) => mockClearCache(...a) };
});

import { POST as reveal } from "../app/api/admin/integrations/reveal/route";
import { POST as exportCfg } from "../app/api/admin/integrations/export/route";
import { POST as importCfg } from "../app/api/admin/integrations/import/route";
import { encrypt, configDbKey } from "@tenant-ai/shared";

const admin = { user: { id: "u1", role: "admin" } };
const nonAdmin = { user: { id: "u2", role: "manager" } };
const req = (body: any) => new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

// Pick a real registry field to exercise (twilio auth token is sensitive).
const INTEG = "twilio";
const FIELD = "auth_token"; // must exist in INTEGRATION_REGISTRY

beforeEach(() => {
  mockGetServerSession.mockReset();
  mockFindUnique.mockReset();
  mockFindMany.mockReset().mockResolvedValue([]);
  mockUpsert.mockReset().mockResolvedValue({});
  mockAudit.mockReset().mockResolvedValue({});
  mockClearCache.mockReset();
  delete process.env.TWILIO_AUTH_TOKEN;
});

describe("reveal", () => {
  it("403 for non-admin", async () => {
    mockGetServerSession.mockResolvedValue(nonAdmin);
    const res = await reveal(req({ integrationId: INTEG, fieldKey: FIELD }));
    expect(res.status).toBe(403);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("decrypts the stored DB value + audits + no-store", async () => {
    mockGetServerSession.mockResolvedValue(admin);
    mockFindUnique.mockResolvedValue({ value: encrypt("super-secret-token") });
    const res = await reveal(req({ integrationId: INTEG, fieldKey: FIELD }));
    const body = await res.json();
    expect(body).toEqual({ value: "super-secret-token", source: "database" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "integration_secret_revealed" }),
    }));
  });

  it("falls back to the env value when no DB row", async () => {
    mockGetServerSession.mockResolvedValue(admin);
    mockFindUnique.mockResolvedValue(null);
    process.env.TWILIO_AUTH_TOKEN = "env-token";
    const res = await reveal(req({ integrationId: INTEG, fieldKey: FIELD }));
    expect(await res.json()).toEqual({ value: "env-token", source: "environment" });
  });

  it("400 for unknown field", async () => {
    mockGetServerSession.mockResolvedValue(admin);
    const res = await reveal(req({ integrationId: INTEG, fieldKey: "nope" }));
    expect(res.status).toBe(400);
  });
});

describe("export", () => {
  it("403 for non-admin", async () => {
    mockGetServerSession.mockResolvedValue(nonAdmin);
    const res = await exportCfg();
    expect(res.status).toBe(403);
  });

  it("exports decrypted DB values + env values as plain JSON + audits", async () => {
    mockGetServerSession.mockResolvedValue(admin);
    mockFindMany.mockResolvedValue([{ key: configDbKey(INTEG, FIELD), value: encrypt("tok-db") }]);
    process.env.PUBLIC_URL = "https://example.test"; // twilio.publicUrl envVar
    const res = await exportCfg();
    const body = await res.json();
    expect(body.values[`${INTEG}.${FIELD}`]).toBe("tok-db");
    expect(res.headers.get("content-disposition")).toContain("tenant-ai-integrations-export.json");
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "integration_config_exported" }),
    }));
    delete process.env.PUBLIC_URL;
  });
});

describe("import", () => {
  it("403 for non-admin", async () => {
    mockGetServerSession.mockResolvedValue(nonAdmin);
    const res = await importCfg(req({ values: {} }));
    expect(res.status).toBe(403);
  });

  it("400 when 'values' missing", async () => {
    mockGetServerSession.mockResolvedValue(admin);
    const res = await importCfg(req({ nope: 1 }));
    expect(res.status).toBe(400);
  });

  it("upserts valid keys (encrypted), skips unknown, audits + clears cache", async () => {
    mockGetServerSession.mockResolvedValue(admin);
    const res = await importCfg(req({ values: { [`${INTEG}.${FIELD}`]: "brought-over", "bogus.key": "x", "twilio.authToken2": "" } }));
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(2);
    // upsert called with the right dbKey and an ENCRYPTED value (not plaintext)
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.key).toBe(configDbKey(INTEG, FIELD));
    expect(call.create.value).not.toBe("brought-over");
    expect(mockClearCache).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "integration_config_imported" }),
    }));
  });
});
