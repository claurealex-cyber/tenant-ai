import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock next-auth ────────────────────────────────────────────────
const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

// ── Mock @/lib/auth (tenantAuthOptions) ───────────────────────────
vi.mock("@/lib/auth", () => ({
  tenantAuthOptions: { providers: [] },
}));

// ── Mock tenant-context ─────────────────────────────────────────────
const mockResolveTenantContext = vi.fn();
vi.mock("@/lib/tenant-context", () => ({
  resolveTenantContext: (...args: any[]) => mockResolveTenantContext(...args),
}));

// ── Mock @tenant-ai/shared ──────────────────────────────────────────
const mockSendEmail = vi.fn();
const mockTextToHtml = vi.fn().mockReturnValue("<html>test</html>");
const mockComputeAvailableSlots = vi.fn();
vi.mock("@tenant-ai/shared", () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
  textToHtml: (...args: any[]) => mockTextToHtml(...args),
  computeAvailableSlots: (...args: any[]) => mockComputeAvailableSlots(...args),
}));

// ── Mock @/lib/prisma ─────────────────────────────────────────────
const mockPropertyFindUnique = vi.fn();
const mockTourSlotFindMany = vi.fn();
const mockTourBookingFindMany = vi.fn();
const mockTourBookingFindFirst = vi.fn();
const mockTourBookingFindUnique = vi.fn();
const mockTourBookingCreate = vi.fn();
const mockTourBookingUpdate = vi.fn();
const mockUserFindUnique = vi.fn();
const mockMaintenanceRequestFindMany = vi.fn();
const mockMaintenanceRequestFindUnique = vi.fn();
const mockMaintenanceRequestCreate = vi.fn();
const mockLeaseFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    property: {
      findUnique: (...args: any[]) => mockPropertyFindUnique(...args),
    },
    tourSlot: {
      findMany: (...args: any[]) => mockTourSlotFindMany(...args),
    },
    tourBooking: {
      findMany: (...args: any[]) => mockTourBookingFindMany(...args),
      findFirst: (...args: any[]) => mockTourBookingFindFirst(...args),
      findUnique: (...args: any[]) => mockTourBookingFindUnique(...args),
      create: (...args: any[]) => mockTourBookingCreate(...args),
      update: (...args: any[]) => mockTourBookingUpdate(...args),
    },
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
    },
    maintenanceRequest: {
      findMany: (...args: any[]) => mockMaintenanceRequestFindMany(...args),
      findUnique: (...args: any[]) => mockMaintenanceRequestFindUnique(...args),
      create: (...args: any[]) => mockMaintenanceRequestCreate(...args),
    },
    lease: {
      findFirst: (...args: any[]) => mockLeaseFindFirst(...args),
    },
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────
const MOCK_CONTEXT = { userId: "landlord-1", subdomain: "acme" };

