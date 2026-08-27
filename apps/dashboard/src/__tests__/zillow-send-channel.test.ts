import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

process.env.PII_ENCRYPTION_KEY = process.env.PII_ENCRYPTION_KEY || "a".repeat(64);

const mockSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: any[]) => mockSession(...a) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const mockUpsert = vi.fn(); const mockAudit = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { systemConfig: { upsert: (...a: any[]) => mockUpsert(...a) }, auditLog: { create: (...a: any[]) => mockAudit(...a) } } }));
const mockResolve = vi.fn();
vi.mock("@tenant-ai/shared", async (o) => { const a = await o<any>(); return { ...a, resolveConfig: (...x: any[]) => mockResolve(...x) }; });

import { POST } from "../app/api/admin/zillow/send-channel/route";
const req = (b: unknown) => new NextRequest("http://x", { method: "POST", body: JSON.stringify(b) });

beforeEach(() => { vi.clearAllMocks(); mockSession.mockResolvedValue({ user: { role: "admin", id: "a1" } }); mockUpsert.mockResolvedValue({}); mockAudit.mockResolvedValue({}); });

describe("POST /api/admin/zillow/send-channel", () => {
  it("403 for non-admin", async () => { mockSession.mockResolvedValue({ user: { role: "manager" } }); expect((await POST(req({ channel: "relay" }))).status).toBe(403); });
  it("relay writes the config", async () => { const r = await POST(req({ channel: "relay" })); expect((await r.json()).channel).toBe("relay"); expect(mockUpsert).toHaveBeenCalled(); });
  it("textemall REFUSED unless survey_mode=google_form", async () => {
    mockResolve.mockResolvedValue("hosted");
    const r = await POST(req({ channel: "textemall" }));
    expect(r.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
  it("textemall allowed when survey_mode=google_form", async () => {
    mockResolve.mockResolvedValue("google_form");
    const r = await POST(req({ channel: "textemall" }));
    expect(r.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalled();
  });
});
