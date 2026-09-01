import type { ListingsProvider, AreaSpec, AreaFilter, Listing } from "./types.js";
import { classifyType, listingKey } from "./types.js";

/**
 * PUBLIC index-page provider (the free, compliant path — no API key, no paywall).
 * Reads a readable neighborhood INDEX page (Movoto) — the page a person opens in a
 * browser — and parses the embedded ld+json Product array (address, unit, zip, geo,
 * price, and the listing URL to LINK OUT to). One fetch ≈ 50 structured listings,
 * all property types, vs ~20 partly-stale Brave snippets. No internal/private API,
 * no anti-bot bypass, no login; every row links back to the source.
 */
export type Fetcher = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

/** Pull ld+json Product listings out of a Movoto index page's HTML. */
export function parseMovotoIndex(html: string): Array<{ address: string; unit: string | null; zip: string | null; lat: number | null; lng: number | null; price: number | null; url: string | null }> {
  const out: ReturnType<typeof parseMovotoIndex> = [];
  const seen = new Set<string>();
  const scripts = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const block of scripts) {
    const json = block.replace(/^<script type="application\/ld\+json">/, "").replace(/<\/script>$/, "");
    let data: any;
    try { data = JSON.parse(json); } catch { continue; }
    const items: any[] = Array.isArray(data) ? data : data?.itemListElement ?? [];
    for (const raw of items) {
      const p = raw?.item ?? raw;
      if (p?.["@type"] !== "Product") continue;
      const price = p?.offers?.price != null ? Number(p.offers.price) : null;
      const url = p?.offers?.url ?? p?.url ?? null;
      const sa = String(p?.address?.streetAddress ?? p?.name ?? "").split(",")[0].trim();
      if (!sa) continue;
      const um = sa.match(/#\s*([A-Za-z0-9-]+)\s*$/) || sa.match(/\b(?:apt|unit)\s+([A-Za-z0-9-]+)\s*$/i);
      const unit = um ? um[1] : null;
      const address = sa.replace(/\s*(?:#\s*[A-Za-z0-9-]+|(?:apt|unit)\s+[A-Za-z0-9-]+)\s*$/i, "").trim();
      const key = listingKey(address, unit);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        address, unit,
        zip: p?.address?.postalCode ? String(p.address.postalCode) : null,
        lat: p?.geo?.latitude ?? null, lng: p?.geo?.longitude ?? null,
        price, url,
      });
    }
  }
  return out;
}

export function makePublicIndexProvider(deps: { fetch?: Fetcher } = {}): ListingsProvider {
  const doFetch: Fetcher = deps.fetch ?? ((globalThis as any).fetch as Fetcher);
  return {
    name: "public-index",
    async fetchArea(area: AreaSpec, filter: AreaFilter): Promise<Listing[]> {
      const url = `https://www.movoto.com/chicago-il/${slugify(area.name)}/`;
      let html = "";
      try {
        const r = await doFetch(url, { headers: { "User-Agent": UA } });
        if (!r.ok) { console.warn(`[listings-explorer] movoto index ${r.status} ${url}`); return []; }
        html = await r.text();
      } catch (e) { console.warn("[listings-explorer] movoto fetch error:", e instanceof Error ? e.message : e); return []; }

      const rows = parseMovotoIndex(html);
      const out: Listing[] = [];
      for (const r of rows) {
        // Type from signals only (index ld+json has no explicit type): unit ⇒ condo, else single_family.
        const cls = classifyType(null, null, r.unit);
        if (!cls) continue;
        if (filter.types && filter.types.length && !filter.types.includes(cls.type)) continue;
        if (filter.priceMax != null && r.price != null && r.price > filter.priceMax) continue;
        if (filter.priceMin != null && r.price != null && r.price < filter.priceMin) continue;
        out.push({
          listingId: listingKey(r.address, r.unit), source: "movoto", sourceUrl: r.url,
          address: r.address, unit: r.unit, zip: r.zip ?? area.zips[0] ?? null, neighborhood: area.name,
          lat: r.lat, lng: r.lng, price: r.price, beds: null, baths: null, sqft: null,
          propertyType: cls.type, typeSource: cls.source, mlsNumber: null, status: "active",
          listedDate: null, daysOnMarket: null, hoa: null,
        });
      }
      return out;
    },
  };
}
