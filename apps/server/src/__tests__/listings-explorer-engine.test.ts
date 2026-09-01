import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { compileAreas } from "../services/listings-explorer/engine.js";
import { makeFixtureProvider } from "../services/listings-explorer/fixture-provider.js";
import { listingKey, type Listing } from "../services/listings-explorer/types.js";

const prisma = new PrismaClient();
const TAG = `999 Explorer Test ${Date.now()}`;
const mk = (addr: string, unit: string | null, type: Listing["propertyType"], price: number): Listing => ({
  listingId: listingKey(addr, unit), source: "fixture", address: addr, unit, propertyType: type, price, status: "active", beds: 2,
});
const LISTINGS: Listing[] = [
  mk(`${TAG} A Ave`, "1", "condo", 240000),
  mk(`${TAG} B St`, null, "single_family", 700000),
  mk(`${TAG} C Ave`, "1", "multi", 900000),
  mk(`${TAG} Hermitage Ave`, "1", "condo", 459000), // twin building units, same price →
  mk(`${TAG} Hermitag2 Ave`, "1", "condo", 459000), // must stay two distinct rows
];
const provider = makeFixtureProvider(LISTINGS);

beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => { await prisma.explorerListing.deleteMany({ where: { address: { startsWith: TAG } } }); await prisma.$disconnect(); });

describe("listings-explorer engine", () => {
  it("compiles all types + twin same-price units stay distinct", async () => {
    const r = await compileAreas(["Rogers Park"], {}, { provider });
    expect(r.newRows).toBe(5);
    const rows = await prisma.explorerListing.findMany({ where: { address: { startsWith: TAG } } });
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((x) => x.propertyType))).toEqual(new Set(["condo", "single_family", "multi"]));
  });
  it("re-compile dedups (no duplicates)", async () => {
    const before = await prisma.explorerListing.count({ where: { address: { startsWith: TAG } } });
    await compileAreas(["Bucktown"], {}, { provider });
    const after = await prisma.explorerListing.count({ where: { address: { startsWith: TAG } } });
    expect(after).toBe(before);
  });
  it("concurrency guard: a second concurrent compile is skipped", async () => {
    const slow = { name: "slow", async fetchArea() { await new Promise((r) => setTimeout(r, 60)); return []; } };
    const [a, b] = await Promise.all([
      compileAreas(["Wicker Park"], {}, { provider: slow as any }),
      compileAreas(["Logan Square"], {}, { provider: slow as any }),
    ]);
    expect([a, b].filter((x) => x.skipped)).toHaveLength(1);
  });
});
