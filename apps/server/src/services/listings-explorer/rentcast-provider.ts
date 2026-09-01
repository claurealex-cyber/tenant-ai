import { resolveConfig } from "@tenant-ai/shared";
import type { ListingsProvider, AreaSpec, AreaFilter, Listing } from "./types.js";
import { classifyType, listingKey } from "./types.js";

/**
 * RentCast — the LICENSED, structured listings API (the sanctioned "API"). All
 * property types by location; we classify + drop land/co-op and apply the type/price
 * filters. Fail-soft: no key → []. `deps.fetch` injectable for tests.
 * Docs shape: GET https://api.rentcast.io/v1/listings/sale?zipCode=&status=Active
 *   header X-Api-Key; returns an array of listing objects.
 */
export type Fetcher = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

const RENTCAST_BASE = "https://api.rentcast.io/v1/listings/sale";

export function makeRentCastProvider(deps: { fetch?: Fetcher } = {}): ListingsProvider {
  const doFetch: Fetcher = deps.fetch ?? ((globalThis as any).fetch as Fetcher);
  return {
    name: "rentcast",
    async fetchArea(area: AreaSpec, filter: AreaFilter): Promise<Listing[]> {
      const key = (await resolveConfig("rentcast", "api_key"))?.trim();
      if (!key) { console.warn("[listings-explorer] no rentcast api_key — fetchArea no-op"); return []; }
      const out: Listing[] = [];
      const seen = new Set<string>();
      // Query by each ZIP in the area (RentCast filters by zipCode / lat-lng+radius).
      for (const zip of area.zips.length ? area.zips : [""]) {
        const params = new URLSearchParams({ status: "Active", limit: "200" });
        if (zip) params.set("zipCode", zip);
        else if (area.lat != null && area.lng != null) { params.set("latitude", String(area.lat)); params.set("longitude", String(area.lng)); params.set("radius", "2"); }
        let rows: any[] = [];
        try {
          const r = await doFetch(`${RENTCAST_BASE}?${params.toString()}`, { headers: { "X-Api-Key": key, Accept: "application/json" } });
          if (!r.ok) { console.warn(`[listings-explorer] rentcast ${r.status} zip=${zip}`); continue; }
          const d = await r.json();
          rows = Array.isArray(d) ? d : (d?.listings ?? []);
        } catch (e) { console.warn("[listings-explorer] rentcast error:", e instanceof Error ? e.message : e); continue; }

        for (const l of rows) {
          const address = String(l.addressLine1 ?? l.formattedAddress ?? "").split(",")[0].trim();
          if (!address) continue;
          const unit = l.addressLine2 ? String(l.addressLine2).trim() : null;
          const cls = classifyType(l.propertyType, l.bedrooms, unit);
          if (!cls) continue; // land / co-op → skipped
          if (filter.types && filter.types.length && !filter.types.includes(cls.type)) continue;
          const status = String(l.status ?? "").toLowerCase() === "active" ? "active" : String(l.status ?? "active").toLowerCase();
          if (status !== "active") continue;
          const price = l.price != null ? Number(l.price) : null;
          if (filter.priceMax != null && price != null && price > filter.priceMax) continue;
          if (filter.priceMin != null && price != null && price < filter.priceMin) continue;
          if (filter.beds != null && l.bedrooms != null && Number(l.bedrooms) < filter.beds) continue;
          const listingId = listingKey(address, unit);
          if (seen.has(listingId)) continue;
          seen.add(listingId);
          out.push({
            listingId, source: "rentcast", sourceUrl: null,
            address, unit, zip: l.zipCode ? String(l.zipCode) : zip || null, neighborhood: area.name,
            lat: l.latitude ?? null, lng: l.longitude ?? null,
            price, beds: l.bedrooms != null ? Number(l.bedrooms) : null, baths: l.bathrooms != null ? Number(l.bathrooms) : null,
            sqft: l.squareFootage != null ? Number(l.squareFootage) : null,
            propertyType: cls.type, typeSource: cls.source, mlsNumber: l.mlsNumber ? String(l.mlsNumber) : null,
            status: "active", listedDate: l.listedDate ? new Date(l.listedDate) : null,
            daysOnMarket: l.daysOnMarket != null ? Number(l.daysOnMarket) : null,
            hoa: l.hoa?.fee != null ? Number(l.hoa.fee) : null,
          });
        }
      }
      return out;
    },
  };
}
