import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock next-auth ────────────────────────────────────────────────
const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

// ── Mock @/lib/auth ───────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  tenantAuthOptions: { providers: [] },
}));

// ── Mock @/lib/prisma ─────────────────────────────────────────────
const mockTenantFindUnique = vi.fn();
const mockTenantUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: (...args: any[]) => mockTenantFindUnique(...args),
      update: (...args: any[]) => mockTenantUpdate(...args),
    },
  },
}));

// ── Mock bcrypt ───────────────────────────────────────────────────
const mockBcryptCompare = vi.fn();
const mockBcryptHash = vi.fn();
vi.mock("bcrypt", () => {
  const obj = {
    compare: (...args: any[]) => mockBcryptCompare(...args),
    hash: (...args: any[]) => mockBcryptHash(...args),
  };
  return { default: obj, ...obj };
});

// ── Session helper ────────────────────────────────────────────────
function tenantSession(overrides: Record<string, unknown> = {}) {
  return {
    tenant: {
      id: "tenant-set-1",
      email: "settings@test.com",
      firstName: "Settings",
      lastName: "Tenant",
      userId: "landlord-1",
      ...overrides,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// GET /api/portal/settings
// ─────────────────────────────────────────────────────────────────
describe("GET /api/portal/settings — tenant profile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/settings/route");
    const res = await GET();
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns tenant profile with name, email, phone", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeTenant = {
      id: "tenant-set-1",
      firstName: "John",
      lastName: "Doe",
      email: "john@test.com",
      phone: "+13125551234",
    };
    mockTenantFindUnique.mockResolvedValue(fakeTenant);

    const { GET } = await import("../app/api/portal/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.tenant.firstName).toBe("John");
    expect(data.tenant.lastName).toBe("Doe");
    expect(data.tenant.email).toBe("john@test.com");
    expect(data.tenant.phone).toBe("+13125551234");
  });

  it("returns tenant with null phone", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeTenant = {
      id: "tenant-set-1",
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@test.com",
      phone: null,
    };
    mockTenantFindUnique.mockResolvedValue(fakeTenant);

    const { GET } = await import("../app/api/portal/settings/route");
    const res = await GET();
    const data = await res.json();

    expect(data.tenant.phone).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// PUT /api/portal/settings — update profile
// ─────────────────────────────────────────────────────────────────
describe("PUT /api/portal/settings — update tenant profile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({ firstName: "Updated" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(401);
  });

  it("updates firstName, lastName, phone", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const updatedTenant = {
      id: "tenant-set-1",
      firstName: "Updated",
      lastName: "Name",
      email: "settings@test.com",
      phone: "+19876543210",
    };
    mockTenantUpdate.mockResolvedValue(updatedTenant);

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({
        firstName: "Updated",
        lastName: "Name",
        phone: "+19876543210",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.tenant.firstName).toBe("Updated");
    expect(data.tenant.lastName).toBe("Name");
    expect(data.tenant.phone).toBe("+19876543210");
  });

  it("does NOT update email (read-only field)", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const updatedTenant = {
      id: "tenant-set-1",
      firstName: "Test",
      lastName: "User",
      email: "settings@test.com",
      phone: null,
    };
    mockTenantUpdate.mockResolvedValue(updatedTenant);

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({
        firstName: "Test",
        email: "hacker@evil.com", // should be ignored
      }),
    });

    await PUT(req);

    // The update call should NOT include email
    const updateCall = mockTenantUpdate.mock.calls[0][0];
    expect(updateCall.data.email).toBeUndefined();
  });

  it("returns 400 when no valid fields to update", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({}),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("No valid fields");
  });

  it("trims whitespace from firstName and lastName", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const updatedTenant = {
      id: "tenant-set-1",
      firstName: "Trimmed",
      lastName: "Name",
      email: "settings@test.com",
      phone: null,
    };
    mockTenantUpdate.mockResolvedValue(updatedTenant);

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({
        firstName: "  Trimmed  ",
        lastName: "  Name  ",
      }),
    });

    await PUT(req);

    const updateCall = mockTenantUpdate.mock.calls[0][0];
    expect(updateCall.data.firstName).toBe("Trimmed");
    expect(updateCall.data.lastName).toBe("Name");
  });

  it("sets phone to null when empty string provided", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const updatedTenant = {
      id: "tenant-set-1",
      firstName: "Settings",
      lastName: "Tenant",
      email: "settings@test.com",
      phone: null,
    };
    mockTenantUpdate.mockResolvedValue(updatedTenant);

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({ phone: "" }),
    });

    await PUT(req);

    const updateCall = mockTenantUpdate.mock.calls[0][0];
    expect(updateCall.data.phone).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// PUT /api/portal/settings — password change
