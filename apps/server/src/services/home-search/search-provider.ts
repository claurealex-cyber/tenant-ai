import { resolveConfig } from "@tenant-ai/shared";
import type { ListingProvider, ListingFilter, Candidate, Listing } from "./types.js";
import { listingKey, assessQuality } from "./types.js";

/**
 * Live provider (M1) with the #1+#2 strategy proven against the real world:
 *  - DISCOVER via Brave, biased toward readable (fetchable) domains (#2), and
 *    extract price/address/beds straight from the SNIPPET (#1) so we never depend
 *    on fetching a blocked aggregator page for those fields.
 *  - VERIFY prefers a readable-source page (fetch + deterministic status); if the
 *    candidate is on a blocked domain (Zillow/Redfin/Homes 403), it re-searches for
 *    a readable page for the same address, and only if that fails falls back to a
 *    conservative snippet read. Everything is injectable + fail-soft (no key → []).
 */
export type Fetcher = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> }>;
export type Extractor = (pageText: string, candidate: Candidate) => Promise<(Partial<Listing> & { status?: Listing["status"] }) | null>;

/** Domains that serve a fetchable page (validated in the Fable run). */
const READABLE = /(movoto|chicagocondofinder|atproperties|compass|propertyrocks|coldwellbanker)\./i;
/** Domains that 403 a direct fetch — snippet-only. */
const BLOCKED = /(zillow|redfin|trulia|homes)\./i;
const isReadable = (source: string) => READABLE.test(source);

const DISCOVERY_TEMPLATE = (f: ListingFilter) => {
  const price = f.priceMax ? ` under $${f.priceMax}` : "";
  const zip = f.zips?.length ? ` ${f.zips.join(" OR ")}` : "";
  return `${f.areaTag} Chicago condos for sale${price}${zip}`.trim();
};

