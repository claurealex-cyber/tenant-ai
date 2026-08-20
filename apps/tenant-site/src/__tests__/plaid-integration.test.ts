process.env.PII_ENCRYPTION_KEY = "a".repeat(64);

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

// ── Mock @/lib/plaid ──────────────────────────────────────────────
const mockCreateLinkToken = vi.fn();
const mockExchangePublicToken = vi.fn();
const mockGetAccountInfo = vi.fn();
const mockCreateProcessorToken = vi.fn();
const mockRemovePlaidItem = vi.fn();

vi.mock("@/lib/plaid", () => ({
  createLinkToken: (...args: any[]) => mockCreateLinkToken(...args),
  exchangePublicToken: (...args: any[]) => mockExchangePublicToken(...args),
  getAccountInfo: (...args: any[]) => mockGetAccountInfo(...args),
  createProcessorToken: (...args: any[]) => mockCreateProcessorToken(...args),
  removePlaidItem: (...args: any[]) => mockRemovePlaidItem(...args),
}));

// ── Mock @/lib/stripe ─────────────────────────────────────────────
const mockGetOrCreateCustomer = vi.fn();
const mockAttachBankSource = vi.fn();

vi.mock("@/lib/stripe", () => ({
  getOrCreateCustomer: (...args: any[]) => mockGetOrCreateCustomer(...args),
  attachBankSource: (...args: any[]) => mockAttachBankSource(...args),
}));

// ── Mock encrypt/decrypt ──────────────────────────────────────────
const mockEncrypt = vi.fn().mockReturnValue("encrypted_token");
const mockDecrypt = vi.fn().mockReturnValue("access_token_123");

vi.mock("@tenant-ai/shared", () => ({
  encrypt: (...args: any[]) => mockEncrypt(...args),
  decrypt: (...args: any[]) => mockDecrypt(...args),
}));

