import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock next-auth ────────────────────────────────────────────────
const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

// ── Mock @/lib/auth (tenantAuthOptions) ───────────────────────────
vi.mock("@/lib/auth", () => ({
  tenantAuthOptions: { providers: [] },
}));

// ── Mock @/lib/prisma ─────────────────────────────────────────────
const mockLeaseFindFirst = vi.fn();
const mockRentChargeFindMany = vi.fn();
const mockRentChargeFindFirst = vi.fn();
const mockNoticeCount = vi.fn();
const mockMessageCount = vi.fn();
const mockMaintenanceRequestCount = vi.fn();
const mockTenantFindUnique = vi.fn();
const mockTourBookingFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lease: {
      findFirst: (...args: any[]) => mockLeaseFindFirst(...args),
    },
    rentCharge: {
      findMany: (...args: any[]) => mockRentChargeFindMany(...args),
      findFirst: (...args: any[]) => mockRentChargeFindFirst(...args),
    },
    notice: {
      count: (...args: any[]) => mockNoticeCount(...args),
    },
    message: {
      count: (...args: any[]) => mockMessageCount(...args),
    },
    maintenanceRequest: {
      count: (...args: any[]) => mockMaintenanceRequestCount(...args),
    },
    tenant: {
      findUnique: (...args: any[]) => mockTenantFindUnique(...args),
    },
    tourBooking: {
      findFirst: (...args: any[]) => mockTourBookingFindFirst(...args),
    },
  },
}));

// ── Session helper ────────────────────────────────────────────────
function tenantSession(overrides: Record<string, unknown> = {}) {
  return {
    tenant: {
      id: "tenant-dash-1",
      email: "dashboard@test.com",
      firstName: "Dash",
      lastName: "Tenant",
      userId: "landlord-1",
      ...overrides,
    },
  };
}

