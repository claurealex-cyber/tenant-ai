import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock prisma ─────────────────────────────────────────────────────────────
const mockPropertyFindMany = vi.fn();
const mockPropertyFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    property: {
      findMany: (...args: any[]) => mockPropertyFindMany(...args),
      findUnique: (...args: any[]) => mockPropertyFindUnique(...args),
    },
  },
}));

// ── Mock tenant-context ─────────────────────────────────────────────────────
const mockResolveTenantContext = vi.fn();

vi.mock("@/lib/tenant-context", () => ({
  resolveTenantContext: (...args: any[]) => mockResolveTenantContext(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
const MOCK_CONTEXT = {
  userId: "landlord-001",
  subdomain: "acme",
  companyName: "Acme Properties LLC",
  logoUrl: "https://example.com/logo.png",
  primaryColor: "#2563eb",
  heroImageUrl: "https://example.com/hero.jpg",
  aboutText: "Welcome to Acme Properties",
  contactEmail: "contact@acme.com",
  contactPhone: "+13125551000",
};

function makeRequest(url: string, host = "acme.tenantai.com"): NextRequest {
  return new NextRequest(url, {
    headers: { "x-tenant-host": host },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/properties
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/properties — public property listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns active properties with branding for valid tenant host", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindMany.mockResolvedValue([
      {
        id: "prop-1",
        name: "Lakeview Apartments",
        address: "100 Lake St, Chicago IL 60601",
        description: "Beautiful lake views",
        amenities: ["Pool", "Gym"],
        units: [
          { id: "u1", unitNumber: "101", bedrooms: 2, bathrooms: 1, sqft: 900, monthlyRent: 150000 },
          { id: "u2", unitNumber: "202", bedrooms: 1, bathrooms: 1, sqft: 650, monthlyRent: 120000 },
        ],
        photos: [{ url: "https://example.com/photo1.jpg", caption: "Front" }],
      },
    ]);

    const { GET } = await import("../app/api/properties/route");

    const req = makeRequest("http://acme.tenantai.com/api/properties");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    // Properties
    expect(data.properties).toHaveLength(1);
    const prop = data.properties[0];
    expect(prop.id).toBe("prop-1");
    expect(prop.name).toBe("Lakeview Apartments");
    expect(prop.address).toBe("100 Lake St, Chicago IL 60601");
    expect(prop.description).toBe("Beautiful lake views");
    expect(prop.amenities).toEqual(["Pool", "Gym"]);
    expect(prop.availableUnits).toBe(2);
    expect(prop.rentMin).toBe(120000);
    expect(prop.rentMax).toBe(150000);
    expect(prop.photo).toBe("https://example.com/photo1.jpg");

    // Branding
    expect(data.branding.companyName).toBe("Acme Properties LLC");
    expect(data.branding.logoUrl).toBe("https://example.com/logo.png");
    expect(data.branding.primaryColor).toBe("#2563eb");
    expect(data.branding.heroImageUrl).toBe("https://example.com/hero.jpg");
    expect(data.branding.aboutText).toBe("Welcome to Acme Properties");
    expect(data.branding.contactEmail).toBe("contact@acme.com");
    expect(data.branding.contactPhone).toBe("+13125551000");
  });

  it("returns 404 when tenant context cannot be resolved", async () => {
    mockResolveTenantContext.mockResolvedValue(null);

    const { GET } = await import("../app/api/properties/route");

    const req = makeRequest(
      "http://unknown.tenantai.com/api/properties",
      "unknown.tenantai.com"
    );
    const res = await GET(req);

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Website not found");
  });

  it("calculates rent range correctly from units", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindMany.mockResolvedValue([
      {
        id: "prop-range",
        name: "Range Test Property",
        address: "200 Range Ave",
        description: null,
        amenities: [],
        units: [
          { id: "u1", unitNumber: "A", bedrooms: 1, bathrooms: 1, sqft: 500, monthlyRent: 90000 },
          { id: "u2", unitNumber: "B", bedrooms: 2, bathrooms: 1, sqft: 800, monthlyRent: 130000 },
          { id: "u3", unitNumber: "C", bedrooms: 3, bathrooms: 2, sqft: 1200, monthlyRent: 200000 },
        ],
        photos: [],
      },
    ]);

    const { GET } = await import("../app/api/properties/route");

    const req = makeRequest("http://acme.tenantai.com/api/properties");
    const res = await GET(req);
    const data = await res.json();

    expect(data.properties[0].rentMin).toBe(90000);
    expect(data.properties[0].rentMax).toBe(200000);
    expect(data.properties[0].availableUnits).toBe(3);
  });

  it("returns null rent range when no vacant units", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindMany.mockResolvedValue([
      {
        id: "prop-empty",
        name: "No Units Property",
        address: "300 Empty St",
        description: null,
        amenities: [],
        units: [],
        photos: [],
      },
    ]);

    const { GET } = await import("../app/api/properties/route");

    const req = makeRequest("http://acme.tenantai.com/api/properties");
    const res = await GET(req);
    const data = await res.json();

    expect(data.properties[0].rentMin).toBeNull();
    expect(data.properties[0].rentMax).toBeNull();
    expect(data.properties[0].availableUnits).toBe(0);
    expect(data.properties[0].photo).toBeNull();
  });

  it("returns empty array when landlord has no active properties", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindMany.mockResolvedValue([]);

    const { GET } = await import("../app/api/properties/route");

    const req = makeRequest("http://acme.tenantai.com/api/properties");
    const res = await GET(req);
    const data = await res.json();

    expect(data.properties).toEqual([]);
    expect(data.branding.companyName).toBe("Acme Properties LLC");
  });

  it("passes the correct hostname to resolveTenantContext", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindMany.mockResolvedValue([]);

    const { GET } = await import("../app/api/properties/route");

    const req = makeRequest(
      "http://custom.example.com/api/properties",
      "custom.example.com"
    );
    await GET(req);

    expect(mockResolveTenantContext).toHaveBeenCalledWith("custom.example.com");
  });

  it("queries only active properties for the resolved userId", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindMany.mockResolvedValue([]);

    const { GET } = await import("../app/api/properties/route");

    const req = makeRequest("http://acme.tenantai.com/api/properties");
    await GET(req);

    expect(mockPropertyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "landlord-001",
          isActive: true,
        },
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/properties/[id]
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/properties/[id] — property detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns property detail with units, photos, and questions", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindUnique.mockResolvedValue({
      id: "prop-detail",
      userId: "landlord-001",
      isActive: true,
      name: "Parkview Towers",
      address: "500 Park Ave, Chicago IL 60601",
      description: "Luxury high-rise living",
      amenities: ["Doorman", "Rooftop"],
      twilioPhone: "+13125559999",
      units: [
        { id: "u1", unitNumber: "10A", bedrooms: 2, bathrooms: 2, sqft: 1100, monthlyRent: 250000 },
        { id: "u2", unitNumber: "10B", bedrooms: 1, bathrooms: 1, sqft: 700, monthlyRent: 180000 },
      ],
      photos: [
        { id: "ph1", url: "https://example.com/lobby.jpg", caption: "Lobby" },
        { id: "ph2", url: "https://example.com/pool.jpg", caption: "Pool" },
      ],
      questions: [
        { id: "q1", text: "What is your full name?", fieldKey: "fullName", type: "text", required: true },
        { id: "q2", text: "What is your email?", fieldKey: "email", type: "text", required: true },
      ],
      tourSlots: [],
    });

    const { GET } = await import("../app/api/properties/[id]/route");

    const req = makeRequest("http://acme.tenantai.com/api/properties/prop-detail");
    const res = await GET(req, { params: Promise.resolve({ id: "prop-detail" }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    const prop = data.property;

    expect(prop.id).toBe("prop-detail");
    expect(prop.name).toBe("Parkview Towers");
    expect(prop.address).toBe("500 Park Ave, Chicago IL 60601");
    expect(prop.description).toBe("Luxury high-rise living");
    expect(prop.amenities).toEqual(["Doorman", "Rooftop"]);
    expect(prop.twilioPhone).toBe("+13125559999");
    expect(prop.hasTourSlots).toBe(false);

    // Units with monthlyRent in cents
    expect(prop.units).toHaveLength(2);
    expect(prop.units[0].unitNumber).toBe("10A");
    expect(prop.units[0].monthlyRent).toBe(250000);
    expect(prop.units[1].monthlyRent).toBe(180000);

    // Photos
    expect(prop.photos).toHaveLength(2);
    expect(prop.photos[0].url).toBe("https://example.com/lobby.jpg");
    expect(prop.photos[0].caption).toBe("Lobby");

    // Screening questions
    expect(prop.questions).toHaveLength(2);
    expect(prop.questions[0].text).toBe("What is your full name?");
    expect(prop.questions[0].fieldKey).toBe("fullName");
    expect(prop.questions[1].text).toBe("What is your email?");
  });

  it("returns 404 when tenant context cannot be resolved", async () => {
    mockResolveTenantContext.mockResolvedValue(null);

    const { GET } = await import("../app/api/properties/[id]/route");

    const req = makeRequest("http://unknown.tenantai.com/api/properties/prop-x");
    const res = await GET(req, { params: Promise.resolve({ id: "prop-x" }) });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Website not found");
  });

  it("returns 404 when property does not exist", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindUnique.mockResolvedValue(null);

    const { GET } = await import("../app/api/properties/[id]/route");

    const req = makeRequest("http://acme.tenantai.com/api/properties/nonexistent");
    const res = await GET(req, { params: Promise.resolve({ id: "nonexistent" }) });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Property not found");
  });

  it("returns 404 when property belongs to a different landlord", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindUnique.mockResolvedValue({
      id: "prop-other",
      userId: "different-landlord",
      isActive: true,
      name: "Other Property",
      address: "999 Other St",
      units: [],
      photos: [],
      questions: [],
    });

    const { GET } = await import("../app/api/properties/[id]/route");

    const req = makeRequest("http://acme.tenantai.com/api/properties/prop-other");
    const res = await GET(req, { params: Promise.resolve({ id: "prop-other" }) });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Property not found");
  });

  it("returns 404 when property is inactive", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindUnique.mockResolvedValue({
      id: "prop-inactive",
      userId: "landlord-001",
      isActive: false,
      name: "Inactive Property",
      address: "888 Inactive Blvd",
      units: [],
      photos: [],
      questions: [],
    });

    const { GET } = await import("../app/api/properties/[id]/route");

    const req = makeRequest("http://acme.tenantai.com/api/properties/prop-inactive");
    const res = await GET(req, { params: Promise.resolve({ id: "prop-inactive" }) });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Property not found");
  });

  it("returns property with empty units, photos, and questions", async () => {
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindUnique.mockResolvedValue({
      id: "prop-minimal",
      userId: "landlord-001",
      isActive: true,
      name: "Minimal Property",
      address: "1 Minimal Rd",
      description: null,
      amenities: [],
      twilioPhone: null,
      units: [],
      photos: [],
      questions: [],
      tourSlots: [],
    });

    const { GET } = await import("../app/api/properties/[id]/route");

    const req = makeRequest("http://acme.tenantai.com/api/properties/prop-minimal");
    const res = await GET(req, { params: Promise.resolve({ id: "prop-minimal" }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    const prop = data.property;

    expect(prop.units).toEqual([]);
    expect(prop.photos).toEqual([]);
    expect(prop.questions).toEqual([]);
    expect(prop.description).toBeNull();
    expect(prop.twilioPhone).toBeNull();
  });
});
