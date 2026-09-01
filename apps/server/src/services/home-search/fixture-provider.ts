import type { ListingProvider, ListingFilter, Candidate, Listing } from "./types.js";
import { listingKey, assessQuality } from "./types.js";

/**
 * Deterministic provider for tests + zero-cost local runs. Returns a fixed set of
 * candidates and a canned verify() so the engine can be exercised with no network,
 * no API keys, and no LLM.
 */
export function makeFixtureProvider(
  candidates: Candidate[],
  verifyMap: Record<string, Partial<Listing> & { status?: Listing["status"] }>,
): ListingProvider {
  return {
    name: "fixture",
    async discover(_filter: ListingFilter) {
      return candidates;
    },
    async verify(c: Candidate) {
      const v = verifyMap[c.url];
      if (!v) return null; // unverifiable → dropped (mirrors real behavior)
      const q = assessQuality(v.remarks);
      return {
        listingId: listingKey(c.address, c.unit),
        source: c.source,
        sourceUrl: c.url,
        canonicalUrl: v.canonicalUrl ?? c.url,
        address: c.address,
        unit: c.unit ?? null,
        zip: v.zip ?? null,
        lat: v.lat ?? null,
        lng: v.lng ?? null,
        price: v.price ?? c.priceHint ?? null,
        beds: v.beds ?? c.bedsHint ?? null,
        baths: v.baths ?? null,
        sqft: v.sqft ?? null,
        propertyType: v.propertyType ?? null,
        mlsNumber: v.mlsNumber ?? c.mlsHint ?? null,
        status: v.status ?? "active",
        daysOnMarket: v.daysOnMarket ?? null,
        hoa: v.hoa ?? null,
        listedDate: v.listedDate ?? null,
        remarks: v.remarks ?? null,
        qualityFlags: q.flags,
        isQuality: v.isQuality ?? q.isQuality,
      };
    },
  };
}
