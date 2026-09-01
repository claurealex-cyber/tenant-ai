# Buyer Finder — Plan

## Vision
A buyer-tailored home/apartment finder, built on **legitimate listing data** (never
scraped realtor.com). Starts as a personal instant-alert ("≤$250k near Wicker Park,
the moment it lists") and grows into a differentiated buyer app: listings + the
decision-intelligence layer the big portals are bad at. Reuses what tenant-ai
already has — the poll→dedup→notify loop, the SMS relay, and the county GIS/enviro
data pipes.

## The core architectural move — a provider abstraction
The three data sources have different access models, latency, completeness, and cost.
Don't marry one. Define ONE interface and make each source an adapter, so we ship on
the cheapest today and graduate to the best without a rewrite.

```
interface ListingProvider {
  search(filter: ListingFilter): Promise<Listing[]>   // normalized output
  name: string
}
```
- **ListingFilter**: { priceMax, priceMin?, beds?, baths?, propertyType?, status:"active|new",
  zips?: string[], center?: {lat,lng}, radiusMi?, keywords? }
- **Listing (normalized)**: { sourceId, source, address, price, beds, baths, sqft,
  propertyType, status, listedAt, lat, lng, url, photos?, mlsNumber? }

Everything downstream (alerts, dedup, UI, enrichment) speaks the normalized shape, so
adapters are swappable and **stackable** (query several, merge, de-dupe).

## Data-source strategy — phased, ranked by effort→quality
| Phase | Source | Why | Access |
|-------|--------|-----|--------|
| A (now) | **RentCast** | fastest MVP; for-sale + rental listings by location+price; no membership | API key, paid tier |
| B (soon) | **SimplyRETS** or **Bridge Interactive (Zillow RESO)** | fuller coverage, faster new-listing latency, real MLS data | dev signup; Bridge free if agent-approved |
| C (best) | **Direct MRED MLS** (Chicago) via IDX/VOW | most complete + most instant; the "real app" foundation | brokerage/agent affiliation |

Design so C is a drop-in adapter, not a migration.

## Milestones

### M0 — Provider abstraction + normalized schema
- Define `ListingProvider`, `ListingFilter`, `Listing` (above). Per-provider config
  (keys) via the existing SystemConfig pattern. A `providers[]` registry the engine
  iterates. Ship with a stub/fixture provider so everything downstream is testable
  with zero API cost.

### M1 — RentCast adapter + the alert engine (ship the Wicker Park alert)
- `RentCastProvider.search()` → normalized listings.
- Reuse the Zillow-workflow loop: **poll → dedup(by sourceId) → notify**. Baseline on
  first run so existing inventory doesn't spam; only genuinely NEW listings alert.
- First live search: `{ priceMax: 250000, status:"new", zips:["60622","60647"] }`
  (Wicker Park) → text via tenant-ai's relay: address · price · beds · link.
- Poll cadence 15–30 min (respect RentCast rate limits + cache). Owner-only, so no
  broadcast-safety concerns.

### M2 — Saved searches (configurable, multi-search, multi-user)
- Persist searches (filter + destination phone/email). One account → many searches.
- Dashboard tab to create/edit/pause a search and see recent matches. This is the
  generalization of the hard-coded Wicker Park alert.

### M3 — Buyer-intelligence layer (the differentiation — your civic/GIS edge)
Per matched listing, enrich from the LEGIT neutral-tier sources you already master:
- **True cost to own**: taxes (county assessor) + est. insurance + HOA.
- **Neighborhood truth**: nearby permits, code violations, flood/enviro risk
  (your enviro-map pipes), schools, crime.
- **Deal check**: price vs comps + days-on-market + price history (from the listing
  provider / RentCast value estimate).
- Rendered as a per-listing "buyer report" — the thing portals don't give buyers.

### M4 — Provider graduation + stacking
- Add `SimplyRETS`/`Bridge` adapter behind the same interface; then `MRED` when
  access lands. **Cross-source dedup** (same property from two feeds → one listing,
  matched on address/MLS#). Track per-provider new-listing latency to prove the
  upgrade. Config picks active provider(s); no downstream changes.

### M5 — Productize for buyers
- App UI: map + list, saved searches, per-listing buyer report, notification prefs,
  auth. Reuse the dashboard shell.
- Monetization ladder: **personal (free)** → **buyer subscription** (unlimited
  searches + full reports) → **agent/investor tier** (crosses over with the
  motivated-seller lead idea).

### M6 — Compliance, hardening, go-live
- **IDX/RESO display rules** (once on MLS data): required attribution, no data
  commingling, refresh cadence, opt-out honoring — these are strict; follow them.
- Rate-limit + cache each provider; monitoring + a needs-key/failed-provider fail-soft
  (fall back to another adapter). Stress-test the dedup + alert loop.

## Reuse from tenant-ai (don't rebuild)
- SMS relay → alert delivery. Poll→dedup→notify → the alert engine. County GIS/enviro
  scrapers → the intelligence layer. Dashboard shell → saved-search UI. Config store →
  provider keys.

## Differentiation / why it's defensible
Raw listings are commoditized — nobody beats the portals on inventory. The moat is
**instant alerts on tight criteria + the buyer-intelligence layer** (public-record
truth the portals bury), both of which lean on data pipes you already own.

## Decisions to make
1. **Target buyer** — for-sale home buyers vs apartment renters? (Changes filters +
   whether rental endpoints matter; RentCast does both.)
2. **Start standalone or inside tenant-ai?** (Standalone app vs a new module reusing
   its relay/config/GIS directly.)
3. **RentCast tier** — which plan (call volume vs cost) for the poll cadence.

## Non-goals
- No scraping realtor.com / Zillow consumer / any protected aggregator (licensed-data
  + ToS + anti-bot risk).
- Not competing on inventory breadth — competing on alert speed + buyer intelligence.
