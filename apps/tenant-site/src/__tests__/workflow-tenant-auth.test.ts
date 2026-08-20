import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock prisma ─────────────────────────────────────────────────────────────
const mockTenantFindUnique = vi.fn();
const mockTenantFindFirst = vi.fn();
const mockTenantCreate = vi.fn();
const mockTenantUpdate = vi.fn();
const mockTenantInviteFindUnique = vi.fn();
const mockTenantInviteUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: (...args: any[]) => mockTenantFindUnique(...args),
      findFirst: (...args: any[]) => mockTenantFindFirst(...args),
      create: (...args: any[]) => mockTenantCreate(...args),
      update: (...args: any[]) => mockTenantUpdate(...args),
    },
    tenantInvite: {
      findUnique: (...args: any[]) => mockTenantInviteFindUnique(...args),
      update: (...args: any[]) => mockTenantInviteUpdate(...args),
    },
  },
}));

// ── Mock tenant-context (used by signup when no invite token) ───────────────
const mockResolveTenantContext = vi.fn();

vi.mock("@/lib/tenant-context", () => ({
  resolveTenantContext: (...args: any[]) => mockResolveTenantContext(...args),
}));

// ── Mock next/headers (used by signup route) ────────────────────────────────
const mockHeadersGet = vi.fn();

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: (...args: any[]) => mockHeadersGet(...args),
  }),
}));

// ── Mock bcrypt (to avoid slow hashing in tests) ────────────────────────────
vi.mock("bcrypt", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2b$12$hashed_password_mock"),
    compare: vi.fn().mockImplementation((plain: string, hash: string) => {
      // For reset-password test: allow any comparison to return true
      // when hash is our mock hash
      return Promise.resolve(hash === "$2b$12$hashed_password_mock");
    }),
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
const MOCK_CONTEXT = {
  userId: "landlord-auth-001",
  subdomain: "auth-test",
  companyName: "Auth Test LLC",
  primaryColor: "#000000",
};

function makeSignupRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://auth-test.tenantai.com/api/auth/signup", {
    method: "POST",
    headers: {
      "x-tenant-host": "auth-test.tenantai.com",
      host: "auth-test.tenantai.com",
    },
    body: JSON.stringify(body),
  });
}

function makeResetPasswordRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3002/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/signup
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/signup — tenant account creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: hostname-based context resolution
    mockHeadersGet.mockImplementation((key: string) => {
      if (key === "x-forwarded-host") return "auth-test.tenantai.com";
      if (key === "host") return "auth-test.tenantai.com";
      return null;
    });
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockTenantFindUnique.mockResolvedValue(null); // no existing tenant by default
  });

  it("creates tenant account with required fields and returns 201", async () => {
    mockTenantCreate.mockResolvedValue({
      id: "tenant-new-1",
      email: "newuser@example.com",
      firstName: "John",
      lastName: "Doe",
    });

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "John",
      lastName: "Doe",
      email: "NewUser@Example.com",
      password: "SecurePass123",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.tenant.id).toBe("tenant-new-1");
    expect(data.tenant.email).toBe("newuser@example.com");
    expect(data.tenant.firstName).toBe("John");
    expect(data.tenant.lastName).toBe("Doe");
  });

  it("hashes password before storing", async () => {
    mockTenantCreate.mockImplementation(({ data }: any) => ({
      id: "tenant-hash",
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
    }));

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "Hash",
      lastName: "Test",
      email: "hash@example.com",
      password: "MyPassword123",
    });

    await POST(req);

    const createCall = mockTenantCreate.mock.calls[0][0];
    // Password should be hashed, not plaintext
    expect(createCall.data.passwordHash).toBe("$2b$12$hashed_password_mock");
    expect(createCall.data.passwordHash).not.toBe("MyPassword123");
  });

  it("normalizes email to lowercase and trims whitespace", async () => {
    mockTenantCreate.mockResolvedValue({
      id: "tenant-norm",
      email: "trimmed@example.com",
      firstName: "Trim",
      lastName: "User",
    });

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "  Trim  ",
      lastName: "  User  ",
      email: "  Trimmed@EXAMPLE.COM  ",
      password: "SecurePass123",
    });

    await POST(req);

    const createCall = mockTenantCreate.mock.calls[0][0];
    expect(createCall.data.email).toBe("trimmed@example.com");
    expect(createCall.data.firstName).toBe("Trim");
    expect(createCall.data.lastName).toBe("User");
  });

  it("includes optional phone when provided", async () => {
    mockTenantCreate.mockResolvedValue({
      id: "tenant-phone",
      email: "phone@example.com",
      firstName: "Phone",
      lastName: "User",
    });

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "Phone",
      lastName: "User",
      email: "phone@example.com",
      password: "SecurePass123",
      phone: "+13125551234",
    });

    await POST(req);

    const createCall = mockTenantCreate.mock.calls[0][0];
    expect(createCall.data.phone).toBe("+13125551234");
  });

  it("sets phone to null when not provided", async () => {
    mockTenantCreate.mockResolvedValue({
      id: "tenant-nophone",
      email: "nophone@example.com",
      firstName: "No",
      lastName: "Phone",
    });

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "No",
      lastName: "Phone",
      email: "nophone@example.com",
      password: "SecurePass123",
    });

    await POST(req);

    const createCall = mockTenantCreate.mock.calls[0][0];
    expect(createCall.data.phone).toBeNull();
  });

  it("returns 400 when firstName is missing", async () => {
    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      lastName: "Doe",
      email: "missing@example.com",
      password: "SecurePass123",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("firstName");
  });

  it("returns 400 when lastName is missing", async () => {
    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "John",
      email: "missing@example.com",
      password: "SecurePass123",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("lastName");
  });

  it("returns 400 when email is missing", async () => {
    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "John",
      lastName: "Doe",
      password: "SecurePass123",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("email");
  });

  it("returns 400 when password is missing", async () => {
    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "John",
      lastName: "Doe",
      email: "nopass@example.com",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("password");
  });

  it("returns 400 when password is too short", async () => {
    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "John",
      lastName: "Doe",
      email: "short@example.com",
      password: "short",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("8 characters");
  });

  it("returns 409 for duplicate email within same landlord", async () => {
    mockTenantFindUnique.mockResolvedValue({
      id: "existing-tenant",
      email: "exists@example.com",
    });

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "Dupe",
      lastName: "User",
      email: "exists@example.com",
      password: "SecurePass123",
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already exists");
  });

  it("checks email uniqueness per landlord using compound key", async () => {
    mockTenantFindUnique.mockResolvedValue(null);
    mockTenantCreate.mockResolvedValue({
      id: "tenant-uniq",
      email: "unique@example.com",
      firstName: "Uniq",
      lastName: "Check",
    });

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "Uniq",
      lastName: "Check",
      email: "Unique@Example.com",
      password: "SecurePass123",
    });

    await POST(req);

    expect(mockTenantFindUnique).toHaveBeenCalledWith({
      where: {
        email_userId: {
          email: "unique@example.com",
          userId: "landlord-auth-001",
        },
      },
    });
  });

  it("supports invite token flow", async () => {
    const futureDate = new Date(Date.now() + 72 * 60 * 60 * 1000);
    mockTenantInviteFindUnique.mockResolvedValue({
      id: "invite-1",
      token: "valid-invite-token",
      userId: "invite-landlord-001",
      acceptedAt: null,
      expiresAt: futureDate,
    });
    mockTenantInviteUpdate.mockResolvedValue({});
    // Override: with invite token, uses the invite's userId, not the hostname
    mockTenantFindUnique.mockResolvedValue(null);
    mockTenantCreate.mockResolvedValue({
      id: "tenant-invited",
      email: "invited@example.com",
      firstName: "Invited",
      lastName: "User",
    });

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "Invited",
      lastName: "User",
      email: "invited@example.com",
      password: "SecurePass123",
      token: "valid-invite-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Should use invite's landlord userId
    const createCall = mockTenantCreate.mock.calls[0][0];
    expect(createCall.data.userId).toBe("invite-landlord-001");

    // Should mark invite as accepted
    expect(mockTenantInviteUpdate).toHaveBeenCalledWith({
      where: { token: "valid-invite-token" },
      data: { acceptedAt: expect.any(Date) },
    });

    // Should NOT call resolveTenantContext
    expect(mockResolveTenantContext).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid invite token", async () => {
    mockTenantInviteFindUnique.mockResolvedValue(null);

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "Bad",
      lastName: "Token",
      email: "badtoken@example.com",
      password: "SecurePass123",
      token: "invalid-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid invite token");
  });

  it("returns 400 for already-accepted invite token", async () => {
    mockTenantInviteFindUnique.mockResolvedValue({
      id: "invite-used",
      token: "used-token",
      userId: "landlord-x",
      acceptedAt: new Date(Date.now() - 60000), // accepted 1 minute ago
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "Used",
      lastName: "Token",
      email: "used@example.com",
      password: "SecurePass123",
      token: "used-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("already been accepted");
  });

  it("returns 400 for expired invite token", async () => {
    mockTenantInviteFindUnique.mockResolvedValue({
      id: "invite-expired",
      token: "expired-token",
      userId: "landlord-x",
      acceptedAt: null,
      expiresAt: new Date(Date.now() - 60000), // expired 1 minute ago
    });

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "Expired",
      lastName: "Token",
      email: "expired@example.com",
      password: "SecurePass123",
      token: "expired-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("expired");
  });

  it("returns 400 when no token and context cannot be resolved", async () => {
    mockResolveTenantContext.mockResolvedValue(null);

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "No",
      lastName: "Context",
      email: "nocontext@example.com",
      password: "SecurePass123",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Unable to determine property context");
  });

  it("associates tenant with the resolved landlord userId", async () => {
    mockTenantCreate.mockResolvedValue({
      id: "tenant-assoc",
      email: "assoc@example.com",
      firstName: "Assoc",
      lastName: "Test",
    });

    const { POST } = await import("../app/api/auth/signup/route");

    const req = makeSignupRequest({
      firstName: "Assoc",
      lastName: "Test",
      email: "assoc@example.com",
      password: "SecurePass123",
    });

    await POST(req);

    const createCall = mockTenantCreate.mock.calls[0][0];
    expect(createCall.data.userId).toBe("landlord-auth-001");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/reset-password
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/reset-password — password reset with token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets password with valid token and returns success message", async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    mockTenantFindFirst.mockResolvedValue({
      id: "tenant-reset-1",
      email: "reset@example.com",
      resetToken: "valid-reset-token",
      resetTokenExpiry: futureExpiry,
    });
    mockTenantUpdate.mockResolvedValue({});

    const { POST } = await import("../app/api/auth/reset-password/route");

    const req = makeResetPasswordRequest({
      token: "valid-reset-token",
      password: "NewSecure123",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.message).toContain("Password updated");
  });

  it("updates password hash and clears reset token", async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    mockTenantFindFirst.mockResolvedValue({
      id: "tenant-clear",
      email: "clear@example.com",
      resetToken: "clear-token",
      resetTokenExpiry: futureExpiry,
    });
    mockTenantUpdate.mockResolvedValue({});

    const { POST } = await import("../app/api/auth/reset-password/route");

    const req = makeResetPasswordRequest({
      token: "clear-token",
      password: "NewPassword99",
    });

    await POST(req);

    expect(mockTenantUpdate).toHaveBeenCalledWith({
      where: { id: "tenant-clear" },
      data: {
        passwordHash: "$2b$12$hashed_password_mock",
        resetToken: null,
        resetTokenExpiry: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
  });

  it("verifies token and checks expiry in the query", async () => {
    mockTenantFindFirst.mockResolvedValue(null);

    const { POST } = await import("../app/api/auth/reset-password/route");

    const req = makeResetPasswordRequest({
      token: "some-token",
      password: "NewPassword99",
    });

    await POST(req);

    // The route queries with resetToken + resetTokenExpiry > now
    expect(mockTenantFindFirst).toHaveBeenCalledWith({
      where: {
        resetToken: "some-token",
        resetTokenExpiry: { gt: expect.any(Date) },
      },
    });
  });

  it("returns 400 for expired or invalid token", async () => {
    mockTenantFindFirst.mockResolvedValue(null);

    const { POST } = await import("../app/api/auth/reset-password/route");

    const req = makeResetPasswordRequest({
      token: "expired-or-invalid-token",
      password: "NewPassword99",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid or expired reset token");
  });

  it("returns 400 when token is missing", async () => {
    const { POST } = await import("../app/api/auth/reset-password/route");

    const req = makeResetPasswordRequest({
      password: "NewPassword99",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Token and password are required");
  });

  it("returns 400 when password is missing", async () => {
    const { POST } = await import("../app/api/auth/reset-password/route");

    const req = makeResetPasswordRequest({
      token: "some-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Token and password are required");
  });

  it("returns 400 when new password is too short", async () => {
    const { POST } = await import("../app/api/auth/reset-password/route");

    const req = makeResetPasswordRequest({
      token: "some-token",
      password: "short",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("8 characters");
  });

  it("resets failedLoginAttempts and lockedUntil on successful reset", async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    mockTenantFindFirst.mockResolvedValue({
      id: "tenant-lockout",
      email: "lockout@example.com",
      resetToken: "lockout-token",
      resetTokenExpiry: futureExpiry,
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
    });
    mockTenantUpdate.mockResolvedValue({});

    const { POST } = await import("../app/api/auth/reset-password/route");

    const req = makeResetPasswordRequest({
      token: "lockout-token",
      password: "UnlockMe123",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const updateCall = mockTenantUpdate.mock.calls[0][0];
    expect(updateCall.data.failedLoginAttempts).toBe(0);
    expect(updateCall.data.lockedUntil).toBeNull();
  });
});
