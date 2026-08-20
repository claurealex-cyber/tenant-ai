// Set encryption key BEFORE any imports that use it
process.env.PII_ENCRYPTION_KEY =
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock prisma ─────────────────────────────────────────────────────────────
const mockPropertyFindUnique = vi.fn();
const mockApplicationFindFirst = vi.fn();
const mockApplicationCreate = vi.fn();
const mockUserFindUnique = vi.fn();
const mockInviteFindUnique = vi.fn();
const mockInviteUpdateMany = vi.fn();
const mockInviteUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    property: { findUnique: (...a: any[]) => mockPropertyFindUnique(...a) },
    application: {
      findFirst: (...a: any[]) => mockApplicationFindFirst(...a),
      create: (...a: any[]) => mockApplicationCreate(...a),
    },
    user: { findUnique: (...a: any[]) => mockUserFindUnique(...a) },
    surveyInvite: {
      findUnique: (...a: any[]) => mockInviteFindUnique(...a),
      updateMany: (...a: any[]) => mockInviteUpdateMany(...a),
      update: (...a: any[]) => mockInviteUpdate(...a),
    },
  },
}));

const mockSendEmail = vi.fn();
vi.mock("@tenant-ai/shared", async () => {
  const actual = await vi.importActual<typeof import("@tenant-ai/shared")>(
    "@tenant-ai/shared"
  );
  return { ...actual, sendEmail: (...a: any[]) => mockSendEmail(...a) };
});

const mockResolveTenantContext = vi.fn();
vi.mock("@/lib/tenant-context", () => ({
  resolveTenantContext: (...a: any[]) => mockResolveTenantContext(...a),
}));

const CTX = { userId: "ll-1", subdomain: "t", companyName: "T", primaryColor: "#000" };
const PROP = { id: "prop-1", userId: "ll-1", isActive: true, name: "P", address: "1 St" };

function req(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://t.tenantai.com/api/apply", {
    method: "POST",
    headers: { "x-tenant-host": "t.tenantai.com" },
    body: JSON.stringify(body),
  });
}
function futureDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}
function pastDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}
async function post(body: Record<string, unknown>) {
  const { POST } = await import("../app/api/apply/route");
  return POST(req(body));
}

describe("POST /api/apply — SMS survey link attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTenantContext.mockResolvedValue(CTX);
    mockPropertyFindUnique.mockResolvedValue(PROP);
    mockApplicationFindFirst.mockResolvedValue(null); // no duplicate
    mockApplicationCreate.mockImplementation(({ data }: any) => ({ id: "app-1", ...data }));
    mockUserFindUnique.mockResolvedValue({ email: "ll@test.com", name: "LL" });
    mockSendEmail.mockResolvedValue(undefined);
    mockInviteUpdateMany.mockResolvedValue({ count: 1 });
    mockInviteUpdate.mockResolvedValue({});
  });

  it("attributes a valid invite: channel sms_link, callerPhone from invite, invite consumed", async () => {
    mockInviteFindUnique.mockResolvedValue({
      id: "inv-1",
      propertyId: "prop-1",
      phone: "+13125550123",
      usedAt: null,
      expiresAt: futureDate(),
    });

    const res = await post({
      propertyId: "prop-1",
      token: "tok-valid",
      fullName: "Jane",
      email: "jane@x.com",
    });

    expect(res.status).toBe(201);
    const create = mockApplicationCreate.mock.calls[0][0];
    expect(create.data.channel).toBe("sms_link");
    expect(create.data.callerPhone).toBe("+13125550123");
    // claimed atomically (only where usedAt is null)
    expect(mockInviteUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "inv-1", usedAt: null }),
      })
    );
    // linked to the created application
    expect(mockInviteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv-1" },
        data: expect.objectContaining({ applicationId: "app-1" }),
      })
    );
  });

  it("rejects an already-used invite with 410 and creates nothing", async () => {
    mockInviteFindUnique.mockResolvedValue({
      id: "inv-2",
      propertyId: "prop-1",
      phone: "+1312",
      usedAt: new Date(),
      expiresAt: futureDate(),
    });
    const res = await post({ propertyId: "prop-1", token: "t", fullName: "J", email: "j@x.com" });
    expect(res.status).toBe(410);
    expect(mockApplicationCreate).not.toHaveBeenCalled();
  });

  it("rejects an expired invite with 410", async () => {
    mockInviteFindUnique.mockResolvedValue({
      id: "inv-3",
      propertyId: "prop-1",
      phone: "+1312",
      usedAt: null,
      expiresAt: pastDate(),
    });
    const res = await post({ propertyId: "prop-1", token: "t", fullName: "J", email: "j@x.com" });
    expect(res.status).toBe(410);
    expect(mockApplicationCreate).not.toHaveBeenCalled();
  });

  it("rejects an invite for a different property with 400", async () => {
    mockInviteFindUnique.mockResolvedValue({
      id: "inv-4",
      propertyId: "other-prop",
      phone: "+1312",
      usedAt: null,
      expiresAt: futureDate(),
    });
    const res = await post({ propertyId: "prop-1", token: "t", fullName: "J", email: "j@x.com" });
    expect(res.status).toBe(400);
    expect(mockApplicationCreate).not.toHaveBeenCalled();
  });

  it("returns 410 when the atomic claim loses a concurrent race (count 0)", async () => {
    mockInviteFindUnique.mockResolvedValue({
      id: "inv-5",
      propertyId: "prop-1",
      phone: "+1312",
      usedAt: null,
      expiresAt: futureDate(),
    });
    mockInviteUpdateMany.mockResolvedValue({ count: 0 }); // another request claimed it first
    const res = await post({ propertyId: "prop-1", token: "t", fullName: "J", email: "j@x.com" });
    expect(res.status).toBe(410);
    expect(mockApplicationCreate).not.toHaveBeenCalled();
  });

  it("normal web application (no token) is channel web and never touches invites", async () => {
    const res = await post({ propertyId: "prop-1", fullName: "Web", email: "web@x.com" });
    expect(res.status).toBe(201);
    expect(mockApplicationCreate.mock.calls[0][0].data.channel).toBe("web");
    expect(mockInviteFindUnique).not.toHaveBeenCalled();
    expect(mockInviteUpdateMany).not.toHaveBeenCalled();
  });
});
