/** Listings Explorer — all types except land/co-op. */
export type PropertyType = "single_family" | "condo" | "townhome" | "multi";

export interface Listing {
  listingId: string; // dedup key: normalized address+unit
  source: string;
  sourceUrl?: string | null;
  address: string;
  unit?: string | null;
  zip?: string | null;
  neighborhood?: string | null;
  lat?: number | null;
  lng?: number | null;
  price?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  propertyType: PropertyType;
  typeSource?: string | null; // "label" | "signal"
  mlsNumber?: string | null;
  status: string; // active | contingent | pending | closed | removed
  listedDate?: Date | null;
  daysOnMarket?: number | null;
  hoa?: number | null;
}

export interface AreaSpec { name: string; zips: string[]; lat?: number; lng?: number; }
export interface AreaFilter {
  priceMax?: number | null;
  priceMin?: number | null;
  beds?: number | null;
  types?: PropertyType[]; // default: all four
}

export interface ListingsProvider {
  name: string;
  fetchArea(area: AreaSpec, filter: AreaFilter): Promise<Listing[]>;
}

/**
 * Classify a raw type into our set, or null to SKIP (land / co-op / out of scope).
 * Labels lie (a 12-unit was tagged "Single-Family"), so signals win where clear:
 * high beds-with-few-baths ⇒ multi; a unit suffix ⇒ condo.
 */
export function classifyType(
  rawType: string | null | undefined,
  beds?: number | null,
  unit?: string | null,
): { type: PropertyType; source: "label" | "signal" } | null {
  const r = (rawType || "").toLowerCase();
  if (/\b(land|lot|vacant)\b/.test(r)) return null;          // skip land
  if (/co-?op|cooperative/.test(r)) return null;             // skip co-op
  // Signal override: a big unit count reads as multi regardless of label.
  if (beds != null && beds >= 6) return { type: "multi", source: "signal" };
  if (/multi|duplex|triplex|two[-\s]?to[-\s]?four|2-4|income|building/.test(r)) return { type: "multi", source: "label" };
  if (/town|row\s?home|rowhouse/.test(r)) return { type: "townhome", source: "label" };
  if (/condo|apartment/.test(r)) return { type: "condo", source: "label" };
  if (/single|sfr|detached|\bhouse\b/.test(r)) return { type: "single_family", source: "label" };
  // Fallback from signals when the label is unknown/blank.
  if (unit && unit.trim()) return { type: "condo", source: "signal" };
  return { type: "single_family", source: "signal" };
}

/** Dedup key: normalize the street suffix OUT (keep for display), fold unit tokens. */
export function listingKey(address: string, unit?: string | null): string {
  const a = (address || "")
    .toLowerCase()
    .replace(/\b(avenue|ave)\b/g, "").replace(/\b(street|st)\b/g, "").replace(/\b(boulevard|blvd)\b/g, "")
    .replace(/\b(drive|dr)\b/g, "").replace(/\b(court|ct)\b/g, "").replace(/\b(place|pl)\b/g, "")
    .replace(/\b(terrace|ter)\b/g, "").replace(/\b(road|rd)\b/g, "").replace(/\b(lane|ln)\b/g, "")
    .replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  const u = (unit || "").toLowerCase().replace(/^(apt|unit|#)\s*/i, "").replace(/[^a-z0-9]/g, "").trim();
  return u ? `${a}|${u}` : a;
}
