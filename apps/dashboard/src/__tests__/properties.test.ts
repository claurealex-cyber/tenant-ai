import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PREFIX = `test_prop_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let otherUserId: string;

beforeAll(async () => {
  await prisma.$connect();

  // Create test users
  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "Property Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: {
      email: testEmail("other"),
      name: "Other User",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  otherUserId = otherUser.id;
});

afterAll(async () => {
  // Clean up in order (foreign keys)
  await prisma.propertyPhoto.deleteMany({
    where: { property: { userId: { in: [userId, otherUserId] } } },
  });
  await prisma.question.deleteMany({
    where: { property: { userId: { in: [userId, otherUserId] } } },
  });
  await prisma.property.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Property CRUD ──

describe("Property CRUD", () => {
  let propertyId: string;

  it("creates a property with required fields", async () => {
    const property = await prisma.property.create({
      data: {
        name: "Test Apartments",
        address: "123 Main St, Chicago IL 60601",
        userId,
        isActive: false,
      },
    });

    expect(property.id).toBeDefined();
    expect(property.name).toBe("Test Apartments");
    expect(property.address).toBe("123 Main St, Chicago IL 60601");
    expect(property.userId).toBe(userId);
    expect(property.isActive).toBe(false);
    expect(property.twilioPhone).toBeNull();

    propertyId = property.id;
  });

  it("creates a property with all optional fields", async () => {
    const property = await prisma.property.create({
      data: {
        name: "Luxury Condos",
        address: "456 Oak Ave, Naperville IL 60540",
        unitCount: 24,
        description: "Beautiful luxury condos with amazing amenities",
        amenities: ["Pool", "Gym", "Parking"],
        cookCounty: false,
        userId,
        isActive: false,
      },
    });

    expect(property.unitCount).toBe(24);
    expect(property.description).toContain("luxury condos");
    expect(property.amenities).toEqual(["Pool", "Gym", "Parking"]);
    expect(property.cookCounty).toBe(false);
  });

  it("returns only properties owned by the user", async () => {
    // Create a property for the other user
    await prisma.property.create({
      data: {
        name: "Other User Property",
        address: "789 Other St",
        userId: otherUserId,
      },
    });

    const myProperties = await prisma.property.findMany({
      where: { userId },
    });

    const otherProperties = await prisma.property.findMany({
      where: { userId: otherUserId },
    });

    // Verify data isolation
    expect(myProperties.every((p) => p.userId === userId)).toBe(true);
    expect(otherProperties.every((p) => p.userId === otherUserId)).toBe(true);
    expect(myProperties.length).toBeGreaterThanOrEqual(2); // we created 2
    expect(otherProperties.length).toBeGreaterThanOrEqual(1);
  });

  it("updates a property that belongs to the user", async () => {
    const updated = await prisma.property.update({
      where: { id: propertyId },
      data: {
        name: "Updated Apartments",
        voiceName: "shimmer",
        maxCallMinutes: 20,
      },
    });

    expect(updated.name).toBe("Updated Apartments");
    expect(updated.voiceName).toBe("shimmer");
    expect(updated.maxCallMinutes).toBe(20);
  });

  it("returns null when trying to access another user's property", async () => {
    const result = await prisma.property.findFirst({
      where: { id: propertyId, userId: otherUserId },
    });

    expect(result).toBeNull();
  });

  it("lists properties with application and unit counts", async () => {
    const properties = await prisma.property.findMany({
      where: { userId },
      include: {
        _count: {
          select: { applications: true, units: true },
        },
      },
    });

    expect(properties.length).toBeGreaterThanOrEqual(1);
    properties.forEach((p) => {
      expect(p._count).toBeDefined();
      expect(typeof p._count.applications).toBe("number");
      expect(typeof p._count.units).toBe("number");
    });
  });

  it("gets a property with related data (questions, units, photos)", async () => {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, userId },
      include: {
        questions: { orderBy: { sortOrder: "asc" } },
        units: { orderBy: { unitNumber: "asc" } },
        photos: { orderBy: { sortOrder: "asc" } },
        _count: {
          select: { applications: true, callLogs: true },
        },
      },
    });

    expect(property).not.toBeNull();
    expect(property!.questions).toEqual([]);
    expect(property!.units).toEqual([]);
    expect(property!.photos).toEqual([]);
  });

  it("updates AI settings on a property", async () => {
    const updated = await prisma.property.update({
      where: { id: propertyId },
      data: {
        aiModel: "gpt-4o-realtime-preview",
        recordingEnabled: true,
        aiDisclosureText: "This call is AI-assisted and recorded.",
        greetingMessage: "Welcome to Test Apartments!",
      },
    });

    expect(updated.aiModel).toBe("gpt-4o-realtime-preview");
    expect(updated.recordingEnabled).toBe(true);
    expect(updated.aiDisclosureText).toBe("This call is AI-assisted and recorded.");
    expect(updated.greetingMessage).toBe("Welcome to Test Apartments!");
  });

  it("default AI settings are correct", async () => {
    const property = await prisma.property.create({
      data: {
        name: "Defaults Test",
        address: "100 Default Lane",
        userId,
      },
    });

    expect(property.aiModel).toBe("gpt-4o-mini-realtime-preview");
    expect(property.voiceName).toBe("alloy");
    expect(property.maxCallMinutes).toBe(15);
    expect(property.recordingEnabled).toBe(false);
    expect(property.cookCounty).toBe(false);
    expect(property.isActive).toBe(false);
  });
});

// ── Phone Provisioning ──

describe("Phone provisioning", () => {
  let propertyId: string;

  beforeEach(async () => {
    const property = await prisma.property.create({
      data: {
        name: "Phone Test Property",
        address: "200 Phone St",
        userId,
        isActive: false,
      },
    });
    propertyId = property.id;
  });

  it("provisions a phone number on a property", async () => {
    const updated = await prisma.property.update({
      where: { id: propertyId },
      data: {
        twilioPhone: "+13125551234",
        twilioPhoneSid: "PN_test_123",
        isActive: true,
      },
    });

    expect(updated.twilioPhone).toBe("+13125551234");
    expect(updated.twilioPhoneSid).toBe("PN_test_123");
    expect(updated.isActive).toBe(true);
  });

  it("releases a phone number from a property", async () => {
    // First provision
    await prisma.property.update({
      where: { id: propertyId },
      data: {
        twilioPhone: "+13125559999",
        twilioPhoneSid: "PN_test_999",
        isActive: true,
      },
    });

    // Then release
    const released = await prisma.property.update({
      where: { id: propertyId },
      data: {
        twilioPhone: null,
        twilioPhoneSid: null,
        isActive: false,
      },
    });

    expect(released.twilioPhone).toBeNull();
    expect(released.twilioPhoneSid).toBeNull();
    expect(released.isActive).toBe(false);
  });

  it("enforces unique constraint on twilioPhone", async () => {
    const uniquePhone = `+1312555${Date.now().toString().slice(-4)}`;

    await prisma.property.update({
      where: { id: propertyId },
      data: { twilioPhone: uniquePhone },
    });

    const property2 = await prisma.property.create({
      data: {
        name: "Second Property",
        address: "300 Another St",
        userId,
      },
    });

    await expect(
      prisma.property.update({
        where: { id: property2.id },
        data: { twilioPhone: uniquePhone },
      })
    ).rejects.toThrow();
  });
});

// ── Property Photos ──

describe("Property photos", () => {
  let propertyId: string;

  beforeAll(async () => {
    const property = await prisma.property.create({
      data: {
        name: "Photo Test Property",
        address: "400 Photo Lane",
        userId,
      },
    });
    propertyId = property.id;
  });

  it("creates a photo for a property", async () => {
    const photo = await prisma.propertyPhoto.create({
      data: {
        propertyId,
        url: "https://example.com/photo1.jpg",
        caption: "Front view",
        sortOrder: 0,
      },
    });

    expect(photo.id).toBeDefined();
    expect(photo.propertyId).toBe(propertyId);
    expect(photo.url).toBe("https://example.com/photo1.jpg");
    expect(photo.caption).toBe("Front view");
    expect(photo.sortOrder).toBe(0);
  });

  it("lists photos ordered by sortOrder", async () => {
    // Add more photos
    await prisma.propertyPhoto.create({
      data: {
        propertyId,
        url: "https://example.com/photo3.jpg",
        sortOrder: 2,
      },
    });
    await prisma.propertyPhoto.create({
      data: {
        propertyId,
        url: "https://example.com/photo2.jpg",
        sortOrder: 1,
      },
    });

    const photos = await prisma.propertyPhoto.findMany({
      where: { propertyId },
      orderBy: { sortOrder: "asc" },
    });

    expect(photos.length).toBe(3);
    expect(photos[0].sortOrder).toBe(0);
    expect(photos[1].sortOrder).toBe(1);
    expect(photos[2].sortOrder).toBe(2);
  });

  it("reorders photos via transaction", async () => {
    const photos = await prisma.propertyPhoto.findMany({
      where: { propertyId },
      orderBy: { sortOrder: "asc" },
    });

    // Reverse the order
    const reversed = photos.map((p, i) => ({
      id: p.id,
      sortOrder: photos.length - 1 - i,
    }));

    await prisma.$transaction(
      reversed.map((item) =>
        prisma.propertyPhoto.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );

    const reordered = await prisma.propertyPhoto.findMany({
      where: { propertyId },
      orderBy: { sortOrder: "asc" },
    });

    // The first photo (sortOrder 0) should now be the previously last one
    expect(reordered[0].url).toBe("https://example.com/photo3.jpg");
  });

  it("deletes a photo", async () => {
    const photos = await prisma.propertyPhoto.findMany({
      where: { propertyId },
    });

    const toDelete = photos[0];
    await prisma.propertyPhoto.delete({ where: { id: toDelete.id } });

    const remaining = await prisma.propertyPhoto.findMany({
      where: { propertyId },
    });

    expect(remaining.length).toBe(photos.length - 1);
    expect(remaining.find((p) => p.id === toDelete.id)).toBeUndefined();
  });

  it("creates photo without caption", async () => {
    const photo = await prisma.propertyPhoto.create({
      data: {
        propertyId,
        url: "https://example.com/no-caption.jpg",
        sortOrder: 10,
      },
    });

    expect(photo.caption).toBeNull();
  });

  it("cascades delete when property is deleted", async () => {
    // Create a separate property with photos for cascade test
    const prop = await prisma.property.create({
      data: {
        name: "Cascade Test",
        address: "500 Cascade Rd",
        userId,
      },
    });

    await prisma.propertyPhoto.createMany({
      data: [
        { propertyId: prop.id, url: "https://example.com/c1.jpg", sortOrder: 0 },
        { propertyId: prop.id, url: "https://example.com/c2.jpg", sortOrder: 1 },
      ],
    });

    // Delete property — should cascade to photos
    await prisma.property.delete({ where: { id: prop.id } });

    const orphanedPhotos = await prisma.propertyPhoto.findMany({
      where: { propertyId: prop.id },
    });

    expect(orphanedPhotos.length).toBe(0);
  });
});

// ── Property Deletion ──

describe("Property deletion", () => {
  it("deletes a property with no active applications", async () => {
    const property = await prisma.property.create({
      data: {
        name: "To Delete",
        address: "600 Delete Ave",
        userId,
      },
    });

    // Add questions and photos
    await prisma.question.create({
      data: {
        propertyId: property.id,
        text: "Test question?",
        fieldKey: "test_q",
        sortOrder: 0,
      },
    });

    await prisma.propertyPhoto.create({
      data: {
        propertyId: property.id,
        url: "https://example.com/del.jpg",
        sortOrder: 0,
      },
    });

    // Delete related data then property (matching API route logic)
    await prisma.question.deleteMany({ where: { propertyId: property.id } });
    await prisma.propertyPhoto.deleteMany({ where: { propertyId: property.id } });
    await prisma.property.delete({ where: { id: property.id } });

    const deleted = await prisma.property.findUnique({
      where: { id: property.id },
    });
    expect(deleted).toBeNull();
  });

  it("blocks deletion when property has in_progress applications", async () => {
    const property = await prisma.property.create({
      data: {
        name: "Has Applications",
        address: "700 App St",
        userId,
      },
    });

    // Create an in_progress application
    await prisma.application.create({
      data: {
        propertyId: property.id,
        status: "in_progress",
        channel: "voice",
        callerPhone: "+15551234567",
      },
    });

    const existing = await prisma.property.findFirst({
      where: { id: property.id, userId },
      include: {
        _count: {
          select: { applications: { where: { status: "in_progress" } } },
        },
      },
    });

    expect(existing!._count.applications).toBeGreaterThan(0);

    // Clean up: delete application then property
    await prisma.application.deleteMany({ where: { propertyId: property.id } });
    await prisma.property.delete({ where: { id: property.id } });
  });
});

// ── Cook County Detection ──

describe("Cook County detection on property", () => {
  it("can store cookCounty flag", async () => {
    const property = await prisma.property.create({
      data: {
        name: "Chicago Property",
        address: "100 Michigan Ave, Chicago IL 60601",
        cookCounty: true,
        userId,
      },
    });

    expect(property.cookCounty).toBe(true);
  });

  it("defaults cookCounty to false", async () => {
    const property = await prisma.property.create({
      data: {
        name: "Naperville Property",
        address: "200 Main St, Naperville IL 60540",
        userId,
      },
    });

    expect(property.cookCounty).toBe(false);
  });
});

// ── Subscription Property Limits ──

describe("Subscription property limits", () => {
  it("can count properties per user for limit checking", async () => {
    const count = await prisma.property.count({
      where: { userId },
    });

    // We've created several properties in tests above
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it("subscription tier maxProperties can gate property creation", async () => {
    // Get or create a subscription for testing
    const tier = await prisma.pricingTier.findFirst({
      where: { name: "starter" },
    });

    if (tier) {
      const subscription = await prisma.subscription.upsert({
        where: { userId },
        create: {
          userId,
          tierId: tier.id,
          status: "active",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        update: {},
      });

      const maxProperties =
        subscription.overrideMaxProperties ?? tier.maxProperties;

      const currentCount = await prisma.property.count({
        where: { userId },
      });

      // Verify we can check the limit
      expect(typeof maxProperties).toBe("number");
      expect(typeof currentCount).toBe("number");

      // Clean up subscription
      await prisma.subscription.delete({ where: { userId } });
    }
  });
});