describe("GET /api/portal — tenant dashboard data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/route");
    const res = await GET();
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns empty dashboard when tenant has no active lease", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockLeaseFindFirst.mockResolvedValue(null);
    mockMaintenanceRequestCount.mockResolvedValue(0);
    mockTenantFindUnique.mockResolvedValue({ email: "dashboard@test.com", phone: "3125551234" });
    mockTourBookingFindFirst.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.lease).toBeNull();
    expect(data.balance).toBe(0);
    expect(data.nextDueDate).toBeNull();
    expect(data.overdueAmount).toBe(0);
    expect(data.unreadNotices).toBe(0);
    expect(data.unreadMessages).toBe(0);
  });

  it("returns balance in cents from unpaid rent charges", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeLease = {
      id: "lease-1",
      monthlyRent: 150000,
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2027, 0, 1),
      rentDueDay: 1,
      unit: {
        unitNumber: "101",
        property: {
          name: "Test Property",
          address: "123 Main St",
        },
      },
    };
    mockLeaseFindFirst.mockResolvedValue(fakeLease);

    // Two unpaid charges
    const charges = [
      { amount: 150000, paidAmount: 0, dueDate: new Date(2025, 11, 1), status: "unpaid" },
      { amount: 150000, paidAmount: 50000, dueDate: new Date(2026, 0, 1), status: "partial" },
    ];
    mockRentChargeFindMany.mockResolvedValue(charges);

    // Next due date
    mockRentChargeFindFirst.mockResolvedValue({
      dueDate: new Date(2026, 1, 1),
      amount: 150000,
      paidAmount: 0,
    });

    mockNoticeCount.mockResolvedValue(2);
    mockMessageCount.mockResolvedValue(3);
    mockMaintenanceRequestCount.mockResolvedValue(0);
    mockTenantFindUnique.mockResolvedValue({ email: "dashboard@test.com", phone: "3125551234" });
    mockTourBookingFindFirst.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/route");
    const res = await GET();
    const data = await res.json();

    // balance = (150000 - 0) + (150000 - 50000) = 250000 cents
    expect(data.balance).toBe(250000);
  });

  it("returns lease details with property info", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeLease = {
      id: "lease-2",
      monthlyRent: 120000,
      startDate: new Date(2026, 0, 1).toISOString(),
      endDate: new Date(2027, 0, 1).toISOString(),
      rentDueDay: 5,
      unit: {
        unitNumber: "B3",
        property: {
          name: "Lakeside Apts",
          address: "456 Lake Dr",
        },
      },
    };
    mockLeaseFindFirst.mockResolvedValue(fakeLease);
    mockRentChargeFindMany.mockResolvedValue([]);
    mockRentChargeFindFirst.mockResolvedValue(null);
    mockNoticeCount.mockResolvedValue(0);
    mockMessageCount.mockResolvedValue(0);
    mockMaintenanceRequestCount.mockResolvedValue(0);
    mockTenantFindUnique.mockResolvedValue({ email: "dashboard@test.com", phone: "3125551234" });
    mockTourBookingFindFirst.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/route");
    const res = await GET();
    const data = await res.json();

    expect(data.lease).not.toBeNull();
    expect(data.lease.id).toBe("lease-2");
    expect(data.lease.monthlyRent).toBe(120000);
    expect(data.lease.rentDueDay).toBe(5);
    expect(data.lease.unit).toBe("B3");
    expect(data.lease.property).toBe("Lakeside Apts");
    expect(data.lease.address).toBe("456 Lake Dr");
  });

  it("calculates overdue amount from past-due charges", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeLease = {
      id: "lease-3",
      monthlyRent: 150000,
      startDate: new Date(2025, 0, 1),
      endDate: new Date(2026, 6, 1),
      rentDueDay: 1,
      unit: {
        unitNumber: "A1",
        property: { name: "P", address: "Addr" },
      },
    };
    mockLeaseFindFirst.mockResolvedValue(fakeLease);

    // One charge overdue (in the past), one current
    const pastDate = new Date(Date.now() - 86400000 * 30); // 30 days ago
    const futureDate = new Date(Date.now() + 86400000 * 30); // 30 days from now
    const charges = [
      { amount: 150000, paidAmount: 0, dueDate: pastDate, status: "unpaid" },
      { amount: 150000, paidAmount: 0, dueDate: futureDate, status: "unpaid" },
    ];
    mockRentChargeFindMany.mockResolvedValue(charges);
    mockRentChargeFindFirst.mockResolvedValue({
      dueDate: futureDate,
      amount: 150000,
      paidAmount: 0,
    });
    mockNoticeCount.mockResolvedValue(0);
    mockMessageCount.mockResolvedValue(0);
    mockMaintenanceRequestCount.mockResolvedValue(0);
    mockTenantFindUnique.mockResolvedValue({ email: "dashboard@test.com", phone: "3125551234" });
    mockTourBookingFindFirst.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/route");
    const res = await GET();
    const data = await res.json();

    // Total balance = 150000 + 150000 = 300000
    expect(data.balance).toBe(300000);
    // Overdue amount = only the past-due charge = 150000
    expect(data.overdueAmount).toBe(150000);
  });

  it("returns nextDueDate and nextDueAmount", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeLease = {
      id: "lease-4",
      monthlyRent: 100000,
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2027, 0, 1),
      rentDueDay: 1,
      unit: {
        unitNumber: "C2",
        property: { name: "P", address: "A" },
      },
    };
    mockLeaseFindFirst.mockResolvedValue(fakeLease);
    mockRentChargeFindMany.mockResolvedValue([]);

    const nextDue = new Date(2026, 2, 1);
    mockRentChargeFindFirst.mockResolvedValue({
      dueDate: nextDue,
      amount: 100000,
      paidAmount: 25000,
    });
    mockNoticeCount.mockResolvedValue(0);
    mockMessageCount.mockResolvedValue(0);
    mockMaintenanceRequestCount.mockResolvedValue(0);
    mockTenantFindUnique.mockResolvedValue({ email: "dashboard@test.com", phone: "3125551234" });
    mockTourBookingFindFirst.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/route");
    const res = await GET();
    const data = await res.json();

    expect(data.nextDueDate).toBe(nextDue.toISOString());
    expect(data.nextDueAmount).toBe(75000); // 100000 - 25000
  });

  it("returns unread notices and messages counts", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeLease = {
      id: "lease-5",
      monthlyRent: 100000,
      startDate: new Date(2026, 0, 1),
      endDate: null,
      rentDueDay: 1,
      unit: {
        unitNumber: "D1",
        property: { name: "P", address: "A" },
      },
    };
    mockLeaseFindFirst.mockResolvedValue(fakeLease);
    mockRentChargeFindMany.mockResolvedValue([]);
    mockRentChargeFindFirst.mockResolvedValue(null);
    mockNoticeCount.mockResolvedValue(5);
    mockMessageCount.mockResolvedValue(12);
    mockMaintenanceRequestCount.mockResolvedValue(0);
    mockTenantFindUnique.mockResolvedValue({ email: "dashboard@test.com", phone: "3125551234" });
    mockTourBookingFindFirst.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/route");
    const res = await GET();
    const data = await res.json();

    expect(data.unreadNotices).toBe(5);
    expect(data.unreadMessages).toBe(12);
  });

  it("returns nextDueDate null when no upcoming charges", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const fakeLease = {
      id: "lease-6",
      monthlyRent: 100000,
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2027, 0, 1),
      rentDueDay: 1,
      unit: {
        unitNumber: "E1",
        property: { name: "P", address: "A" },
      },
    };
    mockLeaseFindFirst.mockResolvedValue(fakeLease);
    mockRentChargeFindMany.mockResolvedValue([]);
    mockRentChargeFindFirst.mockResolvedValue(null);
    mockNoticeCount.mockResolvedValue(0);
    mockMessageCount.mockResolvedValue(0);
    mockMaintenanceRequestCount.mockResolvedValue(0);
    mockTenantFindUnique.mockResolvedValue({ email: "dashboard@test.com", phone: "3125551234" });
    mockTourBookingFindFirst.mockResolvedValue(null);

    const { GET } = await import("../app/api/portal/route");
    const res = await GET();
    const data = await res.json();

    expect(data.nextDueDate).toBeNull();
    expect(data.nextDueAmount).toBe(0);
  });
});
