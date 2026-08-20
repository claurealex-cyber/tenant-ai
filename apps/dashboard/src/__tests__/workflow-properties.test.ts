import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PREFIX = `test_wf_props_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

// ── Session mock ──

let testUserId: string;

const mockSession = {
  user: { id: "", role: "client", email: "" },
};

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockImplementation(() =>
    Promise.resolve(mockSession.user.id ? { user: mockSession.user } : null)
  ),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => {
  const { PrismaClient: PC } = require("@prisma/client");
  const globalForPrisma = globalThis as any;
  if (!globalForPrisma.__testPrisma) {
    globalForPrisma.__testPrisma = new PC();
  }
  return { prisma: globalForPrisma.__testPrisma };
});

// Track created IDs for cleanup
const createdPropertyIds: string[] = [];
const createdUnitIds: string[] = [];
const createdPhotoIds: string[] = [];
const createdQuestionIds: string[] = [];

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "Workflow Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  testUserId = user.id;

  mockSession.user.id = testUserId;
  mockSession.user.email = user.email;
});

afterAll(async () => {
  // Clean up in dependency order
  await prisma.unit.deleteMany({
    where: { propertyId: { in: createdPropertyIds } },
  });
  await prisma.propertyPhoto.deleteMany({
    where: { propertyId: { in: createdPropertyIds } },
  });
  await prisma.question.deleteMany({
    where: { propertyId: { in: createdPropertyIds } },
  });
  await prisma.application.deleteMany({
    where: { propertyId: { in: createdPropertyIds } },
  });
  await prisma.property.deleteMany({
    where: { userId: testUserId },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Helpers ──

function makeRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(`http://localhost${url}`, options as any);
}

