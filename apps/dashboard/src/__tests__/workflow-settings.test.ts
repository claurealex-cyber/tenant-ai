import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock session ──

const mockSessionUser = {
  id: "user-settings-1",
  role: "client",
  email: "settings@test.com",
};

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: mockSessionUser,
  }),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

// ── Mock Prisma ──

const mockUserUpdate = vi.fn();
const mockUserFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      update: (...args: any[]) => mockUserUpdate(...args),
    },
  },
}));

// ── Mock Stripe Connect ──

const mockCreateConnectAccount = vi.fn();
const mockCreateAccountLink = vi.fn();
const mockIsAccountOnboarded = vi.fn();

vi.mock("@/lib/stripe-connect", () => ({
  createConnectAccount: (...args: any[]) => mockCreateConnectAccount(...args),
  createAccountLink: (...args: any[]) => mockCreateAccountLink(...args),
  isAccountOnboarded: (...args: any[]) => mockIsAccountOnboarded(...args),
}));

// ── PUT /api/auth/profile ──

describe("PUT /api/auth/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserUpdate.mockImplementation(async (args: any) => ({
      id: args.where.id,
      name: args.data.name,
      email: "settings@test.com",
      companyName: args.data.companyName,
      phone: args.data.phone,
    }));
  });

  it("updates user name, companyName, and phone", async () => {
    const { PUT } = await import("../app/api/auth/profile/route");

    const req = new NextRequest("http://localhost/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({
        name: "Updated Name",
        companyName: "Acme Properties",
        phone: "+15551234567",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.user.name).toBe("Updated Name");
    expect(data.user.companyName).toBe("Acme Properties");
    expect(data.user.phone).toBe("+15551234567");

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-settings-1" },
        data: expect.objectContaining({
          name: "Updated Name",
          companyName: "Acme Properties",
          phone: "+15551234567",
        }),
      })
    );
  });

  it("trims whitespace from name", async () => {
    const { PUT } = await import("../app/api/auth/profile/route");

    const req = new NextRequest("http://localhost/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({
        name: "  Trimmed Name  ",
        companyName: "  Trimmed Co  ",
        phone: "  +15551234567  ",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const updateArgs = mockUserUpdate.mock.calls[0][0];
    expect(updateArgs.data.name).toBe("Trimmed Name");
    expect(updateArgs.data.companyName).toBe("Trimmed Co");
    expect(updateArgs.data.phone).toBe("+15551234567");
  });

  it("returns 400 when name is empty", async () => {
    const { PUT } = await import("../app/api/auth/profile/route");

    const req = new NextRequest("http://localhost/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({
        name: "",
        companyName: "Test",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("required");
  });

  it("returns 400 when name is only whitespace", async () => {
    const { PUT } = await import("../app/api/auth/profile/route");

    const req = new NextRequest("http://localhost/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({
        name: "   ",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { PUT } = await import("../app/api/auth/profile/route");

    const req = new NextRequest("http://localhost/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({ name: "Test" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(401);
  });

  it("sets companyName to null when empty string provided", async () => {
    const { PUT } = await import("../app/api/auth/profile/route");

    const req = new NextRequest("http://localhost/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({
        name: "John",
        companyName: "",
        phone: "",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const updateArgs = mockUserUpdate.mock.calls[0][0];
    expect(updateArgs.data.companyName).toBeNull();
    expect(updateArgs.data.phone).toBeNull();
  });
});

// ── PUT /api/auth/change-password (already tested) ──

describe("PUT /api/auth/change-password", () => {
  it("already tested in change-password-api.test.ts — skip", () => {
    // Full tests live in apps/dashboard/src/__tests__/change-password-api.test.ts
    expect(true).toBe(true);
  });
});

// ── GET /api/stripe/connect ──

describe("GET /api/stripe/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns connected: false when user has no Connect account", async () => {
    mockUserFindUnique.mockResolvedValue({
      stripeConnectAccountId: null,
      stripeOnboardingComplete: false,
    });

    const { GET } = await import("../app/api/stripe/connect/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.connected).toBe(false);
    expect(data.accountId).toBeNull();
    expect(data.onboardingComplete).toBe(false);
  });

  it("returns connected: true when user has Connect account and onboarding is complete", async () => {
    mockUserFindUnique.mockResolvedValue({
      stripeConnectAccountId: "acct_test_123",
      stripeOnboardingComplete: true,
    });

    const { GET } = await import("../app/api/stripe/connect/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.connected).toBe(true);
    expect(data.accountId).toBe("acct_test_123");
    expect(data.onboardingComplete).toBe(true);
  });

  it("checks Stripe live status when onboarding not yet marked complete", async () => {
    mockUserFindUnique.mockResolvedValue({
      stripeConnectAccountId: "acct_pending_456",
      stripeOnboardingComplete: false,
    });
    mockIsAccountOnboarded.mockResolvedValue(true);
    mockUserUpdate.mockResolvedValue({});

    const { GET } = await import("../app/api/stripe/connect/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.connected).toBe(true);
    expect(data.onboardingComplete).toBe(true);

    // Verify it checked live status
    expect(mockIsAccountOnboarded).toHaveBeenCalledWith("acct_pending_456");
    // Verify it persisted the update
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stripeOnboardingComplete: true },
      })
    );
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { GET } = await import("../app/api/stripe/connect/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// ── POST /api/stripe/connect ──

describe("POST /api/stripe/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates Stripe Connect account and returns onboarding URL", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-settings-1",
      email: "settings@test.com",
      companyName: "Acme Props",
      stripeConnectAccountId: null,
    });
    mockCreateConnectAccount.mockResolvedValue("acct_new_789");
    mockUserUpdate.mockResolvedValue({});
    mockCreateAccountLink.mockResolvedValue("https://connect.stripe.com/onboard/xyz");

    const { POST } = await import("../app/api/stripe/connect/route");

    const req = new NextRequest("http://localhost/api/stripe/connect", {
      method: "POST",
      body: JSON.stringify({ baseUrl: "http://localhost:3000" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.accountId).toBe("acct_new_789");
    expect(data.onboardingUrl).toBe("https://connect.stripe.com/onboard/xyz");

    expect(mockCreateConnectAccount).toHaveBeenCalledWith({
      email: "settings@test.com",
      companyName: "Acme Props",
    });
  });

  it("reuses existing Connect account if already created", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-settings-1",
      email: "settings@test.com",
      companyName: "Acme Props",
      stripeConnectAccountId: "acct_existing_111",
    });
    mockCreateAccountLink.mockResolvedValue("https://connect.stripe.com/onboard/abc");

    const { POST } = await import("../app/api/stripe/connect/route");

    const req = new NextRequest("http://localhost/api/stripe/connect", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.accountId).toBe("acct_existing_111");
    // Should NOT create a new account
    expect(mockCreateConnectAccount).not.toHaveBeenCalled();
  });

  it("returns 503 when Stripe is not configured", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-settings-1",
      email: "settings@test.com",
      companyName: null,
      stripeConnectAccountId: null,
    });
    mockCreateConnectAccount.mockResolvedValue(null);

    const { POST } = await import("../app/api/stripe/connect/route");

    const req = new NextRequest("http://localhost/api/stripe/connect", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(503);

    const data = await res.json();
    expect(data.error).toContain("not configured");
  });

  it("returns 500 when onboarding link creation fails", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-settings-1",
      email: "settings@test.com",
      companyName: null,
      stripeConnectAccountId: "acct_existing_222",
    });
    mockCreateAccountLink.mockResolvedValue(null);

    const { POST } = await import("../app/api/stripe/connect/route");

    const req = new NextRequest("http://localhost/api/stripe/connect", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    const data = await res.json();
    expect(data.error).toContain("onboarding link");
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { POST } = await import("../app/api/stripe/connect/route");

    const req = new NextRequest("http://localhost/api/stripe/connect", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 404 when user is not found in DB", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const { POST } = await import("../app/api/stripe/connect/route");

    const req = new NextRequest("http://localhost/api/stripe/connect", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});
