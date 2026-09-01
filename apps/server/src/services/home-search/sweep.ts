import { prisma } from "../../lib/prisma.js";
import type { ListingProvider, ListingFilter } from "./types.js";
import { looksLikeHome } from "./types.js";
import { makeSearchProvider } from "./search-provider.js";
import { CHICAGO_AREAS, WICKER_PARK_CLUSTER, areaByName } from "./chicago-areas.js";

export interface SweepOptions {
  areas?: string[];        // neighborhood names; default = Wicker Park cluster
  priceAnchor?: number | null; // biases the discovery query ("under $X"); does NOT drop rows
  maxAreas?: number;       // budget guard — neighborhoods per run
  now?: Date;
  providerFor?: () => ListingProvider; // injectable for tests
}
export interface SweepResult {
  areasSwept: string[];
  discovered: number;
  verified: number;
  upserted: number;
  newRows: number;
}

/**
 * City-wide compilation sweep. For each neighborhood: discover → pre-filter → verify
 * → upsert into ChicagoListing (deduped city-wide by listingId), tagged with the
 * neighborhood. Stores ALL verified active-quality listings regardless of price — the
 * dashboard filters price/location over the compiled dataset. Never throws.
 */
export async function runSweep(opts: SweepOptions = {}): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const provider = (opts.providerFor ?? (() => makeSearchProvider()))();
  const names = (opts.areas && opts.areas.length ? opts.areas : WICKER_PARK_CLUSTER).slice(0, opts.maxAreas ?? 6);
  const res: SweepResult = { areasSwept: [], discovered: 0, verified: 0, upserted: 0, newRows: 0 };

  for (const name of names) {
    const area = areaByName(name) ?? { name, zips: [] as string[], priority: 2 };
    res.areasSwept.push(name);
    const filter: ListingFilter = { areaTag: name, priceMax: opts.priceAnchor ?? null, zips: area.zips };

    const candidates = (await provider.discover(filter).catch(() => [])).filter((c) => looksLikeHome(c));
    res.discovered += candidates.length;

    for (const c of candidates) {
      const v = await provider.verify(c).catch(() => null);
      if (!v || v.status !== "active" || !v.isQuality) continue;
      res.verified++;
      const existing = await prisma.chicagoListing.findUnique({ where: { listingId: v.listingId } });
      if (!existing) {
        await prisma.chicagoListing.create({
          data: {
            listingId: v.listingId, source: v.source, sourceUrl: v.sourceUrl, canonicalUrl: v.canonicalUrl ?? null,
            address: v.address, unit: v.unit ?? null, zip: v.zip ?? area.zips[0] ?? null, neighborhood: name,
            lat: v.lat ?? area.lat ?? null, lng: v.lng ?? area.lng ?? null,
            price: v.price ?? null, beds: v.beds ?? null, baths: v.baths ?? null, sqft: v.sqft ?? null,
            propertyType: v.propertyType ?? null, mlsNumber: v.mlsNumber ?? null, status: v.status,
            verifiedAt: now, daysOnMarket: v.daysOnMarket ?? null, hoa: v.hoa ?? null, listedDate: v.listedDate ?? null,
            remarks: v.remarks ?? null, qualityFlags: v.qualityFlags, isQuality: v.isQuality,
            priceHistory: v.price != null ? [{ price: v.price, seen_at: now.toISOString() }] : undefined,
            firstSeenAt: now, lastSeenAt: now,
          },
        });
        res.newRows++;
      } else {
        const priceChanged = v.price != null && existing.price !== v.price;
        const hist = Array.isArray(existing.priceHistory) ? (existing.priceHistory as any[]) : [];
        await prisma.chicagoListing.update({
          where: { id: existing.id },
          data: {
            status: v.status, price: v.price ?? existing.price, lastSeenAt: now, verifiedAt: now,
            neighborhood: existing.neighborhood ?? name, daysOnMarket: v.daysOnMarket ?? existing.daysOnMarket,
            ...(priceChanged ? { priceHistory: [...hist, { price: v.price, seen_at: now.toISOString() }] } : {}),
          },
        });
      }
      res.upserted++;
    }
  }
  console.log(`[home-search sweep] areas [${res.areasSwept.join(", ")}] → discovered ${res.discovered}, verified ${res.verified}, new ${res.newRows}`);
  return res;
}

/** Rolling city-wide sweep: rotate through ALL Chicago areas maxAreas at a time,
 *  Wicker-Park cluster first. Cursor kept in memory per process (best-effort). */
let rollCursor = 0;
export async function runRollingSweep(maxAreas = 6, deps: Omit<SweepOptions, "areas" | "maxAreas"> = {}): Promise<SweepResult> {
  const ordered = [...CHICAGO_AREAS].sort((a, b) => a.priority - b.priority).map((a) => a.name);
  const slice = ordered.slice(rollCursor, rollCursor + maxAreas);
  rollCursor = (rollCursor + maxAreas) % ordered.length;
  return runSweep({ ...deps, areas: slice, maxAreas });
}