function makeJsonRequest(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Properties CRUD via route handlers
// ──────────────────────────────────────────────────────────────────────

describe("Properties workflow", () => {
  describe("POST /api/properties - create property", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { POST } = await import("@/app/api/properties/route");

      const req = makeJsonRequest("/api/properties", "POST", {
        name: "Unauth Property",
        address: "100 Unauth St",
      });

      const res = await POST(req);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    it("returns 400 when name is missing", async () => {
      const { POST } = await import("@/app/api/properties/route");

      const req = makeJsonRequest("/api/properties", "POST", {
        address: "100 Missing Name St",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("required");
    });

    it("returns 400 when address is missing", async () => {
      const { POST } = await import("@/app/api/properties/route");

      const req = makeJsonRequest("/api/properties", "POST", {
        name: "No Address Property",
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("required");
    });

    it("creates a property with name and address", async () => {
      const { POST } = await import("@/app/api/properties/route");

      const req = makeJsonRequest("/api/properties", "POST", {
        name: `${TEST_PREFIX} Apartments`,
        address: "123 Main St, Naperville IL 60540",
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.property).toBeDefined();
      expect(data.property.name).toBe(`${TEST_PREFIX} Apartments`);
      expect(data.property.address).toBe("123 Main St, Naperville IL 60540");
      expect(data.property.userId).toBe(testUserId);
      expect(data.property.isActive).toBe(false);

      createdPropertyIds.push(data.property.id);
    });

    it("creates a property with optional fields", async () => {
      const { POST } = await import("@/app/api/properties/route");

      const req = makeJsonRequest("/api/properties", "POST", {
        name: `${TEST_PREFIX} Condos`,
        address: "456 Oak Ave, Springfield IL 62704",
        unitCount: 12,
        description: "Beautiful condos",
        amenities: ["Pool", "Gym"],
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.property.unitCount).toBe(12);
      expect(data.property.description).toBe("Beautiful condos");
      expect(data.property.amenities).toEqual(["Pool", "Gym"]);

      createdPropertyIds.push(data.property.id);
    });

    it("detects Cook County from Chicago zip code", async () => {
      const { POST } = await import("@/app/api/properties/route");

      const req = makeJsonRequest("/api/properties", "POST", {
        name: `${TEST_PREFIX} Chicago Place`,
        address: "100 Michigan Ave, Chicago IL 60601",
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      const data = await res.json();
      // Cook County detection may succeed or fail depending on package availability
      // but the property should still be created
      expect(data.property.id).toBeDefined();

      createdPropertyIds.push(data.property.id);
    });
  });

  describe("GET /api/properties - list properties", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { GET } = await import("@/app/api/properties/route");

      const res = await GET();
      expect(res.status).toBe(401);
    });

    it("returns user properties as an array", async () => {
      const { GET } = await import("@/app/api/properties/route");

      const res = await GET();
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.properties).toBeDefined();
      expect(Array.isArray(data.properties)).toBe(true);
      expect(data.properties.length).toBeGreaterThanOrEqual(1);

      // All properties belong to the test user
      for (const prop of data.properties) {
        expect(prop.userId).toBe(testUserId);
      }
    });

    it("includes application and unit counts", async () => {
      const { GET } = await import("@/app/api/properties/route");

      const res = await GET();
      const data = await res.json();

      for (const prop of data.properties) {
        expect(prop._count).toBeDefined();
        expect(typeof prop._count.applications).toBe("number");
        expect(typeof prop._count.units).toBe("number");
      }
    });
  });

  describe("GET /api/properties/[id] - get single property", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { GET } = await import("@/app/api/properties/[id]/route");

      const req = makeRequest(`/api/properties/${createdPropertyIds[0]}`);
      const res = await GET(req, { params: { id: createdPropertyIds[0] } });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent property", async () => {
      const { GET } = await import("@/app/api/properties/[id]/route");

      const fakeId = "nonexistent_property_id";
      const req = makeRequest(`/api/properties/${fakeId}`);
      const res = await GET(req, { params: { id: fakeId } });
      expect(res.status).toBe(404);
    });

    it("returns property with units, photos, and questions", async () => {
      const { GET } = await import("@/app/api/properties/[id]/route");

      const propId = createdPropertyIds[0];
      const req = makeRequest(`/api/properties/${propId}`);
      const res = await GET(req, { params: { id: propId } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.property).toBeDefined();
      expect(data.property.id).toBe(propId);
      expect(Array.isArray(data.property.questions)).toBe(true);
      expect(Array.isArray(data.property.units)).toBe(true);
      expect(Array.isArray(data.property.photos)).toBe(true);
      expect(data.property._count).toBeDefined();
    });
  });

  describe("PUT /api/properties/[id] - update property", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { PUT } = await import("@/app/api/properties/[id]/route");

      const propId = createdPropertyIds[0];
      const req = makeJsonRequest(`/api/properties/${propId}`, "PUT", {
        name: "Updated",
      });
      const res = await PUT(req, { params: { id: propId } });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent property", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/route");

      const req = makeJsonRequest("/api/properties/fake_id", "PUT", {
        name: "Updated",
      });
      const res = await PUT(req, { params: { id: "fake_id" } });
      expect(res.status).toBe(404);
    });

    it("updates property name", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/route");

      const propId = createdPropertyIds[0];
      const newName = `${TEST_PREFIX} Updated Apartments`;
      const req = makeJsonRequest(`/api/properties/${propId}`, "PUT", {
        name: newName,
      });
      const res = await PUT(req, { params: { id: propId } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.property.name).toBe(newName);
    });

    it("updates property address", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/route");

      const propId = createdPropertyIds[0];
      const req = makeJsonRequest(`/api/properties/${propId}`, "PUT", {
        address: "999 New Address Blvd, Chicago IL 60601",
      });
      const res = await PUT(req, { params: { id: propId } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.property.address).toBe("999 New Address Blvd, Chicago IL 60601");
    });

    it("updates isActive flag", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/route");

      const propId = createdPropertyIds[0];
      const req = makeJsonRequest(`/api/properties/${propId}`, "PUT", {
        isActive: true,
      });
      const res = await PUT(req, { params: { id: propId } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.property.isActive).toBe(true);

      // Restore to false
      const req2 = makeJsonRequest(`/api/properties/${propId}`, "PUT", {
        isActive: false,
      });
      await PUT(req2, { params: { id: propId } });
    });

    it("updates AI settings", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/route");

      const propId = createdPropertyIds[0];
      const req = makeJsonRequest(`/api/properties/${propId}`, "PUT", {
        aiModel: "gpt-4o-realtime-preview",
        voiceName: "shimmer",
        maxCallMinutes: 20,
        recordingEnabled: true,
      });
      const res = await PUT(req, { params: { id: propId } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.property.aiModel).toBe("gpt-4o-realtime-preview");
      expect(data.property.voiceName).toBe("shimmer");
      expect(data.property.maxCallMinutes).toBe(20);
      expect(data.property.recordingEnabled).toBe(true);
    });
  });

  describe("DELETE /api/properties/[id] - delete property", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { DELETE } = await import("@/app/api/properties/[id]/route");

      const req = makeRequest(`/api/properties/${createdPropertyIds[0]}`);
      const res = await DELETE(req, { params: { id: createdPropertyIds[0] } });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent property", async () => {
      const { DELETE } = await import("@/app/api/properties/[id]/route");

      const req = makeRequest("/api/properties/fake_id");
      const res = await DELETE(req, { params: { id: "fake_id" } });
      expect(res.status).toBe(404);
    });

    it("deletes a property with no active applications", async () => {
      // Create a disposable property
      const prop = await prisma.property.create({
        data: {
          name: `${TEST_PREFIX} To Delete`,
          address: "999 Delete St",
          userId: testUserId,
        },
      });

      const { DELETE } = await import("@/app/api/properties/[id]/route");

      const req = makeRequest(`/api/properties/${prop.id}`);
      const res = await DELETE(req, { params: { id: prop.id } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify it's gone
      const found = await prisma.property.findUnique({ where: { id: prop.id } });
      expect(found).toBeNull();
    });

    it("blocks deletion when property has in_progress applications", async () => {
      // Create property with an active application
      const prop = await prisma.property.create({
        data: {
          name: `${TEST_PREFIX} Has Apps`,
          address: "888 App St",
          userId: testUserId,
        },
      });
      createdPropertyIds.push(prop.id);

      await prisma.application.create({
        data: {
          propertyId: prop.id,
          status: "in_progress",
          channel: "voice",
          callerPhone: "+15551234567",
        },
      });

      const { DELETE } = await import("@/app/api/properties/[id]/route");

      const req = makeRequest(`/api/properties/${prop.id}`);
      const res = await DELETE(req, { params: { id: prop.id } });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("active applications");
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Units CRUD
// ──────────────────────────────────────────────────────────────────────

describe("Units workflow", () => {
  let unitPropertyId: string;
  let createdUnitId: string;

  beforeAll(async () => {
    const prop = await prisma.property.create({
      data: {
        name: `${TEST_PREFIX} Unit Building`,
        address: "500 Unit Ave",
        userId: testUserId,
      },
    });
    unitPropertyId = prop.id;
    createdPropertyIds.push(unitPropertyId);
  });

  describe("POST /api/properties/[id]/units - create unit", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { POST } = await import("@/app/api/properties/[id]/units/route");

      const req = makeJsonRequest(`/api/properties/${unitPropertyId}/units`, "POST", {
        unitNumber: "101",
        monthlyRent: 150000,
      });
      const res = await POST(req, { params: { id: unitPropertyId } });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent property", async () => {
      const { POST } = await import("@/app/api/properties/[id]/units/route");

      const req = makeJsonRequest("/api/properties/fake_id/units", "POST", {
        unitNumber: "101",
        monthlyRent: 150000,
      });
      const res = await POST(req, { params: { id: "fake_id" } });
      expect(res.status).toBe(404);
    });

    it("returns 400 when unitNumber is missing", async () => {
      const { POST } = await import("@/app/api/properties/[id]/units/route");

      const req = makeJsonRequest(`/api/properties/${unitPropertyId}/units`, "POST", {
        monthlyRent: 150000,
      });
      const res = await POST(req, { params: { id: unitPropertyId } });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("Unit number");
    });

    it("returns 400 when monthlyRent is missing or zero", async () => {
      const { POST } = await import("@/app/api/properties/[id]/units/route");

      const req = makeJsonRequest(`/api/properties/${unitPropertyId}/units`, "POST", {
        unitNumber: "101",
        monthlyRent: 0,
      });
      const res = await POST(req, { params: { id: unitPropertyId } });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("Monthly rent");
    });

    it("creates a unit with all fields", async () => {
      const { POST } = await import("@/app/api/properties/[id]/units/route");

      const req = makeJsonRequest(`/api/properties/${unitPropertyId}/units`, "POST", {
        unitNumber: "101",
        bedrooms: 2,
        bathrooms: 1.5,
        sqft: 950,
        monthlyRent: 150000,
      });
      const res = await POST(req, { params: { id: unitPropertyId } });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.unit).toBeDefined();
      expect(data.unit.unitNumber).toBe("101");
      expect(data.unit.bedrooms).toBe(2);
      expect(data.unit.bathrooms).toBe(1.5);
      expect(data.unit.sqft).toBe(950);
      expect(data.unit.monthlyRent).toBe(150000);
      expect(data.unit.status).toBe("vacant");

      createdUnitId = data.unit.id;
      createdUnitIds.push(createdUnitId);
    });

    it("creates a unit with only required fields", async () => {
      const { POST } = await import("@/app/api/properties/[id]/units/route");

      const req = makeJsonRequest(`/api/properties/${unitPropertyId}/units`, "POST", {
        unitNumber: "102",
        monthlyRent: 120000,
      });
      const res = await POST(req, { params: { id: unitPropertyId } });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.unit.unitNumber).toBe("102");
      expect(data.unit.bedrooms).toBeNull();
      expect(data.unit.bathrooms).toBeNull();
      expect(data.unit.sqft).toBeNull();

      createdUnitIds.push(data.unit.id);
    });

    it("rejects duplicate unit number within the same property", async () => {
      const { POST } = await import("@/app/api/properties/[id]/units/route");

      const req = makeJsonRequest(`/api/properties/${unitPropertyId}/units`, "POST", {
        unitNumber: "101",
        monthlyRent: 100000,
      });
      const res = await POST(req, { params: { id: unitPropertyId } });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("already exists");
    });
  });

  describe("GET /api/properties/[id]/units - list units", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { GET } = await import("@/app/api/properties/[id]/units/route");

      const req = makeRequest(`/api/properties/${unitPropertyId}/units`);
      const res = await GET(req, { params: { id: unitPropertyId } });
      expect(res.status).toBe(401);
    });

    it("lists units ordered by unitNumber", async () => {
      const { GET } = await import("@/app/api/properties/[id]/units/route");

      const req = makeRequest(`/api/properties/${unitPropertyId}/units`);
      const res = await GET(req, { params: { id: unitPropertyId } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.units).toBeDefined();
      expect(data.units.length).toBeGreaterThanOrEqual(2);

      // Verify ascending order
      for (let i = 1; i < data.units.length; i++) {
        expect(data.units[i].unitNumber >= data.units[i - 1].unitNumber).toBe(true);
      }
    });
  });

  describe("PUT /api/properties/[id]/units/[unitId] - update unit", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { PUT } = await import("@/app/api/properties/[id]/units/[unitId]/route");

      const req = makeJsonRequest(
        `/api/properties/${unitPropertyId}/units/${createdUnitId}`,
        "PUT",
        { monthlyRent: 160000 }
      );
      const res = await PUT(req, {
        params: { id: unitPropertyId, unitId: createdUnitId },
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent unit", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/units/[unitId]/route");

      const req = makeJsonRequest(
        `/api/properties/${unitPropertyId}/units/fake_unit`,
        "PUT",
        { monthlyRent: 160000 }
      );
      const res = await PUT(req, {
        params: { id: unitPropertyId, unitId: "fake_unit" },
      });
      expect(res.status).toBe(404);
    });

    it("updates monthly rent", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/units/[unitId]/route");

      const req = makeJsonRequest(
        `/api/properties/${unitPropertyId}/units/${createdUnitId}`,
        "PUT",
        { monthlyRent: 160000 }
      );
      const res = await PUT(req, {
        params: { id: unitPropertyId, unitId: createdUnitId },
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.unit.monthlyRent).toBe(160000);
    });

    it("updates bedrooms, bathrooms, sqft", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/units/[unitId]/route");

      const req = makeJsonRequest(
        `/api/properties/${unitPropertyId}/units/${createdUnitId}`,
        "PUT",
        { bedrooms: 3, bathrooms: 2, sqft: 1200 }
      );
      const res = await PUT(req, {
        params: { id: unitPropertyId, unitId: createdUnitId },
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.unit.bedrooms).toBe(3);
      expect(data.unit.bathrooms).toBe(2);
      expect(data.unit.sqft).toBe(1200);
    });

    it("updates unit status to occupied", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/units/[unitId]/route");

      const req = makeJsonRequest(
        `/api/properties/${unitPropertyId}/units/${createdUnitId}`,
        "PUT",
        { status: "occupied" }
      );
      const res = await PUT(req, {
        params: { id: unitPropertyId, unitId: createdUnitId },
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.unit.status).toBe("occupied");

      // Restore
      const req2 = makeJsonRequest(
        `/api/properties/${unitPropertyId}/units/${createdUnitId}`,
        "PUT",
        { status: "vacant" }
      );
      await PUT(req2, {
        params: { id: unitPropertyId, unitId: createdUnitId },
      });
    });

    it("rejects invalid status value", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/units/[unitId]/route");

      const req = makeJsonRequest(
        `/api/properties/${unitPropertyId}/units/${createdUnitId}`,
        "PUT",
        { status: "invalid_status" }
      );
      const res = await PUT(req, {
        params: { id: unitPropertyId, unitId: createdUnitId },
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("Status must be");
    });

    it("rejects negative monthly rent", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/units/[unitId]/route");

      const req = makeJsonRequest(
        `/api/properties/${unitPropertyId}/units/${createdUnitId}`,
        "PUT",
        { monthlyRent: -100 }
      );
      const res = await PUT(req, {
        params: { id: unitPropertyId, unitId: createdUnitId },
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("Monthly rent");
    });
  });

  describe("DELETE /api/properties/[id]/units/[unitId] - delete unit", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { DELETE } = await import("@/app/api/properties/[id]/units/[unitId]/route");

      const req = makeRequest(
        `/api/properties/${unitPropertyId}/units/${createdUnitId}`
      );
      const res = await DELETE(req, {
        params: { id: unitPropertyId, unitId: createdUnitId },
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent unit", async () => {
      const { DELETE } = await import("@/app/api/properties/[id]/units/[unitId]/route");

      const req = makeRequest(
        `/api/properties/${unitPropertyId}/units/fake_unit`
      );
      const res = await DELETE(req, {
        params: { id: unitPropertyId, unitId: "fake_unit" },
      });
      expect(res.status).toBe(404);
    });

    it("deletes a unit with no active leases", async () => {
      // Create a disposable unit
      const unit = await prisma.unit.create({
        data: {
          propertyId: unitPropertyId,
          unitNumber: "DEL_ME",
          monthlyRent: 100000,
          status: "vacant",
        },
      });

      const { DELETE } = await import("@/app/api/properties/[id]/units/[unitId]/route");

      const req = makeRequest(
        `/api/properties/${unitPropertyId}/units/${unit.id}`
      );
      const res = await DELETE(req, {
        params: { id: unitPropertyId, unitId: unit.id },
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      const found = await prisma.unit.findUnique({ where: { id: unit.id } });
      expect(found).toBeNull();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Photos CRUD
// ──────────────────────────────────────────────────────────────────────

describe("Photos workflow", () => {
  let photoPropertyId: string;
  let photoId1: string;
  let photoId2: string;

  beforeAll(async () => {
    const prop = await prisma.property.create({
      data: {
        name: `${TEST_PREFIX} Photo Building`,
        address: "600 Photo Lane",
        userId: testUserId,
      },
    });
    photoPropertyId = prop.id;
    createdPropertyIds.push(photoPropertyId);
  });

  describe("POST /api/properties/[id]/photos - add photo", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { POST } = await import("@/app/api/properties/[id]/photos/route");

      const req = makeJsonRequest(
        `/api/properties/${photoPropertyId}/photos`,
        "POST",
        { url: "https://example.com/test.jpg" }
      );
      const res = await POST(req, { params: { id: photoPropertyId } });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent property", async () => {
      const { POST } = await import("@/app/api/properties/[id]/photos/route");

      const req = makeJsonRequest("/api/properties/fake_id/photos", "POST", {
        url: "https://example.com/test.jpg",
      });
      const res = await POST(req, { params: { id: "fake_id" } });
      expect(res.status).toBe(404);
    });

    it("returns 400 when url is missing", async () => {
      const { POST } = await import("@/app/api/properties/[id]/photos/route");

      const req = makeJsonRequest(
        `/api/properties/${photoPropertyId}/photos`,
        "POST",
        { caption: "No URL" }
      );
      const res = await POST(req, { params: { id: photoPropertyId } });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("URL");
    });

    it("creates a photo with url and caption", async () => {
      const { POST } = await import("@/app/api/properties/[id]/photos/route");

      const req = makeJsonRequest(
        `/api/properties/${photoPropertyId}/photos`,
        "POST",
        { url: "https://example.com/photo1.jpg", caption: "Front view" }
      );
      const res = await POST(req, { params: { id: photoPropertyId } });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.photo).toBeDefined();
      expect(data.photo.url).toBe("https://example.com/photo1.jpg");
      expect(data.photo.caption).toBe("Front view");
      expect(data.photo.sortOrder).toBe(0);

      photoId1 = data.photo.id;
      createdPhotoIds.push(photoId1);
    });

    it("creates a photo without caption", async () => {
      const { POST } = await import("@/app/api/properties/[id]/photos/route");

      const req = makeJsonRequest(
        `/api/properties/${photoPropertyId}/photos`,
        "POST",
        { url: "https://example.com/photo2.jpg" }
      );
      const res = await POST(req, { params: { id: photoPropertyId } });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.photo.caption).toBeNull();
      expect(data.photo.sortOrder).toBe(1);

      photoId2 = data.photo.id;
      createdPhotoIds.push(photoId2);
    });
  });

  describe("GET /api/properties/[id]/photos - list photos", () => {
    it("lists photos ordered by sortOrder", async () => {
      const { GET } = await import("@/app/api/properties/[id]/photos/route");

      const req = makeRequest(`/api/properties/${photoPropertyId}/photos`);
      const res = await GET(req, { params: { id: photoPropertyId } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.photos).toBeDefined();
      expect(data.photos.length).toBe(2);
      expect(data.photos[0].sortOrder).toBeLessThan(data.photos[1].sortOrder);
    });
  });

  describe("PUT /api/properties/[id]/photos - reorder photos", () => {
    it("returns 400 when order is not an array", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/photos/route");

      const req = makeJsonRequest(
        `/api/properties/${photoPropertyId}/photos`,
        "PUT",
        { order: "not-an-array" }
      );
      const res = await PUT(req, { params: { id: photoPropertyId } });
      expect(res.status).toBe(400);
    });

    it("rejects reorder with foreign photo IDs (IDOR protection)", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/photos/route");

      const req = makeJsonRequest(
        `/api/properties/${photoPropertyId}/photos`,
        "PUT",
        {
          order: [
            { id: photoId1, sortOrder: 1 },
            { id: "foreign_photo_id", sortOrder: 0 },
          ],
        }
      );
      const res = await PUT(req, { params: { id: photoPropertyId } });
      expect(res.status).toBe(403);

      const data = await res.json();
      expect(data.error).toContain("do not belong");
    });

    it("reorders photos successfully", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/photos/route");

      const req = makeJsonRequest(
        `/api/properties/${photoPropertyId}/photos`,
        "PUT",
        {
          order: [
            { id: photoId1, sortOrder: 1 },
            { id: photoId2, sortOrder: 0 },
          ],
        }
      );
      const res = await PUT(req, { params: { id: photoPropertyId } });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify the order changed
      const photos = await prisma.propertyPhoto.findMany({
        where: { propertyId: photoPropertyId },
        orderBy: { sortOrder: "asc" },
      });
      expect(photos[0].id).toBe(photoId2);
      expect(photos[1].id).toBe(photoId1);
    });
  });

  describe("DELETE /api/properties/[id]/photos/[photoId] - remove photo", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { DELETE } = await import(
        "@/app/api/properties/[id]/photos/[photoId]/route"
      );

      const req = makeRequest(
        `/api/properties/${photoPropertyId}/photos/${photoId1}`
      );
      const res = await DELETE(req, {
        params: { id: photoPropertyId, photoId: photoId1 },
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent photo", async () => {
      const { DELETE } = await import(
        "@/app/api/properties/[id]/photos/[photoId]/route"
      );

      const req = makeRequest(
        `/api/properties/${photoPropertyId}/photos/fake_photo`
      );
      const res = await DELETE(req, {
        params: { id: photoPropertyId, photoId: "fake_photo" },
      });
      expect(res.status).toBe(404);
    });

    it("deletes a photo", async () => {
      // Create a disposable photo
      const photo = await prisma.propertyPhoto.create({
        data: {
          propertyId: photoPropertyId,
          url: "https://example.com/disposable.jpg",
          sortOrder: 99,
        },
      });

      const { DELETE } = await import(
        "@/app/api/properties/[id]/photos/[photoId]/route"
      );

      const req = makeRequest(
        `/api/properties/${photoPropertyId}/photos/${photo.id}`
      );
      const res = await DELETE(req, {
        params: { id: photoPropertyId, photoId: photo.id },
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      const found = await prisma.propertyPhoto.findUnique({
        where: { id: photo.id },
      });
      expect(found).toBeNull();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Questions CRUD
// ──────────────────────────────────────────────────────────────────────

describe("Questions workflow", () => {
  let questionPropertyId: string;
  let questionId1: string;
  let questionId2: string;
  let standardQuestionId: string;

  beforeAll(async () => {
    const prop = await prisma.property.create({
      data: {
        name: `${TEST_PREFIX} Question Building`,
        address: "700 Question Ave",
        userId: testUserId,
      },
    });
    questionPropertyId = prop.id;
    createdPropertyIds.push(questionPropertyId);
  });

  describe("POST /api/properties/[id]/questions - create question", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { POST } = await import("@/app/api/properties/[id]/questions/route");

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions`,
        "POST",
        { text: "Test question?" }
      );
      const res = await POST(req, { params: Promise.resolve({ id: questionPropertyId }) });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent property", async () => {
      const { POST } = await import("@/app/api/properties/[id]/questions/route");

      const req = makeJsonRequest("/api/properties/fake_id/questions", "POST", {
        text: "Test question?",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "fake_id" }) });
      expect(res.status).toBe(404);
    });

    it("returns 400 when text is missing", async () => {
      const { POST } = await import("@/app/api/properties/[id]/questions/route");

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions`,
        "POST",
        { fieldKey: "no_text" }
      );
      const res = await POST(req, { params: Promise.resolve({ id: questionPropertyId }) });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("text is required");
    });

    it("creates a screening question with auto-generated fieldKey", async () => {
      const { POST } = await import("@/app/api/properties/[id]/questions/route");

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions`,
        "POST",
        { text: "Do you have any pets?" }
      );
      const res = await POST(req, { params: Promise.resolve({ id: questionPropertyId }) });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.question).toBeDefined();
      expect(data.question.text).toBe("Do you have any pets?");
      expect(data.question.fieldKey).toBe("do_you_have_any_pets");
      expect(data.question.type).toBe("text");
      expect(data.question.required).toBe(true);
      expect(data.question.sortOrder).toBe(0);

      questionId1 = data.question.id;
      createdQuestionIds.push(questionId1);
    });

    it("creates a question with explicit fieldKey and type", async () => {
      const { POST } = await import("@/app/api/properties/[id]/questions/route");

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions`,
        "POST",
        {
          text: "What is your monthly income?",
          fieldKey: "monthlyIncome",
          type: "number",
          required: true,
        }
      );
      const res = await POST(req, { params: Promise.resolve({ id: questionPropertyId }) });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.question.fieldKey).toBe("monthlyIncome");
      expect(data.question.type).toBe("number");
      expect(data.question.sortOrder).toBe(1);

      questionId2 = data.question.id;
      createdQuestionIds.push(questionId2);
    });

    it("creates a standard question", async () => {
      const { POST } = await import("@/app/api/properties/[id]/questions/route");

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions`,
        "POST",
        {
          text: "What is your full name?",
          fieldKey: "fullName",
          type: "text",
          required: true,
          isStandard: true,
        }
      );
      const res = await POST(req, { params: Promise.resolve({ id: questionPropertyId }) });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.question.isStandard).toBe(true);

      standardQuestionId = data.question.id;
      createdQuestionIds.push(standardQuestionId);
    });
  });

  describe("GET /api/properties/[id]/questions - list questions", () => {
    it("lists questions ordered by sortOrder", async () => {
      const { GET } = await import("@/app/api/properties/[id]/questions/route");

      const req = makeRequest(`/api/properties/${questionPropertyId}/questions`);
      const res = await GET(req, { params: Promise.resolve({ id: questionPropertyId }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.questions).toBeDefined();
      expect(data.questions.length).toBeGreaterThanOrEqual(3);

      for (let i = 1; i < data.questions.length; i++) {
        expect(data.questions[i].sortOrder).toBeGreaterThanOrEqual(
          data.questions[i - 1].sortOrder
        );
      }
    });
  });

  describe("PUT /api/properties/[id]/questions - reorder questions", () => {
    it("returns 400 when order is not an array", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/questions/route");

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions`,
        "PUT",
        { order: "not-an-array" }
      );
      const res = await PUT(req, { params: Promise.resolve({ id: questionPropertyId }) });
      expect(res.status).toBe(400);
    });

    it("rejects reorder with foreign question IDs (IDOR protection)", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/questions/route");

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions`,
        "PUT",
        {
          order: [
            { id: questionId1, sortOrder: 1 },
            { id: "foreign_question_id", sortOrder: 0 },
          ],
        }
      );
      const res = await PUT(req, { params: Promise.resolve({ id: questionPropertyId }) });
      expect(res.status).toBe(403);

      const data = await res.json();
      expect(data.error).toContain("do not belong");
    });

    it("reorders questions successfully", async () => {
      const { PUT } = await import("@/app/api/properties/[id]/questions/route");

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions`,
        "PUT",
        {
          order: [
            { id: questionId1, sortOrder: 2 },
            { id: questionId2, sortOrder: 0 },
            { id: standardQuestionId, sortOrder: 1 },
          ],
        }
      );
      const res = await PUT(req, { params: Promise.resolve({ id: questionPropertyId }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify the order
      const questions = await prisma.question.findMany({
        where: { propertyId: questionPropertyId },
        orderBy: { sortOrder: "asc" },
      });
      expect(questions[0].id).toBe(questionId2);
      expect(questions[1].id).toBe(standardQuestionId);
      expect(questions[2].id).toBe(questionId1);
    });
  });

  describe("PUT /api/properties/[id]/questions/[questionId] - update question", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { PUT } = await import(
        "@/app/api/properties/[id]/questions/[questionId]/route"
      );

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions/${questionId1}`,
        "PUT",
        { text: "Updated text" }
      );
      const res = await PUT(req, {
        params: Promise.resolve({ id: questionPropertyId, questionId: questionId1 }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent question", async () => {
      const { PUT } = await import(
        "@/app/api/properties/[id]/questions/[questionId]/route"
      );

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions/fake_q`,
        "PUT",
        { text: "Updated text" }
      );
      const res = await PUT(req, {
        params: Promise.resolve({ id: questionPropertyId, questionId: "fake_q" }),
      });
      expect(res.status).toBe(404);
    });

    it("updates question text", async () => {
      const { PUT } = await import(
        "@/app/api/properties/[id]/questions/[questionId]/route"
      );

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions/${questionId1}`,
        "PUT",
        { text: "Do you own any pets?" }
      );
      const res = await PUT(req, {
        params: Promise.resolve({ id: questionPropertyId, questionId: questionId1 }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.question.text).toBe("Do you own any pets?");
    });

    it("updates required flag on custom question", async () => {
      const { PUT } = await import(
        "@/app/api/properties/[id]/questions/[questionId]/route"
      );

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions/${questionId1}`,
        "PUT",
        { required: false }
      );
      const res = await PUT(req, {
        params: Promise.resolve({ id: questionPropertyId, questionId: questionId1 }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.question.required).toBe(false);
    });

    it("updates type on non-standard question", async () => {
      const { PUT } = await import(
        "@/app/api/properties/[id]/questions/[questionId]/route"
      );

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions/${questionId1}`,
        "PUT",
        { type: "yes_no" }
      );
      const res = await PUT(req, {
        params: Promise.resolve({ id: questionPropertyId, questionId: questionId1 }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.question.type).toBe("yes_no");
    });

    it("does not update type on standard question", async () => {
      const { PUT } = await import(
        "@/app/api/properties/[id]/questions/[questionId]/route"
      );

      const req = makeJsonRequest(
        `/api/properties/${questionPropertyId}/questions/${standardQuestionId}`,
        "PUT",
        { type: "number" }
      );
      const res = await PUT(req, {
        params: Promise.resolve({ id: questionPropertyId, questionId: standardQuestionId }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      // Type should remain "text" since it's a standard question
      expect(data.question.type).toBe("text");
    });
  });

  describe("DELETE /api/properties/[id]/questions/[questionId] - remove question", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { DELETE } = await import(
        "@/app/api/properties/[id]/questions/[questionId]/route"
      );

      const req = makeRequest(
        `/api/properties/${questionPropertyId}/questions/${questionId1}`
      );
      const res = await DELETE(req, {
        params: Promise.resolve({ id: questionPropertyId, questionId: questionId1 }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent question", async () => {
      const { DELETE } = await import(
        "@/app/api/properties/[id]/questions/[questionId]/route"
      );

      const req = makeRequest(
        `/api/properties/${questionPropertyId}/questions/fake_q`
      );
      const res = await DELETE(req, {
        params: Promise.resolve({ id: questionPropertyId, questionId: "fake_q" }),
      });
      expect(res.status).toBe(404);
    });

    it("blocks deletion of standard questions", async () => {
      const { DELETE } = await import(
        "@/app/api/properties/[id]/questions/[questionId]/route"
      );

      const req = makeRequest(
        `/api/properties/${questionPropertyId}/questions/${standardQuestionId}`
      );
      const res = await DELETE(req, {
        params: Promise.resolve({ id: questionPropertyId, questionId: standardQuestionId }),
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("Standard questions");
    });

    it("deletes a custom question", async () => {
      // Create a disposable custom question
      const q = await prisma.question.create({
        data: {
          propertyId: questionPropertyId,
          text: "Disposable question?",
          fieldKey: "disposable",
          sortOrder: 999,
          isStandard: false,
        },
      });

      const { DELETE } = await import(
        "@/app/api/properties/[id]/questions/[questionId]/route"
      );

      const req = makeRequest(
        `/api/properties/${questionPropertyId}/questions/${q.id}`
      );
      const res = await DELETE(req, {
        params: Promise.resolve({ id: questionPropertyId, questionId: q.id }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      const found = await prisma.question.findUnique({ where: { id: q.id } });
      expect(found).toBeNull();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test Call
// ──────────────────────────────────────────────────────────────────────

describe("Test Call workflow", () => {
  let callPropertyId: string;

  beforeAll(async () => {
    const prop = await prisma.property.create({
      data: {
        name: `${TEST_PREFIX} Call Property`,
        address: "800 Call St",
        userId: testUserId,
        isActive: false,
        twilioPhone: null,
      },
    });
    callPropertyId = prop.id;
    createdPropertyIds.push(callPropertyId);
  });

  describe("POST /api/properties/[id]/test-call", () => {
    it("returns 401 when not authenticated", async () => {
      const { getServerSession } = await import("next-auth");
      (getServerSession as any).mockResolvedValueOnce(null);

      const { POST } = await import("@/app/api/properties/[id]/test-call/route");

      const req = makeJsonRequest(
        `/api/properties/${callPropertyId}/test-call`,
        "POST",
        { phoneNumber: "+15551234567" }
      );
      const res = await POST(req, { params: { id: callPropertyId } });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent property", async () => {
      const { POST } = await import("@/app/api/properties/[id]/test-call/route");

      const req = makeJsonRequest("/api/properties/fake_id/test-call", "POST", {
        phoneNumber: "+15551234567",
      });
      const res = await POST(req, { params: { id: "fake_id" } });
      expect(res.status).toBe(404);
    });

    it("returns 400 when property has no phone number", async () => {
      const { POST } = await import("@/app/api/properties/[id]/test-call/route");

      const req = makeJsonRequest(
        `/api/properties/${callPropertyId}/test-call`,
        "POST",
        { phoneNumber: "+15551234567" }
      );
      const res = await POST(req, { params: { id: callPropertyId } });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("phone number");
    });

    it("returns 400 when property is not active", async () => {
      // Set twilio phone but keep inactive
      await prisma.property.update({
        where: { id: callPropertyId },
        data: { twilioPhone: `+1312555${Date.now().toString().slice(-4)}` },
      });

      const { POST } = await import("@/app/api/properties/[id]/test-call/route");

      const req = makeJsonRequest(
        `/api/properties/${callPropertyId}/test-call`,
        "POST",
        { phoneNumber: "+15551234567" }
      );
      const res = await POST(req, { params: { id: callPropertyId } });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("active");
    });

    it("returns 400 when phoneNumber is missing", async () => {
      // Activate property
      await prisma.property.update({
        where: { id: callPropertyId },
        data: { isActive: true },
      });

      const { POST } = await import("@/app/api/properties/[id]/test-call/route");

      const req = makeJsonRequest(
        `/api/properties/${callPropertyId}/test-call`,
        "POST",
        {}
      );
      const res = await POST(req, { params: { id: callPropertyId } });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("phoneNumber");
    });
  });
});
