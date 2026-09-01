import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runSearch } from "../services/home-search/engine.js";
import { makeFixtureProvider } from "../services/home-search/fixture-provider.js";
import type { Candidate, Listing } from "../services/home-search/types.js";

const prisma = new PrismaClient();
const P = `test_hs_${Date.now()}`;
let notify: any;

const A: Candidate = { source: "movoto", url: "u-a", address: "500 N Damen Ave", unit: "307", priceHint: 250000, bedsHint: 1 };
const B: Candidate = { source: "movoto", url: "u-b", address: "3845 W Altgeld St", unit: "G", priceHint: 194000, bedsHint: 2 };
const C: Candidate = { source: "movoto", url: "u-c", address: "924 N Oakley Blvd", unit: "GN", priceHint: 249000, bedsHint: 2 };
const PARK: Candidate = { source: "propertyrocks", url: "u-p", address: "Deeded garage space 1751 N Western Ave", priceHint: 9500 };
const OVER: Candidate = { source: "movoto", url: "u-o", address: "1528 N Paulina St", unit: "C", priceHint: 325000, bedsHint: 2 };

const VMAP: Record<string, Partial<Listing> & { status?: Listing["status"] }> = {
  "u-a": { status: "active", price: 250000, beds: 1, zip: "60622", remarks: "updated kitchen, in-unit laundry" },
  "u-b": { status: "active", price: 194000, beds: 2, zip: "60647", remarks: "move-in ready, new flooring" },
  "u-c": { status: "contingent", price: 249000, beds: 2, zip: "60622" },
  "u-o": { status: "active", price: 325000, beds: 2, zip: "60622", remarks: "updated" },
  // u-p intentionally absent (and pre-filtered anyway)
};
const providerFor = (cands: Candidate[]) => () => makeFixtureProvider(cands, VMAP);

async function mkSearch(over: Record<string, unknown> = {}) {
  return prisma.buyerSearch.create({
    data: { label: `${P} WP`, notifyPhone: "+13125550123", priceMax: 250000, zips: [], provider: "fixture", alertsArmed: true, ...over } as any,
  });
}

beforeAll(async () => { await prisma.$connect(); });
afterEachCleanup();
function afterEachCleanup() {}
beforeEach(() => { notify = vi.fn(async () => {}); });
afterAll(async () => {
  await prisma.buyerListing.deleteMany({ where: { search: { label: { startsWith: P } } } });
  await prisma.buyerSearch.deleteMany({ where: { label: { startsWith: P } } });
  await prisma.$disconnect();
});

describe("home-search engine", () => {
  it("baseline run seeds listings SILENTLY (no alerts, even armed)", async () => {
    const s = await mkSearch();
    const r = await runSearch(s.id, { providerFor: providerFor([A, B]), notify });
    expect(r.baseline).toBe(true);
    expect(r.inserted).toBe(2);
    expect(notify).not.toHaveBeenCalled();
    const rows = await prisma.buyerListing.findMany({ where: { searchId: s.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.notified)).toBe(true); // seeded as already-notified
  });

  it("after baseline, a NEW listing alerts ONLY the new one", async () => {
    const s = await mkSearch();
    await runSearch(s.id, { providerFor: providerFor([A]), notify }); // baseline: A
    notify.mockClear();
    const r = await runSearch(s.id, { providerFor: providerFor([A, B]), notify }); // A seen, B new
    expect(r.inserted).toBe(1);
    expect(notify).toHaveBeenCalledOnce();
    expect(String(notify.mock.calls[0][1])).toContain("3845 W Altgeld");
  });

  it("verify-gate: unverifiable candidate is dropped", async () => {
    const s = await mkSearch();
    const X: Candidate = { source: "movoto", url: "u-x", address: "999 N Nowhere St", unit: "1", priceHint: 200000, bedsHint: 1 };
    const r = await runSearch(s.id, { providerFor: providerFor([X]), notify }); // no VMAP entry
    expect(r.inserted).toBe(0);
  });

  it("contingent (non-active) is dropped", async () => {
    const s = await mkSearch();
    const r = await runSearch(s.id, { providerFor: providerFor([C]), notify });
    expect(r.inserted).toBe(0);
  });

  it("over-priceMax is dropped", async () => {
    const s = await mkSearch();
    const r = await runSearch(s.id, { providerFor: providerFor([OVER]), notify });
    expect(r.inserted).toBe(0);
  });

  it("parking/land is pre-filtered before verify", async () => {
    const s = await mkSearch();
    const r = await runSearch(s.id, { providerFor: providerFor([PARK]), notify });
    expect(r.discovered).toBe(0); // looksLikeHome dropped it in stage 1
    expect(r.inserted).toBe(0);
  });

  it("alerts OFF (not armed): inserts but never texts", async () => {
    const s = await mkSearch({ alertsArmed: false });
    await runSearch(s.id, { providerFor: providerFor([A]), notify }); // baseline
    notify.mockClear();
    const r = await runSearch(s.id, { providerFor: providerFor([A, B]), notify });
    expect(r.inserted).toBe(1);
    expect(notify).not.toHaveBeenCalled();
  });
});
