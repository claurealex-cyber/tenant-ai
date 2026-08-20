/**
 * Workflow test: Auth (Signup, Login, Profile Update)
 *
 * Tests the full authentication workflow end-to-end using real DB operations
 * and API route handlers where possible.
 *
 * Forgot Password — already tested in forgot-password.test.ts (SKIP)
 * Change Password — already tested in change-password-api.test.ts (SKIP)
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_wf_auth_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

function makeRequest(
  url: string,
  options: { method?: string; body?: Record<string, unknown> } = {}
): NextRequest {
  const { method = "GET", body } = options;
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new NextRequest(new URL(url, "http://localhost:3000"), init as any);
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  // Clean up all test users created during this run
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Signup via API route handler ──

describe("Signup workflow", () => {
  it("creates user with valid data and returns 201", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");

    const req = makeRequest("http://localhost:3000/api/auth/signup", {
      method: "POST",
      body: {
        name: "Workflow Test User",
        email: testEmail("signup_valid"),
        password: "SecurePass123",
      },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.user).toBeDefined();
    expect(data.user.id).toBeDefined();
    expect(data.user.email).toBe(testEmail("signup_valid"));
    expect(data.user.name).toBe("Workflow Test User");
    expect(data.user.role).toBe("client");
    expect(data.user.onboarded).toBe(false);
    // Password hash should NOT be returned
    expect(data.user.passwordHash).toBeUndefined();
  });

  it("rejects duplicate email with 409", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");

    // Create the first user
    const email = testEmail("signup_dup");
    const req1 = makeRequest("http://localhost:3000/api/auth/signup", {
      method: "POST",
      body: { name: "First", email, password: "Password123" },
    });
    await POST(req1);

    // Try creating again with same email
    const req2 = makeRequest("http://localhost:3000/api/auth/signup", {
      method: "POST",
      body: { name: "Second", email, password: "Password456" },
    });
    const res = await POST(req2);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toContain("already exists");
  });

  it("rejects missing name with 400", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");

    const req = makeRequest("http://localhost:3000/api/auth/signup", {
      method: "POST",
      body: {
        email: testEmail("no_name"),
        password: "Password123",
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects missing email with 400", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");

    const req = makeRequest("http://localhost:3000/api/auth/signup", {
      method: "POST",
      body: {
        name: "No Email",
        password: "Password123",
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects missing password with 400", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");

    const req = makeRequest("http://localhost:3000/api/auth/signup", {
      method: "POST",
      body: {
        name: "No Password",
        email: testEmail("no_pw"),
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects short password (<8 chars) with 400", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");

    const req = makeRequest("http://localhost:3000/api/auth/signup", {
      method: "POST",
      body: {
        name: "Short PW",
        email: testEmail("short_pw"),
        password: "abc1234", // 7 chars
      },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("at least 8 characters");
  });

  it("normalizes email to lowercase", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");

    const req = makeRequest("http://localhost:3000/api/auth/signup", {
      method: "POST",
      body: {
        name: "Case User",
        email: TEST_PREFIX + "_UPPER_CASE@TEST.COM",
        password: "Password123",
      },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.user.email).toBe(
      (TEST_PREFIX + "_UPPER_CASE@TEST.COM").toLowerCase()
    );
  });

  it("stores hashed password (not plaintext)", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const email = testEmail("hash_check");
    const password = "PlaintextCheck123";

    const req = makeRequest("http://localhost:3000/api/auth/signup", {
      method: "POST",
      body: { name: "Hash Check", email, password },
    });

    await POST(req);

    // Verify in the database directly
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    expect(user!.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, user!.passwordHash)).toBe(true);
  });

  it("stores optional companyName", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const email = testEmail("company");

    const req = makeRequest("http://localhost:3000/api/auth/signup", {
      method: "POST",
      body: {
        name: "Company User",
        email,
        password: "Password123",
        companyName: "Acme Properties LLC",
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.companyName).toBe("Acme Properties LLC");
  });
});

// ── Login (bcrypt verification) ──

describe("Login workflow (bcrypt)", () => {
  const email = testEmail("login");
  const password = "LoginTest123!";

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        name: "Login User",
        email,
        passwordHash,
        role: "client",
        onboarded: false,
      },
    });
  });

  it("bcrypt.compare succeeds with correct password", async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    const valid = await bcrypt.compare(password, user!.passwordHash);
    expect(valid).toBe(true);
  });

  it("bcrypt.compare fails with wrong password", async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    const valid = await bcrypt.compare("WrongPassword999", user!.passwordHash);
    expect(valid).toBe(false);
  });
});

// ── Forgot Password — SKIP ──
// Already tested in apps/dashboard/src/__tests__/forgot-password.test.ts

// ── Change Password — SKIP ──
// Already tested in apps/dashboard/src/__tests__/change-password-api.test.ts

// ── Profile Update (mock-based, needs session) ──

describe("Profile update workflow", () => {
  const mockUserId = `wf_profile_${Date.now()}`;
  const mockUserEmail = testEmail("profile");
  let profileUserId: string;

  beforeAll(async () => {
    // Create a real user for profile update
    const user = await prisma.user.create({
      data: {
        name: "Original Name",
        email: mockUserEmail,
        passwordHash: await bcrypt.hash("Password123", 12),
        role: "client",
        onboarded: true,
      },
    });
    profileUserId = user.id;
  });

  it("updates name, companyName, phone successfully (via direct DB, mirroring route logic)", async () => {
    const updatedUser = await prisma.user.update({
      where: { id: profileUserId },
      data: {
        name: "Updated Name",
        companyName: "New Company",
        phone: "+15551112222",
      },
      select: {
        id: true,
        name: true,
        email: true,
        companyName: true,
        phone: true,
      },
    });

    expect(updatedUser.name).toBe("Updated Name");
    expect(updatedUser.companyName).toBe("New Company");
    expect(updatedUser.phone).toBe("+15551112222");
    expect(updatedUser.email).toBe(mockUserEmail);
  });

  it("returns 401 when not authenticated (via mock)", async () => {
    vi.resetModules();
    vi.doMock("next-auth", () => ({
      getServerSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));

    const { PUT } = await import("@/app/api/auth/profile/route");

    const req = makeRequest("http://localhost:3000/api/auth/profile", {
      method: "PUT",
      body: { name: "Should Fail" },
    });

    const res = await PUT(req);
    expect(res.status).toBe(401);
  });

  it("updates profile via route handler when authenticated (via mock)", async () => {
    vi.resetModules();
    vi.doMock("next-auth", () => ({
      getServerSession: vi.fn().mockResolvedValue({
        user: { id: profileUserId, email: mockUserEmail, role: "client" },
      }),
    }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));

    const { PUT } = await import("@/app/api/auth/profile/route");

    const req = makeRequest("http://localhost:3000/api/auth/profile", {
      method: "PUT",
      body: {
        name: "Route Updated Name",
        companyName: "Route Company",
        phone: "+15559998888",
      },
    });

    const res = await PUT(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.user.name).toBe("Route Updated Name");
    expect(data.user.companyName).toBe("Route Company");
    expect(data.user.phone).toBe("+15559998888");
  });
});
