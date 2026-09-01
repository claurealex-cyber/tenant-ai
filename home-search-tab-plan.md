# Home Search Tab — Implementation Plan

Matures the ad-hoc ≤$250k Wicker Park search into a first-class **Home Search** tab in
the tenant-ai dashboard: create saved searches → a scheduled compliant public-search
pipeline fills a browsable dataset → new matches text you via the relay. Pulls together
`buyer-finder-plan.md` (provider abstraction) + `public-listing-pipeline.md` (the steps
+ dataset schema + coverage).

## Reuse (don't rebuild)
- **Config store** (SystemConfig) for keys/toggles · **scheduler** (`registerJob` cron)
  for the run · **relay** for new-match alerts · **DashboardShell** + the `/admin/*`
  route pattern (`requireAdmin` + `proxyToServer` + `/internal/config/refresh`) for the tab.
- The applicants migration proved the non-destructive `migrate deploy` path — reuse it.

## Key architectural decision — how the SERVER does discovery
The Fable run used the agent's WebSearch/WebFetch; the Fastify server can't call those.
Pick a server-callable discovery mechanism (M1 gate):
- **A) Search API** (recommended, mostly free): Brave Search API (free tier ~2k q/mo) or
  SerpApi (paid) → the server issues templated queries, reads public result snippets,
  links out. Clean, HTTP-only.
- **B) Invoke an agent** (richer, heavier): server shells to Iris / a Claude web-research
  agent for discovery. Better extraction, more cost/latency.
Recommendation: **A (Brave) for the scheduled job**, keep B as an optional deep-enrich.
Nice property: the pipeline is **HTTP-only → no Safari GUI lock**, so it never contends
with the Zillow/Text-Em-All browser automation.

## Milestones

### M0 — Data model + migration
- `BuyerSearch` (label, enabled, notifyPhone, priceMax/Min, beds, baths, propertyType,
  zips[], centerLat/Lng, radiusMi, keywords, provider, cadence, lastRunAt) and
  `BuyerListing` (the `public-listing-pipeline.md` schema: listing_id, source,
  source_url, address, zip, lat/lng, price, beds, baths, sqft, propertyType, status,
  listedDate, firstSeenAt, lastSeenAt, priceHistory JSON, searchId, areaTag).
- Hand-authored non-destructive migration + `prisma generate`.

### M1 — Provider abstraction + SearchProvider (discovery mechanism gate)
- `ListingProvider { discover(filter) → Candidate[]; verify(candidate) → Listing|null }`
  + normalized `Listing`. Two methods because verification is mandatory (M2).
- `SearchProvider` via mechanism A (Brave/SerpApi): validated discovery template
  `"{neighborhood} Chicago condos for sale under ${priceMax} {zip}"` → candidates;
  `verify()` fetches the Movoto detail / @properties page for true status + specs.
  Readable sources: **Movoto (workhorse), ChicagoCondoFinder (MLS#+status), Compass
  (secondary), @properties (status oracle), PropertyRocks (filter noise)**; Zillow/
  Redfin/Trulia/Homes = snippets only (403 on fetch). Bake in the validated filters
  (parking/land floor, MLS-id freshness heuristic, quality-remarks screen).
  `FixtureProvider` for zero-cost tests.

### M2 — Pipeline engine (two-stage) + scheduled job
The run proved a single pass is wrong — snippets/cards go stale (3/5 candidates were
already SOLD). The engine is **discover → VERIFY-per-candidate**:
- **Stage 1 discover:** queries + readable neighborhood pages → candidates; hard
  pre-filter (price ≥ ~$90k, beds ≥ 1, type ∉ {Land,Parking}, drop stale-MLS-id ids).
- **Stage 2 verify:** one detail fetch per surviving candidate (Movoto detail /
  @properties MLS page) → confirm **status = Active today**, pull sqft/DOM/HOA/MLS#/
  remarks, run the quality-remarks screen. Only VERIFIED-active rows proceed.
- Then: filter (area + priceMax) → dedup (normalized address+unit; canonicalize via
  Movoto `461_{id}`) → upsert `BuyerListing` (stamp `verified_at`) → diff → **notify
  only verified-active NEW rows** via the relay.
- `registerJob("home-search", cron)` — conservative cadence, config-driven. **Baseline
  on a search's first run** (record seen, don't alert) so existing inventory never spams.
- Cost note: verify = 1 detail fetch per candidate (unavoidable — sqft/DOM/true-status
  aren't on cards); the hard pre-filter keeps that count tiny in this price band.

### M3 — Dashboard tab (read)
- `/admin/home-search` page in DashboardShell + a sidebar nav entry.
- Dataset table of `BuyerListing`: columns price/address/beds/baths/status/DOM/source,
  filters (price, area, status, beds), sort, **"new since last run"** badges, links out.
- GET route (paginated) following the admin-route pattern.

### M4 — Dashboard tab (manage searches)
- Create/edit/pause a `BuyerSearch` (area via ZIPs or center+radius, priceMax, beds,
  notify phone, cadence). Per-search last-run time + match count. **"Run now"** button
  (force a run). POST routes + `/internal/config/refresh`. Alerts ship **OFF** until armed.

### M5 — Broaden QUALITY-listing coverage
Government/foreclosure sources are OUT — the run showed sub-$250k gov/REO inventory is
fixers, multis, and vacant lots, not quality homes. Stay on MLS-fed quality listings,
compliantly:
- Broaden the `SearchProvider` snippet discovery across the readable aggregators the
  run confirmed (Compass, Movoto, ChicagoCondoFinder, @properties, PropertyRocks) so
  more genuine listings surface.
- Add an optional **RentCast adapter** (licensed, MLS-fed, structured quality data;
  free 50/mo tier) behind the same interface for cleaner/fuller coverage when the user
  wants it. Cross-source dedup. Surface per-run coverage/blocked notes in the tab.

### M6 — Buyer-intelligence enrichment (optional, your civic/GIS edge)
- Per listing: true-cost-to-own (assessor taxes + est. insurance/HOA), neighborhood
  (permits, code violations, flood/enviro from your existing pipes), deal-vs-comps.
  Rendered as an expandable "buyer report" row — the thing the portals don't give.

### M7 — Hardening, tests, go-live
- Per-source rate-limit + cache; fail-soft on blocked/needs-key sources; dedup +
  baseline stress tests (mock provider, zero cost); the M2 diff/notify invariant
  (only genuinely-new rows alert). Seed the ≤$250k Wicker Park search; alerts armed by
  the user in M4. Full suite green before deploy (kill API pid → launchd redeploy).

## Testing discipline (as established this session)
- FixtureProvider → test normalize/filter/dedup/baseline with no API calls.
- Assert: parking/land dropped, contingent/stale not alerted as fresh, first-run
  baseline silent, only new rows notify.

## Non-goals
- No scraping protected aggregator internal APIs (Zillow/realtor.com/Redfin consumer).
- No government/foreclosure/REO listing sources — they skew distressed, not quality.
- Not full-MLS coverage — QUALITY listings via compliant search-snippet discovery of
  MLS-fed aggregators, plus optional RentCast (licensed) for structured data.
- Discovery stays HTTP-only (search API), so no browser GUI-lock coupling.

## Open decisions
1. Discovery mechanism: Brave Search API (free) vs SerpApi (paid) vs agent — recommend Brave.
2. Dataset storage: `BuyerListing` table (recommended, drives the tab) vs CSV export.
3. Default cadence given the chosen search-API free-tier limits.
