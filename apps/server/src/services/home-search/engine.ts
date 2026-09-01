import { prisma } from "../../lib/prisma.js";
import { withGuiLock } from "../../lib/gui-lock.js";
import { sendViaMessagesRelay } from "../messages-relay.js";
import type { ListingProvider, ListingFilter, Listing } from "./types.js";
import { looksLikeHome } from "./types.js";
import { makeSearchProvider } from "./search-provider.js";

export interface EngineDeps {
  now?: Date;
  providerFor?: (name: string) => ListingProvider; // injectable for tests
  notify?: (phone: string, text: string) => Promise<void>;
}
export interface SearchRunResult {
  searchId: string;
  discovered: number;
  verified: number;
  inserted: number;
  notified: number;
  baseline: boolean;
}

const defaultProviderFor = (_name: string): ListingProvider => makeSearchProvider();
const defaultNotify = (phone: string, text: string) =>
  withGuiLock("home-search-alert", () => sendViaMessagesRelay(phone, text));

/** Run one saved search through the full two-stage pipeline. Never throws. */
export async function runSearch(searchId: string, deps: EngineDeps = {}): Promise<SearchRunResult> {
  const now = deps.now ?? new Date();
  const providerFor = deps.providerFor ?? defaultProviderFor;
  const notify = deps.notify ?? defaultNotify;

  const s = await prisma.buyerSearch.findUnique({ where: { id: searchId } });
  const res: SearchRunResult = { searchId, discovered: 0, verified: 0, inserted: 0, notified: 0, baseline: false };
  if (!s || !s.enabled) return res;
  const baseline = s.lastRunAt === null; // first run: seed, never alert existing inventory
  res.baseline = baseline;

  const filter: ListingFilter = {
    areaTag: s.label, priceMax: s.priceMax, priceMin: s.priceMin, beds: s.beds,
    zips: s.zips, center: s.centerLat != null && s.centerLng != null ? { lat: s.centerLat, lng: s.centerLng } : null,
    radiusMi: s.radiusMi, keywords: s.keywords,
  };
  const provider = providerFor(s.provider);

  // Stage 1 — discover + hard pre-filter (cheap).
  const candidates = (await provider.discover(filter).catch(() => [])).filter((c) => looksLikeHome(c));
  res.discovered = candidates.length;

  // Stage 2 — verify each survivor (one detail fetch each); only verified-active-quality proceed.
  const verified: Listing[] = [];
  for (const c of candidates) {
    const v = await provider.verify(c).catch(() => null);
    if (v && v.status === "active" && v.isQuality) verified.push(v);
  }
  res.verified = verified.length;

  // Filter (price/area) + dedup within this batch by listingId.
  const seenKey = new Set<string>();
  const kept = verified.filter((v) => {
    if (s.priceMax != null && v.price != null && v.price > s.priceMax) return false;
    if (s.priceMin != null && v.price != null && v.price < s.priceMin) return false;
    if (s.beds != null && v.beds != null && v.beds < s.beds) return false;
    if (s.zips.length && v.zip && !s.zips.includes(v.zip)) return false;
    if (seenKey.has(v.listingId)) return false;
    seenKey.add(v.listingId);
    return true;
  });

  // Upsert + collect genuinely-new rows.
  const newRows: Listing[] = [];
  for (const v of kept) {
    const existing = await prisma.buyerListing.findUnique({ where: { searchId_listingId: { searchId, listingId: v.listingId } } });
    if (!existing) {
      await prisma.buyerListing.create({
        data: {
          searchId, listingId: v.listingId, source: v.source, sourceUrl: v.sourceUrl, canonicalUrl: v.canonicalUrl ?? null,
          address: v.address, unit: v.unit ?? null, zip: v.zip ?? null, lat: v.lat ?? null, lng: v.lng ?? null,
          price: v.price ?? null, beds: v.beds ?? null, baths: v.baths ?? null, sqft: v.sqft ?? null,
          propertyType: v.propertyType ?? null, mlsNumber: v.mlsNumber ?? null, status: v.status,
          verifiedAt: now, daysOnMarket: v.daysOnMarket ?? null, hoa: v.hoa ?? null, listedDate: v.listedDate ?? null,
          remarks: v.remarks ?? null, qualityFlags: v.qualityFlags, isQuality: v.isQuality,
          priceHistory: v.price != null ? [{ price: v.price, seen_at: now.toISOString() }] : undefined,
          areaTag: s.label, notified: false, firstSeenAt: now, lastSeenAt: now,
        },
      });
      newRows.push(v);
    } else {
      const priceChanged = v.price != null && existing.price !== v.price;
      const hist = Array.isArray(existing.priceHistory) ? (existing.priceHistory as any[]) : [];
      await prisma.buyerListing.update({
        where: { id: existing.id },
        data: {
          status: v.status, price: v.price ?? existing.price, lastSeenAt: now, verifiedAt: now,
          daysOnMarket: v.daysOnMarket ?? existing.daysOnMarket, remarks: v.remarks ?? existing.remarks,
          ...(priceChanged ? { priceHistory: [...hist, { price: v.price, seen_at: now.toISOString() }] } : {}),
        },
      });
    }
  }
  res.inserted = newRows.length;

  // Notify — only if armed AND not the baseline seeding run.
  if (s.alertsArmed && !baseline && newRows.length) {
    for (const v of newRows) {
      const priceStr = v.price ? `$${v.price.toLocaleString("en-US")}` : "price n/a";
      const bd = v.beds != null ? `${v.beds}bd` : "";
      const text = `New match — ${priceStr} ${bd} ${v.address}${v.unit ? " #" + v.unit : ""}. ${v.sourceUrl}`;
      await notify(s.notifyPhone, text).catch((e: unknown) => console.error("[home-search] notify failed:", e));
      await prisma.buyerListing.updateMany({ where: { searchId, listingId: v.listingId }, data: { notified: true } });
      res.notified++;
    }
  } else if (baseline) {
    // Baseline run: mark everything seen as already-notified so it never alerts later.
    await prisma.buyerListing.updateMany({ where: { searchId, notified: false }, data: { notified: true } });
  }

  await prisma.buyerSearch.update({ where: { id: searchId }, data: { lastRunAt: now, lastRunCount: kept.length } });
  console.log(`[home-search] "${s.label}": discovered ${res.discovered}, verified ${res.verified}, new ${res.inserted}, alerted ${res.notified}${baseline ? " (baseline)" : ""}`);
  return res;
}

/** Run every enabled saved search. */
export async function runAllEnabled(deps: EngineDeps = {}): Promise<SearchRunResult[]> {
  const searches = await prisma.buyerSearch.findMany({ where: { enabled: true }, select: { id: true } });
  const out: SearchRunResult[] = [];
  for (const { id } of searches) out.push(await runSearch(id, deps));
  return out;
}
