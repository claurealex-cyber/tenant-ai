import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PREFIX = `test_units_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "Unit Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "Unit Test Property",
      address: "100 Unit Ave",
      userId,
    },
  });
  propertyId = property.id;
});

afterAll(async () => {
  await prisma.unit.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Unit Creation ──

describe("Unit creation", () => {
  it("creates a unit with all fields", async () => {
    const unit = await prisma.unit.create({
      data: {
        propertyId,
        unitNumber: "101",
        bedrooms: 2,
        bathrooms: 1.5,
        sqft: 950,
        monthlyRent: 150000, // $1,500.00
        status: "vacant",
      },
    });

    expect(unit.id).toBeDefined();
    expect(unit.propertyId).toBe(propertyId);
    expect(unit.unitNumber).toBe("101");
    expect(unit.bedrooms).toBe(2);
    expect(unit.bathrooms).toBe(1.5);
    expect(unit.sqft).toBe(950);
    expect(unit.monthlyRent).toBe(150000);
    expect(unit.status).toBe("vacant");
  });

  it("creates a unit with only required fields", async () => {
    const unit = await prisma.unit.create({
      data: {
        propertyId,
        unitNumber: "102",
        monthlyRent: 120000,
      },
    });

    expect(unit.unitNumber).toBe("102");
    expect(unit.monthlyRent).toBe(120000);
    expect(unit.bedrooms).toBeNull();
    expect(unit.bathrooms).toBeNull();
    expect(unit.sqft).toBeNull();
    expect(unit.status).toBe("vacant"); // default
  });

  it("supports string unit numbers (e.g. 2B, Apt 3)", async () => {
    const unit = await prisma.unit.create({
      data: {
        propertyId,
        unitNumber: "2B",
        monthlyRent: 180000,
      },
    });

    expect(unit.unitNumber).toBe("2B");
  });

  it("enforces unique unitNumber within the same property", async () => {
    await expect(
      prisma.unit.create({
        data: {
          propertyId,
          unitNumber: "101", // Already exists
          monthlyRent: 100000,
        },
      })
    ).rejects.toThrow();
  });

  it("allows same unitNumber on different properties", async () => {
    const otherProp = await prisma.property.create({
      data: {
        name: "Other Property",
        address: "200 Other St",
        userId,
      },
    });

    const unit = await prisma.unit.create({
      data: {
        propertyId: otherProp.id,
        unitNumber: "101", // Same as first property, different property
        monthlyRent: 130000,
      },
    });

    expect(unit.unitNumber).toBe("101");
    expect(unit.propertyId).toBe(otherProp.id);

    // Clean up
    await prisma.unit.deleteMany({ where: { propertyId: otherProp.id } });
    await prisma.property.delete({ where: { id: otherProp.id } });
  });
});

// ── Unit Listing ──

describe("Unit listing", () => {
  it("lists units ordered by unitNumber", async () => {
    const units = await prisma.unit.findMany({
      where: { propertyId },
      orderBy: { unitNumber: "asc" },
    });

    expect(units.length).toBeGreaterThanOrEqual(3);
    // Verify ascending order
    for (let i = 1; i < units.length; i++) {
      expect(units[i].unitNumber >= units[i - 1].unitNumber).toBe(true);
    }
  });

  it("returns only units for the specified property", async () => {
    const units = await prisma.unit.findMany({
      where: { propertyId },
    });

    expect(units.every((u) => u.propertyId === propertyId)).toBe(true);
  });
});

// ── Unit Update ──

describe("Unit update", () => {
  it("updates rent amount", async () => {
    const unit = await prisma.unit.findFirst({
      where: { propertyId, unitNumber: "101" },
    });

    const updated = await prisma.unit.update({
      where: { id: unit!.id },
      data: { monthlyRent: 160000 },
    });

    expect(updated.monthlyRent).toBe(160000);
  });

  it("updates unit status", async () => {
    const unit = await prisma.unit.findFirst({
      where: { propertyId, unitNumber: "101" },
    });

    const updated = await prisma.unit.update({
      where: { id: unit!.id },
      data: { status: "occupied" },
    });

    expect(updated.status).toBe("occupied");

    // Restore
    await prisma.unit.update({
      where: { id: unit!.id },
      data: { status: "vacant" },
    });
  });

  it("updates bedrooms, bathrooms, sqft", async () => {
    const unit = await prisma.unit.findFirst({
      where: { propertyId, unitNumber: "102" },
    });

    const updated = await prisma.unit.update({
      where: { id: unit!.id },
      data: { bedrooms: 3, bathrooms: 2, sqft: 1200 },
    });

    expect(updated.bedrooms).toBe(3);
    expect(updated.bathrooms).toBe(2);
    expect(updated.sqft).toBe(1200);
  });

  it("supports all valid status values", async () => {
    const unit = await prisma.unit.findFirst({
      where: { propertyId, unitNumber: "102" },
    });

    for (const status of ["vacant", "occupied", "maintenance"]) {
      const updated = await prisma.unit.update({
        where: { id: unit!.id },
        data: { status },
      });
      expect(updated.status).toBe(status);
    }

    // Restore
    await prisma.unit.update({
      where: { id: unit!.id },
      data: { status: "vacant" },
    });
  });
});

// ── Unit Deletion ──

describe("Unit deletion", () => {
  it("deletes a vacant unit", async () => {
    const unit = await prisma.unit.create({
      data: {
        propertyId,
        unitNumber: "DELETE_ME",
        monthlyRent: 100000,
        status: "vacant",
      },
    });

    await prisma.unit.delete({ where: { id: unit.id } });

    const found = await prisma.unit.findUnique({ where: { id: unit.id } });
    expect(found).toBeNull();
  });

  it("cascades delete when property is deleted", async () => {
    const prop = await prisma.property.create({
      data: {
        name: "Cascade Unit Test",
        address: "300 Cascade Rd",
        userId,
      },
    });

    await prisma.unit.createMany({
      data: [
        { propertyId: prop.id, unitNumber: "A1", monthlyRent: 100000 },
        { propertyId: prop.id, unitNumber: "A2", monthlyRent: 110000 },
        { propertyId: prop.id, unitNumber: "A3", monthlyRent: 120000 },
      ],
    });

    await prisma.property.delete({ where: { id: prop.id } });

    const orphaned = await prisma.unit.findMany({
      where: { propertyId: prop.id },
    });
    expect(orphaned.length).toBe(0);
  });
});

// ── Rent in Cents ──

describe("Rent stored in cents", () => {
  it("stores and retrieves rent as integer cents", async () => {
    const unit = await prisma.unit.create({
      data: {
        propertyId,
        unitNumber: "CENTS",
        monthlyRent: 149950, // $1,499.50
      },
    });

    expect(unit.monthlyRent).toBe(149950);

    // Verify dollar conversion
    const dollars = unit.monthlyRent / 100;
    expect(dollars).toBe(1499.5);

    // Clean up
    await prisma.unit.delete({ where: { id: unit.id } });
  });
});
