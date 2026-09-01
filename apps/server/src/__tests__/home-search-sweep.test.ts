import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runSweep } from "../services/home-search/sweep.js";
import { makeFixtureProvider } from "../services/home-search/fixture-provider.js";
import type { Candidate, Listing } from "../services/home-search/types.js";

const prisma = new PrismaClient();
const TAG = `999 Test Sweep St ${Date.now()}`; // unique address so we can find+clean our rows

const A: Candidate = { source: "movoto", url: "s-a", address: TAG, unit: "1", priceHint: 240000, bedsHint: 2 };
const B: Candidate = { source: "movoto", url: "s-b", address: `${TAG} Two`, unit: "2", priceHint: 600000, bedsHint: 3 };
const VMAP: Record<string, Partial<Listing> & { status?: Listing["status"] }> = {
  "s-a": { status: "active", price: 240000, beds: 2, remarks: "move-in ready" },
  "s-b": { status: "active", price: 600000, beds: 3, remarks: "updated" },
};
const providerFor = () => makeFixtureProvider([A, B], VMAP);

beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => {
  await prisma.chicagoListing.deleteMany({ where: { address: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("home-search city-wide sweep", () => {
  it("compiles verified listings into ChicagoListing, tags neighborhood, stores ALL prices", async () => {
    const r = await runSweep({ areas: ["Wicker Park"], providerFor });
    expect(r.newRows).toBe(2); // both active+quality stored regardless of price ($240k AND $600k)
    const rows = await prisma.chicagoListing.findMany({ where: { address: { startsWith: TAG } } });
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.neighborhood === "Wicker Park")).toBe(true);
    expect(rows.map((x) => x.price).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([240000, 600000]);
  });

  it("city-wide dedup: sweeping another area with the same properties does NOT duplicate", async () => {
    const before = await prisma.chicagoListing.count({ where: { address: { startsWith: TAG } } });
    await runSweep({ areas: ["Bucktown"], providerFor }); // same fixture candidates
    const after = await prisma.chicagoListing.count({ where: { address: { startsWith: TAG } } });
    expect(after).toBe(before); // updated, not duplicated (unique listingId city-wide)
  });

  it("respects maxAreas budget guard", async () => {
    const r = await runSweep({ areas: ["Wicker Park", "Bucktown", "Logan Square"], maxAreas: 2, providerFor });
    expect(r.areasSwept).toHaveLength(2);
  });
});
