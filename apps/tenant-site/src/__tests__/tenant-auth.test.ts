import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock prisma
const mockTenantFindFirst = vi.fn();
const mockTenantUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findFirst: (...args: any[]) => mockTenantFindFirst(...args),
      update: (...args: any[]) => mockTenantUpdate(...args),
    },
  },
}));

// Mock email
const mockSendEmail = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/email", () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
  buildPasswordResetEmail: vi.fn().mockReturnValue("<html>Reset link</html>"),
}));

describe("Tenant Forgot Password - Route Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 and saves resetToken when tenant exists", async () => {
    const fakeTenant = {
      id: "tenant-abc",
      email: "portal@test.com",
    };

    mockTenantFindFirst.mockResolvedValue(fakeTenant);
    mockTenantUpdate.mockResolvedValue({});

    const { POST } = await import(
      "../app/api/auth/forgot-password/route"
    );

    const req = new NextRequest("http://localhost:3002/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "Portal@Test.com" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.message).toContain("reset link has been sent");

    // Verify findFirst was called with normalized email
    expect(mockTenantFindFirst).toHaveBeenCalledWith({
      where: { email: "portal@test.com" },
    });

    // Verify update was called with resetToken and resetTokenExpiry
    expect(mockTenantUpdate).toHaveBeenCalledTimes(1);
    const updateCall = mockTenantUpdate.mock.calls[0][0];
    expect(updateCall.where.id).toBe("tenant-abc");
    expect(typeof updateCall.data.resetToken).toBe("string");
    expect(updateCall.data.resetToken.length).toBe(64); // 32 bytes hex
    expect(updateCall.data.resetTokenExpiry).toBeInstanceOf(Date);
  });

  it("saves resetToken and resetTokenExpiry to tenant record in DB", async () => {
    const fakeTenant = { id: "tenant-xyz", email: "user@example.com" };
    mockTenantFindFirst.mockResolvedValue(fakeTenant);
    mockTenantUpdate.mockResolvedValue({});

    const { POST } = await import(
      "../app/api/auth/forgot-password/route"
    );

    const req = new NextRequest("http://localhost:3002/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com" }),
    });

    await POST(req);

    const updateCall = mockTenantUpdate.mock.calls[0][0];
    // resetToken should be saved
    expect(updateCall.data.resetToken).toBeDefined();
    expect(updateCall.data.resetToken.length).toBeGreaterThan(0);
    // resetTokenExpiry should be saved
    expect(updateCall.data.resetTokenExpiry).toBeDefined();
    expect(updateCall.data.resetTokenExpiry).toBeInstanceOf(Date);
  });

  it("returns 200 for non-existent email (prevents enumeration)", async () => {
    mockTenantFindFirst.mockResolvedValue(null);

    const { POST } = await import(
      "../app/api/auth/forgot-password/route"
    );

    const req = new NextRequest("http://localhost:3002/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "nobody@test.com" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.message).toContain("reset link has been sent");

    // Should NOT have called update
    expect(mockTenantUpdate).not.toHaveBeenCalled();
    // Should NOT have called sendEmail
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("reset token expiry is in the future (approx 1 hour)", async () => {
    const fakeTenant = { id: "tenant-future", email: "future@test.com" };
    mockTenantFindFirst.mockResolvedValue(fakeTenant);
    mockTenantUpdate.mockResolvedValue({});

    const { POST } = await import(
      "../app/api/auth/forgot-password/route"
    );

    const beforeTime = Date.now();
    const req = new NextRequest("http://localhost:3002/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "future@test.com" }),
    });

    await POST(req);
    const afterTime = Date.now();

    const updateCall = mockTenantUpdate.mock.calls[0][0];
    const expiry = updateCall.data.resetTokenExpiry as Date;

    // Expiry should be approximately 1 hour in the future
    const oneHourMs = 60 * 60 * 1000;
    expect(expiry.getTime()).toBeGreaterThanOrEqual(beforeTime + oneHourMs - 1000);
    expect(expiry.getTime()).toBeLessThanOrEqual(afterTime + oneHourMs + 1000);

    // Definitely in the future
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns 400 when email is missing", async () => {
    const { POST } = await import(
      "../app/api/auth/forgot-password/route"
    );

    const req = new NextRequest("http://localhost:3002/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("Email");
  });

  it("normalizes email to lowercase and trims whitespace", async () => {
    mockTenantFindFirst.mockResolvedValue(null);

    const { POST } = await import(
      "../app/api/auth/forgot-password/route"
    );

    const req = new NextRequest("http://localhost:3002/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "  USER@EXAMPLE.COM  " }),
    });

    await POST(req);

    expect(mockTenantFindFirst).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
    });
  });

  it("sends a password reset email when tenant found", async () => {
    const fakeTenant = { id: "tenant-email", email: "send@test.com" };
    mockTenantFindFirst.mockResolvedValue(fakeTenant);
    mockTenantUpdate.mockResolvedValue({});

    const { POST } = await import(
      "../app/api/auth/forgot-password/route"
    );

    const req = new NextRequest("http://localhost:3002/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "send@test.com" }),
    });

    await POST(req);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "send@test.com",
        subject: "Password Reset Request",
      })
    );
  });
});