function tenantSession(overrides: Record<string, unknown> = {}) {
  return {
    tenant: {
      id: "tenant-1",
      email: "tenant@test.com",
      firstName: "Test",
      lastName: "Tenant",
      userId: "landlord-1",
      ...overrides,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// Tour Availability API
// ══════════════════════════════════════════════════════════════════════
describe("GET /api/tours/availability — available tour slots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns available slots for a valid property", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindUnique.mockResolvedValue({
      id: "prop-1",
      userId: "landlord-1",
      isActive: true,
      name: "Test Property",
    });
    mockTourSlotFindMany.mockResolvedValue([
      { id: "slot-1", dayOfWeek: 1, startTime: "09:00", endTime: "10:00", isActive: true },
    ]);
    mockTourBookingFindMany.mockResolvedValue([]);

    const expectedSlots = [
      { date: "2026-03-02", time: "09:00", available: true },
    ];
    mockComputeAvailableSlots.mockReturnValue(expectedSlots);

    const { GET } = await import("../app/api/tours/availability/route");
    const req = new NextRequest(
      "http://localhost:3002/api/tours/availability?propertyId=prop-1&startDate=2026-03-01&endDate=2026-03-07",
      { headers: { "x-tenant-host": "acme.example.com" } }
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.slots).toEqual(expectedSlots);
    expect(mockComputeAvailableSlots).toHaveBeenCalledOnce();
    expect(mockPropertyFindUnique).toHaveBeenCalledWith({ where: { id: "prop-1" } });
  });

  it("returns 404 when property not found", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindUnique.mockResolvedValue(null);

    const { GET } = await import("../app/api/tours/availability/route");
    const req = new NextRequest(
      "http://localhost:3002/api/tours/availability?propertyId=nonexistent&startDate=2026-03-01&endDate=2026-03-07",
      { headers: { "x-tenant-host": "acme.example.com" } }
    );
    const res = await GET(req);
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toBe("Property not found");
  });

  it("returns 400 for invalid date format", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);

    const { GET } = await import("../app/api/tours/availability/route");
    const req = new NextRequest(
      "http://localhost:3002/api/tours/availability?propertyId=prop-1&startDate=not-a-date&endDate=2026-03-07",
      { headers: { "x-tenant-host": "acme.example.com" } }
    );
    const res = await GET(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("Invalid date format");
  });

  it("returns empty slots when no tour slots configured", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindUnique.mockResolvedValue({
      id: "prop-1",
      userId: "landlord-1",
      isActive: true,
    });
    mockTourSlotFindMany.mockResolvedValue([]);
    mockTourBookingFindMany.mockResolvedValue([]);
    mockComputeAvailableSlots.mockReturnValue([]);

    const { GET } = await import("../app/api/tours/availability/route");
    const req = new NextRequest(
      "http://localhost:3002/api/tours/availability?propertyId=prop-1&startDate=2026-03-01&endDate=2026-03-07",
      { headers: { "x-tenant-host": "acme.example.com" } }
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.slots).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Tour Booking API
// ══════════════════════════════════════════════════════════════════════
describe("POST /api/tours/book — book a tour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a booking successfully", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindUnique.mockResolvedValue({
      id: "prop-1",
      userId: "landlord-1",
      isActive: true,
      name: "Test Property",
      address: "123 Main St",
    });
    mockTourBookingFindFirst.mockResolvedValue(null); // no conflict
    const bookingDate = new Date("2026-03-15T10:00:00Z");
    mockTourBookingCreate.mockResolvedValue({
      id: "booking-1",
      date: bookingDate,
      name: "Jane Doe",
    });
    mockUserFindUnique.mockResolvedValue({
      email: "landlord@test.com",
      name: "Landlord",
    });
    mockSendEmail.mockResolvedValue(undefined);

    const { POST } = await import("../app/api/tours/book/route");
    const req = new NextRequest("http://localhost:3002/api/tours/book", {
      method: "POST",
      headers: { "x-tenant-host": "acme.example.com" },
      body: JSON.stringify({
        propertyId: "prop-1",
        name: "Jane Doe",
        email: "jane@test.com",
        datetime: "2026-03-15T10:00:00Z",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.booking.id).toBe("booking-1");
    expect(data.booking.name).toBe("Jane Doe");
    expect(mockTourBookingCreate).toHaveBeenCalledOnce();
  });

  it("returns 409 on conflict (double booking)", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindUnique.mockResolvedValue({
      id: "prop-1",
      userId: "landlord-1",
      isActive: true,
      name: "Test Property",
      address: "123 Main St",
    });
    mockTourBookingFindFirst.mockResolvedValue({
      id: "existing-booking",
      date: new Date("2026-03-15T10:00:00Z"),
      status: "confirmed",
    });

    const { POST } = await import("../app/api/tours/book/route");
    const req = new NextRequest("http://localhost:3002/api/tours/book", {
      method: "POST",
      headers: { "x-tenant-host": "acme.example.com" },
      body: JSON.stringify({
        propertyId: "prop-1",
        name: "Jane Doe",
        datetime: "2026-03-15T10:00:00Z",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);

    const data = await res.json();
    expect(data.error).toContain("no longer available");
    expect(mockTourBookingCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when name is missing", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);

    const { POST } = await import("../app/api/tours/book/route");
    const req = new NextRequest("http://localhost:3002/api/tours/book", {
      method: "POST",
      headers: { "x-tenant-host": "acme.example.com" },
      body: JSON.stringify({
        propertyId: "prop-1",
        datetime: "2026-03-15T10:00:00Z",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("name is required");
  });

  it("returns 400 when datetime is missing", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);

    const { POST } = await import("../app/api/tours/book/route");
    const req = new NextRequest("http://localhost:3002/api/tours/book", {
      method: "POST",
      headers: { "x-tenant-host": "acme.example.com" },
      body: JSON.stringify({
        propertyId: "prop-1",
        name: "Jane Doe",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("datetime is required");
  });

  it("returns 404 when property not found", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindUnique.mockResolvedValue(null);

    const { POST } = await import("../app/api/tours/book/route");
    const req = new NextRequest("http://localhost:3002/api/tours/book", {
      method: "POST",
      headers: { "x-tenant-host": "acme.example.com" },
      body: JSON.stringify({
        propertyId: "nonexistent",
        name: "Jane Doe",
        datetime: "2026-03-15T10:00:00Z",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toBe("Property not found");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Tour Cancellation API
// ══════════════════════════════════════════════════════════════════════
describe("PUT /api/tours/bookings/[bookingId] — cancel a booking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels a booking successfully when email matches", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockTourBookingFindUnique.mockResolvedValue({
      id: "booking-1",
      name: "Jane Doe",
      email: "jane@test.com",
      phone: null,
      status: "confirmed",
      date: new Date("2026-03-15T10:00:00Z"),
      property: {
        id: "prop-1",
        name: "Test Property",
        address: "123 Main St",
        userId: "landlord-1",
      },
    });
    mockTourBookingUpdate.mockResolvedValue({
      id: "booking-1",
      status: "canceled",
    });
    mockUserFindUnique.mockResolvedValue({
      email: "landlord@test.com",
    });
    mockSendEmail.mockResolvedValue(undefined);

    const { PUT } = await import("../app/api/tours/bookings/[bookingId]/route");
    const req = new NextRequest("http://localhost:3002/api/tours/bookings/booking-1", {
      method: "PUT",
      headers: { "x-tenant-host": "acme.example.com" },
      body: JSON.stringify({
        status: "canceled",
        email: "jane@test.com",
      }),
    });
    const res = await PUT(req, { params: Promise.resolve({ bookingId: "booking-1" }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.booking.id).toBe("booking-1");
    expect(data.booking.status).toBe("canceled");
    expect(mockTourBookingUpdate).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { status: "canceled" },
    });
  });

  it("returns 403 when email doesn't match", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockTourBookingFindUnique.mockResolvedValue({
      id: "booking-1",
      name: "Jane Doe",
      email: "jane@test.com",
      phone: "3125551234",
      status: "confirmed",
      date: new Date("2026-03-15T10:00:00Z"),
      property: {
        id: "prop-1",
        name: "Test Property",
        address: "123 Main St",
        userId: "landlord-1",
      },
    });

    const { PUT } = await import("../app/api/tours/bookings/[bookingId]/route");
    const req = new NextRequest("http://localhost:3002/api/tours/bookings/booking-1", {
      method: "PUT",
      headers: { "x-tenant-host": "acme.example.com" },
      body: JSON.stringify({
        status: "canceled",
        email: "wrong@test.com",
      }),
    });
    const res = await PUT(req, { params: Promise.resolve({ bookingId: "booking-1" }) });
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toContain("Could not verify your identity");
    expect(mockTourBookingUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when booking is already canceled", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockTourBookingFindUnique.mockResolvedValue({
      id: "booking-1",
      name: "Jane Doe",
      email: "jane@test.com",
      phone: null,
      status: "canceled",
      date: new Date("2026-03-15T10:00:00Z"),
      property: {
        id: "prop-1",
        name: "Test Property",
        address: "123 Main St",
        userId: "landlord-1",
      },
    });

    const { PUT } = await import("../app/api/tours/bookings/[bookingId]/route");
    const req = new NextRequest("http://localhost:3002/api/tours/bookings/booking-1", {
      method: "PUT",
      headers: { "x-tenant-host": "acme.example.com" },
      body: JSON.stringify({
        status: "canceled",
        email: "jane@test.com",
      }),
    });
    const res = await PUT(req, { params: Promise.resolve({ bookingId: "booking-1" }) });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("Booking is already canceled");
  });

  it("returns 400 when status is not 'canceled'", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);

    const { PUT } = await import("../app/api/tours/bookings/[bookingId]/route");
    const req = new NextRequest("http://localhost:3002/api/tours/bookings/booking-1", {
      method: "PUT",
      headers: { "x-tenant-host": "acme.example.com" },
      body: JSON.stringify({
        status: "confirmed",
        email: "jane@test.com",
      }),
    });
    const res = await PUT(req, { params: Promise.resolve({ bookingId: "booking-1" }) });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("Only cancellation is supported");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Portal Maintenance API (list + create)
// ══════════════════════════════════════════════════════════════════════
describe("GET + POST /api/portal/maintenance — maintenance requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns tenant's maintenance requests", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    const fakeRequests = [
      {
        id: "mr-1",
        title: "Leaky faucet",
        description: "Kitchen faucet dripping",
        category: "plumbing",
        priority: "medium",
        status: "open",
        imageUrls: [],
        notes: null,
        resolvedAt: null,
        createdAt: new Date("2026-02-10T12:00:00Z"),
        updatedAt: new Date("2026-02-10T12:00:00Z"),
      },
      {
        id: "mr-2",
        title: "Broken outlet",
        description: "Living room outlet not working",
        category: "electrical",
        priority: "high",
        status: "in_progress",
        imageUrls: ["https://example.com/img1.jpg"],
        notes: "Electrician scheduled",
        resolvedAt: null,
        createdAt: new Date("2026-02-08T12:00:00Z"),
        updatedAt: new Date("2026-02-09T12:00:00Z"),
      },
    ];
    mockMaintenanceRequestFindMany.mockResolvedValue(fakeRequests);

    const { GET } = await import("../app/api/portal/maintenance/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.requests).toHaveLength(2);
    expect(data.requests[0].id).toBe("mr-1");
    expect(data.requests[0].title).toBe("Leaky faucet");
    expect(data.requests[1].id).toBe("mr-2");
    expect(data.requests[1].category).toBe("electrical");
  });

  it("POST creates a maintenance request", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockLeaseFindFirst.mockResolvedValue({
      id: "lease-1",
      tenantId: "tenant-1",
      unitId: "unit-1",
      status: "active",
      unit: {
        id: "unit-1",
        property: {
          id: "prop-1",
          name: "Test Property",
          address: "123 Main St",
          userId: "landlord-1",
        },
      },
    });
    const created = {
      id: "mr-new",
      propertyId: "prop-1",
      tenantId: "tenant-1",
      unitId: "unit-1",
      title: "Broken window",
      description: "Bedroom window cracked",
      category: "general",
      priority: "medium",
      status: "open",
      imageUrls: [],
      createdAt: new Date(),
    };
    mockMaintenanceRequestCreate.mockResolvedValue(created);
    mockUserFindUnique.mockResolvedValue({
      email: "landlord@test.com",
      name: "Landlord",
    });
    mockSendEmail.mockResolvedValue(undefined);

    const { POST } = await import("../app/api/portal/maintenance/route");
    const req = new NextRequest("http://localhost:3002/api/portal/maintenance", {
      method: "POST",
      body: JSON.stringify({
        title: "Broken window",
        description: "Bedroom window cracked",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.request.id).toBe("mr-new");
    expect(data.request.title).toBe("Broken window");
    expect(mockMaintenanceRequestCreate).toHaveBeenCalledOnce();
  });

  it("POST returns 400 when title is missing", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { POST } = await import("../app/api/portal/maintenance/route");
    const req = new NextRequest("http://localhost:3002/api/portal/maintenance", {
      method: "POST",
      body: JSON.stringify({
        description: "Something is broken",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("Title is required");
  });

  it("POST returns 400 when description is missing", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());

    const { POST } = await import("../app/api/portal/maintenance/route");
    const req = new NextRequest("http://localhost:3002/api/portal/maintenance", {
      method: "POST",
      body: JSON.stringify({
        title: "Broken thing",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("Description is required");
  });

  it("POST returns 400 when no active lease", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    mockLeaseFindFirst.mockResolvedValue(null);

    const { POST } = await import("../app/api/portal/maintenance/route");
    const req = new NextRequest("http://localhost:3002/api/portal/maintenance", {
      method: "POST",
      body: JSON.stringify({
        title: "Broken window",
        description: "Bedroom window cracked",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("No active lease found");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Portal Maintenance Detail API
// ══════════════════════════════════════════════════════════════════════
describe("GET /api/portal/maintenance/[id] — maintenance request detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns maintenance request detail for owner", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    const fakeRequest = {
      id: "mr-1",
      propertyId: "prop-1",
      tenantId: "tenant-1",
      unitId: "unit-1",
      title: "Leaky faucet",
      description: "Kitchen faucet dripping",
      category: "plumbing",
      priority: "medium",
      status: "open",
      imageUrls: [],
      notes: null,
      resolvedAt: null,
      createdAt: new Date("2026-02-10T12:00:00Z"),
      updatedAt: new Date("2026-02-10T12:00:00Z"),
    };
    mockMaintenanceRequestFindUnique.mockResolvedValue(fakeRequest);

    const { GET } = await import("../app/api/portal/maintenance/[id]/route");
    const req = new Request("http://localhost:3002/api/portal/maintenance/mr-1");
    const res = await GET(req, { params: Promise.resolve({ id: "mr-1" }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.request.id).toBe("mr-1");
    expect(data.request.title).toBe("Leaky faucet");
    expect(data.request.tenantId).toBe("tenant-1");
  });

  it("returns 404 for request owned by different tenant (IDOR check)", async () => {
    mockGetServerSession.mockResolvedValue(tenantSession());
    const fakeRequest = {
      id: "mr-2",
      propertyId: "prop-1",
      tenantId: "other-tenant-999",
      unitId: "unit-2",
      title: "Other tenant's request",
      description: "Should not be visible",
      category: "general",
      priority: "low",
      status: "open",
      imageUrls: [],
      notes: null,
      resolvedAt: null,
      createdAt: new Date("2026-02-09T12:00:00Z"),
      updatedAt: new Date("2026-02-09T12:00:00Z"),
    };
    mockMaintenanceRequestFindUnique.mockResolvedValue(fakeRequest);

    const { GET } = await import("../app/api/portal/maintenance/[id]/route");
    const req = new Request("http://localhost:3002/api/portal/maintenance/mr-2");
    const res = await GET(req, { params: Promise.resolve({ id: "mr-2" }) });
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toBe("Request not found");
  });
});
