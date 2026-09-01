import { resolveConfig } from "@tenant-ai/shared";
import type { ListingProvider, ListingFilter, Candidate, Listing } from "./types.js";
import { listingKey, assessQuality } from "./types.js";

/**
 * The live provider (M1): DISCOVER via a web-search API (Brave/SerpApi), VERIFY by
 * fetching the candidate's detail page and extracting via the LLM bridge (schema-
 * validated JSON). Both external calls are injectable for tests, and BOTH fail-soft:
 * with no API key, discover() returns [] and verify() returns null — the engine then
 * simply finds nothing (no crash), and tests use the fixture provider instead.
 */
export type Fetcher = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> }>;
/** Extractor = the AI↔code bridge: page text → validated Listing fields (or null). */
export type Extractor = (pageText: string, candidate: Candidate) => Promise<(Partial<Listing> & { status?: Listing["status"] }) | null>;

const DISCOVERY_TEMPLATE = (f: ListingFilter) => {
  const area = f.zips?.[0] ? `${f.areaTag}` : f.areaTag;
  const price = f.priceMax ? ` under $${f.priceMax}` : "";
  const zip = f.zips?.length ? ` ${f.zips.join(" OR ")}` : "";
  return `${area} Chicago condos for sale${price}${zip}`.trim();
};

export function makeSearchProvider(deps: { fetch?: Fetcher; extract?: Extractor } = {}): ListingProvider {
  const doFetch: Fetcher = deps.fetch ?? ((globalThis as any).fetch as Fetcher);
  return {
    name: "search",
    async discover(filter: ListingFilter): Promise<Candidate[]> {
      const key = (await resolveConfig("home_search", "search_api_key"))?.trim();
      if (!key) { console.warn("[home-search] no search_api_key — discover no-op"); return []; }
      const q = DISCOVERY_TEMPLATE(filter);
      try {
        const r = await doFetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}`, {
          headers: { Accept: "application/json", "X-Subscription-Token": key },
        });
        if (!r.ok) { console.warn(`[home-search] discover ${r.status}`); return []; }
        const d = await r.json();
        const results: any[] = d?.web?.results ?? [];
        // Turn search results into candidates (address/price/beds parsed from titles/snippets).
        return results
          .map((res): Candidate | null => {
            const text = `${res.title ?? ""} ${res.description ?? ""}`;
            const priceHint = Number((text.match(/\$([\d,]{5,})/)?.[1] || "").replace(/,/g, "")) || null;
            const bedsHint = Number(text.match(/(\d+)\s*(?:bd|bed)/i)?.[1]) || null;
            const addr = text.match(/\d+\s+[NSEW]?\.?\s*[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:St|Ave|Blvd|Dr|Ct|Pl|Rd|Ln|Way|Ter)\b/)?.[0];
            if (!addr || !res.url) return null;
            const unit = text.match(/(?:#|apt|unit)\s*([A-Za-z0-9-]+)/i)?.[1] ?? null;
            return { source: new URL(res.url).hostname.replace(/^www\./, ""), url: res.url, address: addr.trim(), unit, priceHint, bedsHint };
          })
          .filter((c): c is Candidate => c !== null);
      } catch (e) {
        console.warn("[home-search] discover error:", e instanceof Error ? e.message : e);
        return [];
      }
    },
    async verify(c: Candidate): Promise<Listing | null> {
      // Fetch the detail page, then hand it to the LLM extractor (the bridge).
      let pageText = "";
      try {
        const r = await doFetch(c.url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!r.ok) { console.warn(`[home-search] verify fetch ${r.status} ${c.url}`); return null; }
        pageText = (await r.text()).slice(0, 40_000);
      } catch { return null; }
      const extract = deps.extract ?? defaultExtractor;
      const v = await extract(pageText, c).catch(() => null);
      if (!v || v.status !== "active") return null; // only verified-active proceed
      const q = assessQuality(v.remarks);
      const isQuality = v.isQuality ?? q.isQuality;
      if (!isQuality) return null; // quality gate
      return {
        listingId: listingKey(c.address, c.unit),
        source: c.source, sourceUrl: c.url, canonicalUrl: v.canonicalUrl ?? c.url,
        address: c.address, unit: c.unit ?? null, zip: v.zip ?? null, lat: v.lat ?? null, lng: v.lng ?? null,
        price: v.price ?? c.priceHint ?? null, beds: v.beds ?? c.bedsHint ?? null, baths: v.baths ?? null,
        sqft: v.sqft ?? null, propertyType: v.propertyType ?? null, mlsNumber: v.mlsNumber ?? c.mlsHint ?? null,
        status: "active", daysOnMarket: v.daysOnMarket ?? null, hoa: v.hoa ?? null, listedDate: v.listedDate ?? null,
        remarks: v.remarks ?? null, qualityFlags: q.flags, isQuality,
      };
    },
  };
}

/** Default extractor — the LLM bridge. Wired to be added when an LLM key is set;
 *  until then it fails soft (returns null) so nothing unverified is ever alerted. */
const defaultExtractor: Extractor = async () => {
  console.warn("[home-search] no LLM extractor configured — verify no-op");
  return null;
};
