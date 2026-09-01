import { prisma } from "../../lib/prisma.js";
import type { ListingsProvider, AreaFilter, Listing } from "./types.js";
import { makeRentCastProvider } from "./rentcast-provider.js";
import { CHICAGO_AREAS, areaByName } from "../home-search/chicago-areas.js";

export interface CompileResult { areasCompiled: string[]; fetched: number; upserted: number; newRows: number; skipped?: boolean; }
export interface CompileDeps { now?: Date; provider?: ListingsProvider; }

let compiling = false; // one compile at a time (guards double-click / cron overlap)
const defaultProvider = () => makeRentCastProvider();

/** Compile named areas into ExplorerListing (all types, deduped city-wide). */
export async function compileAreas(areas: string[], filter: AreaFilter = {}, deps: CompileDeps = {}): Promise<CompileResult> {
  const now = deps.now ?? new Date();
  const provider = deps.provider ?? defaultProvider();
  const res: CompileResult = { areasCompiled: [], fetched: 0, upserted: 0, newRows: 0 };
  if (compiling) { console.warn("[listings-explorer] already compiling — skipped"); return { ...res, skipped: true }; }
  compiling = true;
  try {
    for (const name of areas) {
      const area = areaByName(name) ?? { name, zips: [] as string[], priority: 2 };
      res.areasCompiled.push(name);
      const listings = await provider.fetchArea({ name: area.name, zips: area.zips, lat: (area as any).lat, lng: (area as any).lng }, filter).catch(() => [] as Listing[]);
      res.fetched += listings.length;
      for (const l of listings) {
        const existing = await prisma.explorerListing.findUnique({ where: { listingId: l.listingId } });
        if (!existing) {
          await prisma.explorerListing.create({
            data: {
              listingId: l.listingId, source: l.source, sourceUrl: l.sourceUrl ?? null,
              address: l.address, unit: l.unit ?? null, zip: l.zip ?? null, neighborhood: l.neighborhood ?? name,
              lat: l.lat ?? null, lng: l.lng ?? null, price: l.price ?? null, beds: l.beds ?? null, baths: l.baths ?? null,
              sqft: l.sqft ?? null, propertyType: l.propertyType, typeSource: l.typeSource ?? null, mlsNumber: l.mlsNumber ?? null,
              status: l.status, verifiedAt: now, listedDate: l.listedDate ?? null, daysOnMarket: l.daysOnMarket ?? null, hoa: l.hoa ?? null,
              priceHistory: l.price != null ? [{ price: l.price, seen_at: now.toISOString() }] : undefined,
              firstSeenAt: now, lastSeenAt: now,
            },
          });
          res.newRows++;
        } else {
          const priceChanged = l.price != null && existing.price !== l.price;
          const hist = Array.isArray(existing.priceHistory) ? (existing.priceHistory as any[]) : [];
          await prisma.explorerListing.update({
            where: { id: existing.id },
            data: {
              status: l.status, price: l.price ?? existing.price, lastSeenAt: now, verifiedAt: now,
              propertyType: l.propertyType, daysOnMarket: l.daysOnMarket ?? existing.daysOnMarket,
              ...(priceChanged ? { priceHistory: [...hist, { price: l.price, seen_at: now.toISOString() }] } : {}),
            },
          });
        }
        res.upserted++;
      }
    }
    console.log(`[listings-explorer] compiled [${res.areasCompiled.join(", ")}] → fetched ${res.fetched}, new ${res.newRows}`);
    return res;
  } finally { compiling = false; }
}

/** Rolling city-wide compile (WP cluster first), maxAreas at a time. */
let rollCursor = 0;
export async function compileRolling(maxAreas = 6, filter: AreaFilter = {}, deps: CompileDeps = {}): Promise<CompileResult> {
  const ordered = [...CHICAGO_AREAS].sort((a, b) => a.priority - b.priority).map((a) => a.name);
  const slice = ordered.slice(rollCursor, rollCursor + maxAreas);
  rollCursor = (rollCursor + maxAreas) % ordered.length;
  return compileAreas(slice, filter, deps);
}