// ── Session helper ────────────────────────────────────────────────
function tenantSession(overrides: Record<string, unknown> = {}) {
  return {
    tenant: {
      id: "tenant-plaid-1",
      email: "plaid@test.com",
      firstName: "Plaid",
      lastName: "Tester",
      userId: "landlord-1",
      ...overrides,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// POST /api/portal/plaid/create-link-token
// ─────────────────────────────────────────────────────────────────
describe("POST /api/portal/plaid/create-link-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { POST } = await import("../app/api/portal/plaid/create-link-token/route");
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("returns 503 when Plaid is not configured", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockCreateLinkToken.mockResolvedValue(null);

    const { POST } = await import("../app/api/portal/plaid/create-link-token/route");
    const res = await POST();
    expect(res.status).toBe(503);
  });

  it("returns link token on success", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockCreateLinkToken.mockResolvedValue("link-sandbox-abc123");

    const { POST } = await import("../app/api/portal/plaid/create-link-token/route");
    const res = await POST();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.linkToken).toBe("link-sandbox-abc123");
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/portal/plaid/exchange-token
// ─────────────────────────────────────────────────────────────────
describe("POST /api/portal/plaid/exchange-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { POST } = await import("../app/api/portal/plaid/exchange-token/route");
    const req = new NextRequest("http://localhost:3002/api/portal/plaid/exchange-token", {
      method: "POST",
      body: JSON.stringify({ publicToken: "pt_123", accountId: "acc_123" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when publicToken is missing", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { POST } = await import("../app/api/portal/plaid/exchange-token/route");
    const req = new NextRequest("http://localhost:3002/api/portal/plaid/exchange-token", {
      method: "POST",
      body: JSON.stringify({ accountId: "acc_123" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when accountId is missing", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { POST } = await import("../app/api/portal/plaid/exchange-token/route");
    const req = new NextRequest("http://localhost:3002/api/portal/plaid/exchange-token", {
      method: "POST",
      body: JSON.stringify({ publicToken: "pt_123" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("links bank account on success (201)", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockTenantFindUnique.mockResolvedValue({
      plaidAccessToken: null,
      stripeCustomerId: null,
      email: "plaid@test.com",
      firstName: "Plaid",
      lastName: "Tester",
    });
    mockExchangePublicToken.mockResolvedValue({
      accessToken: "access_token_123",
      itemId: "item_123",
    });
    mockGetAccountInfo.mockResolvedValue({ bankName: "Chase", last4: "4567" });
    mockCreateProcessorToken.mockResolvedValue("btok_stripe_123");
    mockGetOrCreateCustomer.mockResolvedValue("cus_123");
    mockAttachBankSource.mockResolvedValue("ba_123");
    mockTenantUpdate.mockResolvedValue({});

    const { POST } = await import("../app/api/portal/plaid/exchange-token/route");
    const req = new NextRequest("http://localhost:3002/api/portal/plaid/exchange-token", {
      method: "POST",
      body: JSON.stringify({ publicToken: "pt_123", accountId: "acc_123" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.bankAccount.bankName).toBe("Chase");
    expect(data.bankAccount.last4).toBe("4567");

    // Verify encrypt was called on access token
    expect(mockEncrypt).toHaveBeenCalledWith("access_token_123");

    // Verify tenant was updated with all fields
    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          plaidAccessToken: "encrypted_token",
          plaidItemId: "item_123",
          bankName: "Chase",
          bankAccountLast4: "4567",
          stripeCustomerId: "cus_123",
          stripePaymentMethodId: "ba_123",
        }),
      })
    );
  });

  it("removes old Plaid item when re-linking", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockTenantFindUnique.mockResolvedValue({
      plaidAccessToken: "old_encrypted_token",
      stripeCustomerId: "cus_existing",
      email: "plaid@test.com",
      firstName: "Plaid",
      lastName: "Tester",
    });
    mockRemovePlaidItem.mockResolvedValue(undefined);
    mockExchangePublicToken.mockResolvedValue({
      accessToken: "new_access_token",
      itemId: "new_item",
    });
    mockGetAccountInfo.mockResolvedValue({ bankName: "Wells Fargo", last4: "9876" });
    mockCreateProcessorToken.mockResolvedValue("btok_new");
    mockGetOrCreateCustomer.mockResolvedValue("cus_existing");
    mockAttachBankSource.mockResolvedValue("ba_new");
    mockTenantUpdate.mockResolvedValue({});

    const { POST } = await import("../app/api/portal/plaid/exchange-token/route");
    const req = new NextRequest("http://localhost:3002/api/portal/plaid/exchange-token", {
      method: "POST",
      body: JSON.stringify({ publicToken: "pt_new", accountId: "acc_new" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Old item should have been removed
    expect(mockDecrypt).toHaveBeenCalledWith("old_encrypted_token");
    expect(mockRemovePlaidItem).toHaveBeenCalled();
  });

  it("returns 500 when Plaid exchange fails", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockTenantFindUnique.mockResolvedValue({
      plaidAccessToken: null,
      stripeCustomerId: null,
      email: "plaid@test.com",
      firstName: "Plaid",
      lastName: "Tester",
    });
    mockExchangePublicToken.mockRejectedValue(new Error("Plaid API error"));

    const { POST } = await import("../app/api/portal/plaid/exchange-token/route");
    const req = new NextRequest("http://localhost:3002/api/portal/plaid/exchange-token", {
      method: "POST",
      body: JSON.stringify({ publicToken: "pt_bad", accountId: "acc_123" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/portal/plaid/unlink
// ─────────────────────────────────────────────────────────────────
describe("DELETE /api/portal/plaid/unlink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { DELETE } = await import("../app/api/portal/plaid/unlink/route");
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("returns 400 when no bank is linked", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockTenantFindUnique.mockResolvedValue({
      plaidAccessToken: null,
      bankName: null,
    });

    const { DELETE } = await import("../app/api/portal/plaid/unlink/route");
    const res = await DELETE();
    expect(res.status).toBe(400);
  });

  it("unlinks bank account and clears fields", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockTenantFindUnique.mockResolvedValue({
      plaidAccessToken: "encrypted_token",
      bankName: "Chase",
    });
    mockRemovePlaidItem.mockResolvedValue(undefined);
    mockTenantUpdate.mockResolvedValue({});

    const { DELETE } = await import("../app/api/portal/plaid/unlink/route");
    const res = await DELETE();
    expect(res.status).toBe(200);

    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          plaidAccessToken: null,
          plaidItemId: null,
          bankName: null,
          bankAccountLast4: null,
          stripePaymentMethodId: null,
        }),
      })
    );
  });

  it("still clears fields when Plaid item removal fails", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockTenantFindUnique.mockResolvedValue({
      plaidAccessToken: "encrypted_token",
      bankName: "Chase",
    });
    mockRemovePlaidItem.mockRejectedValue(new Error("Plaid API error"));
    mockTenantUpdate.mockResolvedValue({});

    const { DELETE } = await import("../app/api/portal/plaid/unlink/route");
    const res = await DELETE();
    expect(res.status).toBe(200);

    // Fields should still be cleared despite Plaid failure
    expect(mockTenantUpdate).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/portal/plaid/status
// ─────────────────────────────────────────────────────────────────
describe("GET /api/portal/plaid/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/plaid/status/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns linked=false when no bank is linked", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockTenantFindUnique.mockResolvedValue({
      bankName: null,
      bankAccountLast4: null,
    });

    const { GET } = await import("../app/api/portal/plaid/status/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.linked).toBe(false);
    expect(data.bankAccount).toBeNull();
  });

  it("returns linked=true with bank info when linked", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockTenantFindUnique.mockResolvedValue({
      bankName: "Chase",
      bankAccountLast4: "4567",
    });

    const { GET } = await import("../app/api/portal/plaid/status/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.linked).toBe(true);
    expect(data.bankAccount.bankName).toBe("Chase");
    expect(data.bankAccount.last4).toBe("4567");
  });
});