function parseCandidate(res: any): Candidate | null {
  const raw = `${res?.title ?? ""} ${res?.description ?? ""}`;
  if (!res?.url) return null;
  const text = raw.replace(/[\d,]+\s*sq\.?\s?ft/gi, " "); // strip sqft so it never leaks into the address
  const priceHint = Number((text.match(/\$\s?([\d]{2,3},[\d]{3})/)?.[1] || "").replace(/,/g, "")) || null;
  const bedsHint = Number(text.match(/(\d+)\s*(?:bd|beds?|bedrooms?)/i)?.[1]) || null;
  const addr = text.match(/\d+\s+[NSEW]?\.?\s*[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:St|Ave|Blvd|Dr|Ct|Pl|Rd|Ln|Way|Ter)\b/)?.[0];
  if (!addr) return null;
  const unit = text.match(/(?:#|apt|unit)\s*([A-Za-z0-9-]+)/i)?.[1] ?? null;
  const mlsHint = text.match(/\bMLS[#:\s]*([0-9]{7,8})\b/i)?.[1] ?? null;
  let source = "";
  try { source = new URL(res.url).hostname.replace(/^www\./, ""); } catch { return null; }
  return { source, url: res.url, address: addr.trim(), unit, priceHint, bedsHint, mlsHint, snippet: text.trim().slice(0, 500) };
}

/** Conservative snippet read (#1) — only "active" if it clearly reads for-sale and
 *  shows NO sold/pending/contingent markers (snippets lie about status). */
function snippetVerify(c: Candidate): (Partial<Listing> & { status?: Listing["status"] }) | null {
  const t = (c.snippet || "").toLowerCase();
  if (!t) return null;
  if (/\b(sold|closed|off market|under contract|contingent|pending)\b/.test(t)) return null;
  if (!/\b(for sale|active|list(ed)? (for|price)|asking)\b/.test(t)) return null;
  const q = assessQuality(c.snippet);
  return { status: "active", price: c.priceHint ?? null, beds: c.bedsHint ?? null, remarks: c.snippet, isQuality: q.isQuality };
}

export function makeSearchProvider(deps: { fetch?: Fetcher; extract?: Extractor } = {}): ListingProvider {
  const doFetch: Fetcher = deps.fetch ?? ((globalThis as any).fetch as Fetcher);
  const extract = deps.extract ?? defaultExtractor;

  async function brave(q: string, key: string): Promise<any[]> {
    try {
      const r = await doFetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}`, {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
      });
      if (!r.ok) { console.warn(`[home-search] brave ${r.status}`); return []; }
      return (await r.json())?.web?.results ?? [];
    } catch (e) { console.warn("[home-search] brave error:", e instanceof Error ? e.message : e); return []; }
  }

  return {
    name: "search",
    async discover(filter: ListingFilter): Promise<Candidate[]> {
      const key = (await resolveConfig("home_search", "search_api_key"))?.trim();
      if (!key) { console.warn("[home-search] no search_api_key — discover no-op"); return []; }
      // #2: base query + a readable-domain-biased query so fetchable candidates surface.
      const base = DISCOVERY_TEMPLATE(filter);
      const queries = [base, `${base} movoto OR chicagocondofinder OR atproperties`];
      const byUrl = new Map<string, Candidate>();
      for (const q of queries) {
        for (const res of await brave(q, key)) {
          const c = parseCandidate(res);
          if (c && !byUrl.has(c.url)) byUrl.set(c.url, c);
        }
      }
      return [...byUrl.values()];
    },

    async verify(c: Candidate): Promise<Listing | null> {
      const key = (await resolveConfig("home_search", "search_api_key"))?.trim();
      const build = (v: Partial<Listing> & { status?: Listing["status"] }, url: string): Listing | null => {
        if (v.status !== "active") return null;
        const q = assessQuality(v.remarks ?? c.snippet);
        const isQuality = v.isQuality ?? q.isQuality;
        if (!isQuality) return null;
        return {
          listingId: listingKey(c.address, c.unit), source: c.source, sourceUrl: c.url, canonicalUrl: url,
          address: c.address, unit: c.unit ?? null, zip: v.zip ?? null, lat: v.lat ?? null, lng: v.lng ?? null,
          price: v.price ?? c.priceHint ?? null, beds: v.beds ?? c.bedsHint ?? null, baths: v.baths ?? null,
          sqft: v.sqft ?? null, propertyType: v.propertyType ?? null, mlsNumber: v.mlsNumber ?? c.mlsHint ?? null,
          status: "active", daysOnMarket: v.daysOnMarket ?? null, hoa: v.hoa ?? null, listedDate: v.listedDate ?? null,
          remarks: v.remarks ?? null, qualityFlags: q.flags, isQuality,
        };
      };

      // 1. Find a READABLE (fetchable) URL: the candidate's own if readable, else
      //    re-search Brave for a readable page for this exact address (#2).
      let readableUrl: string | null = isReadable(c.source) ? c.url : null;
      if (!readableUrl && key) {
        for (const res of await brave(`"${c.address}"${c.unit ? " " + c.unit : ""} Chicago condo for sale`, key)) {
          try { if (isReadable(new URL(res.url).hostname)) { readableUrl = res.url; break; } } catch { /* skip */ }
        }
      }

      // 2. Fetch + deterministic (or LLM) extract from the readable page.
      if (readableUrl) {
        try {
          const r = await doFetch(readableUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
          if (r.ok) {
            const v = await extract((await r.text()).slice(0, 40_000), c).catch(() => null);
            if (v) { const built = build(v, readableUrl); if (built) return built; }
          } else {
            console.warn(`[home-search] verify fetch ${r.status} ${readableUrl}`);
          }
        } catch { /* fall through to snippet */ }
      }

      // 3. Snippet fallback (#1) — conservative; used when no readable page was fetchable.
      const sv = snippetVerify(c);
      return sv ? build(sv, c.url) : null;
    },
  };
}

/** Deterministic (no-LLM) page extractor — regex read of status/price/beds/sqft. */
const defaultExtractor: Extractor = async (pageText, candidate) => {
  const t = pageText.toLowerCase();
  if (!t) return null;
  let status: Listing["status"] | null = null;
  if (/\b(sold|closed)\b/.test(t) && /\bprice\b/.test(t)) status = "closed";
  else if (/\b(under contract|contingent)\b/.test(t)) status = "contingent";
  else if (/\bpending\b/.test(t)) status = "pending";
  else if (/\b(for sale|active|list price|listed for)\b/.test(t)) status = "active";
  if (status !== "active") return null;
  const price = candidate.priceHint ?? (Number((pageText.match(/\$\s?([\d]{2,3},[\d]{3})/)?.[1] || "").replace(/,/g, "")) || null);
  const beds = candidate.bedsHint ?? (Number(pageText.match(/(\d+)\s*(?:bd|beds?|bedrooms?)/i)?.[1]) || null);
  const sqft = Number((pageText.match(/([\d,]{3,5})\s*(?:sq\.?\s?ft|sqft|square feet)/i)?.[1] || "").replace(/,/g, "")) || null;
  return { status, price, beds, sqft, remarks: null, isQuality: true };
};
