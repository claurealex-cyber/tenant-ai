import type { ListingsProvider, AreaSpec, AreaFilter, Listing } from "./types.js";

/** Returns a fixed set of listings (already normalized) for zero-cost engine tests. */
export function makeFixtureProvider(listings: Listing[]): ListingsProvider {
  return { name: "fixture", async fetchArea(_a: AreaSpec, _f: AreaFilter) { return listings; } };
}
