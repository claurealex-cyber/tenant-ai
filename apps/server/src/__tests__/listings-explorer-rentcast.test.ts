import { describe, it, expect, vi, beforeEach } from "vitest";
const cfg: Record<string, string | null> = { "rentcast.api_key": "test-key" };
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return { ...actual, resolveConfig: async (ns: string, k: string) => cfg[`${ns}.${k}`] ?? null };
});
import { makeRentCastProvider, type Fetcher } from "../services/listings-explorer/rentcast-provider.js";

const ROWS = [
  { addressLine1: "1527 W Juneway Ter", propertyType: "Single Family", bedrooms: 4, bathrooms: 3, squareFootage: 2200, price: 795000, status: "Active", zipCode: "60626", mlsNumber: "M1" },
  { addressLine1: "6812 N Wayne Ave", addressLine2: "1D", propertyType: "Condo", bedrooms: 0, bathrooms: 1, price: 110000, status: "Active", zipCode: "60626" },
  { addressLine1: "1615 W Greenleaf Ave", addressLine2: "F", propertyType: "Townhouse", bedrooms: 3, bathrooms: 2, price: 389000, status: "Active", zipCode: "60626" },
  { addressLine1: "1745 W North Shore Ave", propertyType: "Multi-Family", bedrooms: 4, bathrooms: 2, price: 549000, status: "Active", zipCode: "60626" },
  { addressLine1: "7441 N Rogers Ave", propertyType: "Single Family", bedrooms: 12, bathrooms: 6, price: 1690000, status: "Active", zipCode: "60626" }, // mislabeled 12-unit → multi
  { addressLine1: "1839 W Touhy Ave", propertyType: "Land", price: 495000, status: "Active", zipCode: "60626" }, // skip
  { addressLine1: "100 Coop Ln", propertyType: "Co-op", bedrooms: 2, price: 200000, status: "Active", zipCode: "60626" }, // skip
  { addressLine1: "200 Sold St", propertyType: "Condo", bedrooms: 1, price: 150000, status: "Inactive", zipCode: "60626" }, // skip non-active
];

const provider = () => makeRentCastProvider({ fetch: (async () => ({ ok: true, status: 200, async json() { return ROWS; } })) as unknown as Fetcher });
const AREA = { name: "Rogers Park", zips: ["60626"] };
beforeEach(() => { cfg["rentcast.api_key"] = "test-key"; });

describe("RentCastProvider", () => {
  it("returns all four kept types; skips land, co-op, and non-active", async () => {
    const r = await provider().fetchArea(AREA, {});
    const types = r.map((x) => x.propertyType).sort();
    expect(r).toHaveLength(5); // 4 kept + the mislabeled multi; land/coop/inactive dropped
    expect(types).toEqual(["condo", "multi", "multi", "single_family", "townhome"]);
    expect(r.every((x) => x.status === "active")).toBe(true);
  });
  it("classifies the mislabeled 12-unit as multi (signal)", async () => {
    const r = await provider().fetchArea(AREA, {});
    const big = r.find((x) => x.address.includes("7441 N Rogers"));
    expect(big!.propertyType).toBe("multi");
    expect(big!.typeSource).toBe("signal");
  });
  it("applies type + price filters", async () => {
    const condosUnder200 = await provider().fetchArea(AREA, { types: ["condo"], priceMax: 200000 });
    expect(condosUnder200.map((x) => x.address)).toEqual(["6812 N Wayne Ave"]);
  });
  it("no key → fail-soft no-op", async () => {
    cfg["rentcast.api_key"] = null;
    expect(await provider().fetchArea(AREA, {})).toEqual([]);
  });
});
