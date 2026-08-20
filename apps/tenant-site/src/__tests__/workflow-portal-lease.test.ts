import { describe, it, expect, vi, beforeEach } from "vitest";

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
const mockLeaseFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lease: {
      findFirst: (...args: any[]) => mockLeaseFindFirst(...args),
    },
  },
}));

// ── Session helper ────────────────────────────────────────────────
function tenantSession(overrides: Record<string, unknown> = {}) {
  return {
    tenant: {
      id: "tenant-lease-1",
      email: "lease@test.com",
      firstName: "Lease",
      lastName: "Tenant",
      userId: "landlord-1",
      ...overrides,
    },
  };
}

describe("GET /api/portal/lease — tenant lease details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/lease/route");
    const res = await GET();
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns lease: null when tenant has no active lease", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockLeaseFindFirst.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/lease/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.lease).toBeNull();
  });

  it("returns full lease details with property info", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeLease = {
      id: "lease-full",
      monthlyRent: 150000,
      securityDeposit: 150000,
      startDate: new Date(2026, 0, 1).toISOString(),
      endDate: new Date(2027, 0, 1).toISOString(),
      leaseType: "fixed",
      rentDueDay: 1,
      lateFeeAmount: 5000,
      lateFeeGraceDays: 5,
      documentUrl: "https://storage.example.com/leases/lease-full.pdf",
      unit: {
        unitNumber: "A1",
        property: {
          name: "Lakeside Apartments",
          address: "456 Lake Dr, Chicago IL 60601",
        },
      },
    };
    mockLeaseFindFirst.mockResolvedValue(fakeLease);

    const { GET } = await import("../app/api/portal/lease/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    const lease = data.lease;

    expect(lease.id).toBe("lease-full");
    expect(lease.monthlyRent).toBe(150000);
    expect(lease.securityDeposit).toBe(150000);
    expect(lease.startDate).toBeDefined();
    expect(lease.endDate).toBeDefined();
    expect(lease.leaseType).toBe("fixed");
    expect(lease.rentDueDay).toBe(1);
    expect(lease.lateFeeAmount).toBe(5000);
    expect(lease.lateFeeGraceDays).toBe(5);
    expect(lease.documentUrl).toBe("https://storage.example.com/leases/lease-full.pdf");
    expect(lease.unitNumber).toBe("A1");
    expect(lease.propertyName).toBe("Lakeside Apartments");
    expect(lease.propertyAddress).toBe("456 Lake Dr, Chicago IL 60601");
  });

  it("returns monthlyRent and securityDeposit in cents", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeLease = {
      id: "lease-cents",
      monthlyRent: 275050, // $2,750.50
      securityDeposit: 275050,
      startDate: new Date(2026, 0, 1).toISOString(),
      endDate: new Date(2027, 0, 1).toISOString(),
      leaseType: "fixed",
      rentDueDay: 1,
      lateFeeAmount: 7500,
      lateFeeGraceDays: 3,
      documentUrl: null,
      unit: {
        unitNumber: "B2",
        property: { name: "P", address: "A" },
      },
    };
    mockLeaseFindFirst.mockResolvedValue(fakeLease);

    const { GET } = await import("../app/api/portal/lease/route");
    const res = await GET();
    const data = await res.json();

    expect(data.lease.monthlyRent).toBe(275050);
    expect(data.lease.securityDeposit).toBe(275050);
  });

  it("returns documentUrl as null when no lease document uploaded", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeLease = {
      id: "lease-no-doc",
      monthlyRent: 100000,
      securityDeposit: 100000,
      startDate: new Date(2026, 0, 1).toISOString(),
      endDate: null,
      leaseType: "month_to_month",
      rentDueDay: 1,
      lateFeeAmount: null,
      lateFeeGraceDays: null,
      documentUrl: null,
      unit: {
        unitNumber: "C3",
        property: { name: "P", address: "A" },
      },
    };
    mockLeaseFindFirst.mockResolvedValue(fakeLease);

    const { GET } = await import("../app/api/portal/lease/route");
    const res = await GET();
    const data = await res.json();

    expect(data.lease.documentUrl).toBeNull();
  });

  it("supports month-to-month lease type with null endDate", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeLease = {
      id: "lease-mtm",
      monthlyRent: 120000,
      securityDeposit: 120000,
      startDate: new Date(2026, 0, 1).toISOString(),
      endDate: null,
      leaseType: "month_to_month",
      rentDueDay: 15,
      lateFeeAmount: 5000,
      lateFeeGraceDays: 5,
      documentUrl: null,
      unit: {
        unitNumber: "D4",
        property: { name: "Downtown Lofts", address: "789 Main St" },
      },
    };
    mockLeaseFindFirst.mockResolvedValue(fakeLease);

    const { GET } = await import("../app/api/portal/lease/route");
    const res = await GET();
    const data = await res.json();

    expect(data.lease.leaseType).toBe("month_to_month");
    expect(data.lease.endDate).toBeNull();
    expect(data.lease.rentDueDay).toBe(15);
  });

  it("queries only active leases for the authenticated tenant", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession({ id: "tenant-check" }));
    mockLeaseFindFirst.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/lease/route");
    await GET();

    expect(mockLeaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-check",
          status: "active",
        },
      })
    );
  });

  it("includes lateFeeAmount and lateFeeGraceDays", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeLease = {
      id: "lease-latefee",
      monthlyRent: 200000,
      securityDeposit: 200000,
      startDate: new Date(2026, 0, 1).toISOString(),
      endDate: new Date(2027, 0, 1).toISOString(),
      leaseType: "fixed",
      rentDueDay: 1,
      lateFeeAmount: 10000,
      lateFeeGraceDays: 7,
      documentUrl: null,
      unit: {
        unitNumber: "E5",
        property: { name: "P", address: "A" },
      },
    };
    mockLeaseFindFirst.mockResolvedValue(fakeLease);

    const { GET } = await import("../app/api/portal/lease/route");
    const res = await GET();
    const data = await res.json();

    expect(data.lease.lateFeeAmount).toBe(10000);
    expect(data.lease.lateFeeGraceDays).toBe(7);
  });
});
