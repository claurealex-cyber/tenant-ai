import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { id: "admin-1", role: "admin", email: "admin@test.com" },
  }),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

const mockUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    pricingTier: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: (...args: any[]) => mockUpdate(...args),
    },
  },
}));

describe("Admin Pricing - Field Injection Protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockImplementation(async (args: any) => ({
      id: args.where.id,
      ...args.data,
    }));
  });

  it("allows valid fields in PUT", async () => {
    const { PUT } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({
        id: "tier-1",
        displayName: "Pro Plan",
        basePriceCents: 4999,
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.displayName).toBe("Pro Plan");
    expect(updateArgs.data.basePriceCents).toBe(4999);
  });

  it("uses id in where clause, not in data", async () => {
    const { PUT } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({
        id: "tier-1",
        displayName: "Hacked",
      }),
    });

    await PUT(req);

    const updateArgs = mockUpdate.mock.calls[0][0];
    // id should be in where, not in data
    expect(updateArgs.where.id).toBe("tier-1");
    expect(updateArgs.data.id).toBeUndefined();
  });

  it("rejects unexpected fields like createdAt", async () => {
    const { PUT } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({
        id: "tier-1",
        createdAt: "2020-01-01",
        displayName: "Valid",
      }),
    });

    await PUT(req);

    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.createdAt).toBeUndefined();
    expect(updateArgs.data.displayName).toBe("Valid");
  });

  it("rejects malicious arbitrary fields", async () => {
    const { PUT } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({
        id: "tier-1",
        malicious: "injection",
        _internalField: true,
      }),
    });

    await PUT(req);

    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.malicious).toBeUndefined();
    expect(updateArgs.data._internalField).toBeUndefined();
  });

  it("rejects updatedAt field injection", async () => {
    const { PUT } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({
        id: "tier-1",
        updatedAt: "2020-01-01",
        displayName: "Safe",
      }),
    });

    await PUT(req);

    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.updatedAt).toBeUndefined();
    expect(updateArgs.data.displayName).toBe("Safe");
  });

  it("allows all legitimate whitelisted fields", async () => {
    const { PUT } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({
        id: "tier-1",
        name: "enterprise",
        displayName: "Enterprise",
        basePriceCents: 9999,
        includedAiCents: 5000,
        aiMarkupPercent: 30,
        maxProperties: 100,
        maxPhoneNumbers: 50,
        websiteEnabled: true,
        customDomainEnabled: true,
        description: "For large portfolios",
        sortOrder: 5,
        isActive: true,
      }),
    });

    await PUT(req);

    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.name).toBe("enterprise");
    expect(updateArgs.data.displayName).toBe("Enterprise");
    expect(updateArgs.data.basePriceCents).toBe(9999);
    expect(updateArgs.data.includedAiCents).toBe(5000);
    expect(updateArgs.data.aiMarkupPercent).toBe(30);
    expect(updateArgs.data.maxProperties).toBe(100);
    expect(updateArgs.data.maxPhoneNumbers).toBe(50);
    expect(updateArgs.data.websiteEnabled).toBe(true);
    expect(updateArgs.data.customDomainEnabled).toBe(true);
    expect(updateArgs.data.description).toBe("For large portfolios");
    expect(updateArgs.data.sortOrder).toBe(5);
    expect(updateArgs.data.isActive).toBe(true);
  });

  it("returns 400 when id is missing", async () => {
    const { PUT } = await import("../app/api/admin/pricing/route");

    const req = new NextRequest("http://localhost/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({
        displayName: "No ID",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("id");
  });
});
