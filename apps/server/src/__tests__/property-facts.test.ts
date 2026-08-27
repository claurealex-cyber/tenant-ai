import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { buildPropertyFacts, formatRent } from "../services/property-facts.js";
import { toSingleSms } from "../handlers/intake-qa.js";

const prisma = new PrismaClient();
const P = `test_facts_${Date.now()}`;
let userId: string, withUnits: string, noUnits: string, bare: string;

beforeAll(async () => {
  await prisma.$connect();
  const u = await prisma.user.create({ data: { email: `${P}@t.com`, name: "F", passwordHash: await bcrypt.hash("x", 4), role: "client", onboarded: true } });
  userId = u.id;
  const p1 = await prisma.property.create({ data: { name: `${P}_units`, address: "1 A St, Chicago IL", userId, isActive: true, amenities: ["Gym", "Roof deck"], petPolicy: "Cats OK" } });
  withUnits = p1.id;
  await prisma.unit.create({ data: { propertyId: p1.id, unitNumber: "2B", bedrooms: 2, bathrooms: 1, sqft: 900, monthlyRent: 125000, status: "vacant", utilitiesIncluded: "heat", laundry: "in-unit" } });
  await prisma.unit.create({ data: { propertyId: p1.id, unitNumber: "3A", bedrooms: 1, bathrooms: 1, monthlyRent: 99500, status: "occupied" } });
  const p2 = await prisma.property.create({ data: { name: `${P}_desc`, address: "2 B St, Chicago IL", userId, isActive: true, description: "Studios from $1,100/mo, cats welcome." } });
  noUnits = p2.id;
  const p3 = await prisma.property.create({ data: { name: `${P}_bare`, address: "3 C St, Chicago IL", userId, isActive: true } });
  bare = p3.id;
});
afterAll(async () => {
  await prisma.unit.deleteMany({ where: { propertyId: { in: [withUnits, noUnits, bare] } } });
  await prisma.property.deleteMany({ where: { id: { in: [withUnits, noUnits, bare] } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("formatRent", () => {
  it("cents → $X/mo, null-safe", () => {
    expect(formatRent(125000)).toBe("$1,250/mo");
    expect(formatRent(99500)).toBe("$995/mo");
    expect(formatRent(null)).toBeNull();
    expect(formatRent(undefined)).toBeNull();
  });
});

describe("buildPropertyFacts", () => {
  it("lists units with rent, beds, status", async () => {
    const { facts, hasUnits, hasAnyFacts } = await buildPropertyFacts(withUnits);
    expect(hasUnits).toBe(true);
    expect(hasAnyFacts).toBe(true);
    expect(facts).toContain("$1,250/mo");
    expect(facts).toContain("2 bed/1 bath/900 sqft");
    expect(facts).toContain("available now");
    expect(facts).toContain("occupied");
    expect(facts).toContain("Gym, Roof deck");
  });
  it("falls back to Description as LISTING NOTES when there are no units", async () => {
    const { facts, hasUnits, hasAnyFacts } = await buildPropertyFacts(noUnits);
    expect(hasUnits).toBe(false);
    expect(hasAnyFacts).toBe(true);
    expect(facts).toContain("LISTING NOTES");
    expect(facts).toContain("Studios from $1,100/mo");
  });
  it("hasAnyFacts is false for a bare property", async () => {
    const { hasUnits, hasAnyFacts } = await buildPropertyFacts(bare);
    expect(hasUnits).toBe(false);
    expect(hasAnyFacts).toBe(false);
  });
});

describe("toSingleSms", () => {
  it("returns short text unchanged", () => {
    expect(toSingleSms("The 2 bedroom is $1,250/mo, available now.")).toBe("The 2 bedroom is $1,250/mo, available now.");
  });
  it("caps a long answer to ONE message at a sentence boundary", () => {
    const long = "Sentence one is here. Sentence two adds detail. ".repeat(20);
    const out = toSingleSms(long);
    expect(out.length).toBeLessThanOrEqual(480);
    expect(out.endsWith(".")).toBe(true);
  });
});
