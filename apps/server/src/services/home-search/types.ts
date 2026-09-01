/** Home Search provider contract — two stages (discover → verify), per the plan. */
export interface ListingFilter {
  areaTag: string;
  priceMax?: number | null;
  priceMin?: number | null;
  beds?: number | null;
  zips?: string[];
  center?: { lat: number; lng: number } | null;
  radiusMi?: number | null;
  keywords?: string | null;
}

/** Cheap discovery output — enough to decide whether to spend a verify fetch. */
export interface Candidate {
  source: string;
  url: string;
  address: string;
  unit?: string | null;
  priceHint?: number | null;
  bedsHint?: number | null;
  mlsHint?: string | null;
  snippet?: string | null; // Brave title+description — the #1 snippet-extraction source
}

/** Verified, normalized listing — what gets persisted + alerted. */
export interface Listing {
  listingId: string; // stable key: normalized address+unit
  source: string;
  sourceUrl: string;
  canonicalUrl?: string | null;
  address: string;
  unit?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
  price?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  propertyType?: string | null;
  mlsNumber?: string | null;
  status: "active" | "contingent" | "pending" | "closed" | "removed" | "stale";
  daysOnMarket?: number | null;
  hoa?: number | null;
  listedDate?: Date | null;
  remarks?: string | null;
  qualityFlags: string[];
  isQuality: boolean;
}

export interface ListingProvider {
  name: string;
  discover(filter: ListingFilter): Promise<Candidate[]>;
  verify(candidate: Candidate): Promise<Listing | null>;
}

/** Normalize an address+unit into a stable dedup key (validated rules from the run). */
export function listingKey(address: string, unit?: string | null): string {
  const a = (address || "")
    .toLowerCase()
    .replace(/\bavenue\b/g, "ave").replace(/\bstreet\b/g, "st").replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr").replace(/\bcourt\b/g, "ct").replace(/\bplace\b/g, "pl")
    .replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  const u = (unit || "").toLowerCase().replace(/^(apt|unit|#)\s*/i, "").replace(/[^a-z0-9]/g, "").trim();
  return u ? `${a}|${u}` : a;
}

/** Hard pre-filter (validated): drop non-homes before spending a verify fetch. */
const PARKING_LAND = /\b(parking|garage space|deeded space|vacant land|lot only|land only|buildable lot)\b/i;
export function looksLikeHome(c: Candidate, minPrice = 90_000): boolean {
  if (PARKING_LAND.test(c.address)) return false;
  if (c.priceHint != null && c.priceHint < minPrice) return false;
  if (c.bedsHint != null && c.bedsHint < 1) return false;
  // MLS-id freshness heuristic: 8-digit MRED ids <120000000 read as 2020-2023 → stale.
  if (c.mlsHint && /^\d{8}$/.test(c.mlsHint) && Number(c.mlsHint) < 120_000_000) return false;
  return true;
}

/** Quality screen from remarks (validated keep/drop lists). */
const DROP = /\b(as[- ]is|investor|cash only|tlc|estate sale|handyman|needs work|opportunity)\b/i;
const KEEP = /\b(move[- ]in|rehab|updated|renovat|hardwood|in[- ]unit laundry|granite|stainless|new kitchen)\b/i;
export function assessQuality(remarks?: string | null): { isQuality: boolean; flags: string[] } {
  const r = remarks || "";
  const flags: string[] = [];
  if (/\bgarden\b|#g[nsb]?\b/i.test(r)) flags.push("garden_unit");
  if (DROP.test(r)) { flags.push("distressed"); return { isQuality: false, flags }; }
  if (KEEP.test(r)) flags.push("move_in");
  return { isQuality: true, flags };
}