// ─────────────────────────────────────────────────────────────────
describe("PUT /api/portal/settings — password change", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects new password shorter than 8 characters", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "OldPass123",
        newPassword: "Short1",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("at least 8 characters");
  });

  it("rejects when current password is incorrect", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    mockTenantFindUnique.mockResolvedValue({
      passwordHash: "$2b$12$fakehash",
    });
    mockBcryptCompare.mockResolvedValue(false);

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "WrongPassword",
        newPassword: "NewSecure123",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("Current password is incorrect");
  });

  it("updates password when current password is correct", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    mockTenantFindUnique.mockResolvedValueOnce({
      passwordHash: "$2b$12$oldhash",
    });
    mockBcryptCompare.mockResolvedValue(true);
    mockBcryptHash.mockResolvedValue("$2b$12$newhash");

    // Password-only update: after password change, route reads tenant again
    mockTenantUpdate.mockResolvedValue({}); // password update
    mockTenantFindUnique.mockResolvedValueOnce({
      id: "tenant-set-1",
      firstName: "Settings",
      lastName: "Tenant",
      email: "settings@test.com",
      phone: null,
    });

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "OldPass123",
        newPassword: "NewSecure456",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.message).toContain("Password updated");
  });

  it("hashes new password with bcrypt before saving", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    mockTenantFindUnique.mockResolvedValueOnce({
      passwordHash: "$2b$12$oldhash",
    });
    mockBcryptCompare.mockResolvedValue(true);
    mockBcryptHash.mockResolvedValue("$2b$12$newhashvalue");
    mockTenantUpdate.mockResolvedValue({});
    mockTenantFindUnique.mockResolvedValueOnce({
      id: "tenant-set-1",
      firstName: "S",
      lastName: "T",
      email: "s@t.com",
      phone: null,
    });

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "OldPass123",
        newPassword: "BrandNewPass",
      }),
    });

    await PUT(req);

    // bcrypt.hash should be called with newPassword and salt rounds
    expect(mockBcryptHash).toHaveBeenCalledWith("BrandNewPass", 12);

    // Update should use the hashed value
    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { passwordHash: "$2b$12$newhashvalue" },
      })
    );
  });

  it("returns 400 when passwordHash is not set on tenant", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    mockTenantFindUnique.mockResolvedValue({ passwordHash: null });

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "SomePass123",
        newPassword: "NewSecure456",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("Password not set");
  });

  it("handles combined password change + profile update", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    mockTenantFindUnique.mockResolvedValue({
      passwordHash: "$2b$12$oldhash",
    });
    mockBcryptCompare.mockResolvedValue(true);
    mockBcryptHash.mockResolvedValue("$2b$12$newhash");

    // First call: password update. Second call: profile update.
    const updatedProfile = {
      id: "tenant-set-1",
      firstName: "NewFirst",
      lastName: "NewLast",
      email: "settings@test.com",
      phone: "+15551234567",
    };
    mockTenantUpdate
      .mockResolvedValueOnce({}) // password update
      .mockResolvedValueOnce(updatedProfile); // profile update

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "OldPass123",
        newPassword: "NewSecure456",
        firstName: "NewFirst",
        lastName: "NewLast",
        phone: "+15551234567",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.tenant.firstName).toBe("NewFirst");
    expect(data.tenant.lastName).toBe("NewLast");
  });

  it("accepts password of exactly 8 characters", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    mockTenantFindUnique.mockResolvedValueOnce({
      passwordHash: "$2b$12$oldhash",
    });
    mockBcryptCompare.mockResolvedValue(true);
    mockBcryptHash.mockResolvedValue("$2b$12$newhash");
    mockTenantUpdate.mockResolvedValue({});
    mockTenantFindUnique.mockResolvedValueOnce({
      id: "tenant-set-1",
      firstName: "S",
      lastName: "T",
      email: "s@t.com",
      phone: null,
    });

    const { PUT } = await import("../app/api/portal/settings/route");
    const req = new NextRequest("http://localhost:3002/api/portal/settings", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "OldPass123",
        newPassword: "Exact8Ch", // exactly 8 characters
      }),
    });

    const res = await PUT(req);
    // Should NOT return 400 for password length
    expect(res.status).toBe(200);
  });
});
