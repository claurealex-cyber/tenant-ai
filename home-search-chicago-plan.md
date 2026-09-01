# Home Search — Chicago-wide Compiled Dataset + Filterable Browse

Evolves the Home Search tab from single-saved-search alerts into a **compiled,
city-wide listings dataset** you can browse and filter by **price** and **location
(Chicago neighborhood/ZIP)**, with full **addresses**. Builds on what's shipped:
BuyerSearch/BuyerListing, the #1+#2 SearchProvider (snippet extract + readable verify),
the two-stage engine, and the tab.

## Honest scope (what "all listings" means)
Compilation runs on the compliant public path (Brave discovery + readable-source
verify), so the dataset is the **publicly-discoverable slice, growing per sweep** — not
the full MLS. Coverage deepens over time and with the readable neighborhood-page scan;
true completeness still needs a licensed feed (RentCast/MLS) as an optional provider.
No scraping protected aggregators. Every row keeps source + URL + verified_at.

## Architecture decision — a canonical city-wide dataset
Today BuyerListing is scoped to one searchId. To compile city-wide and filter across
everything, decouple the DATA from the ALERTS:
- **`ChicagoListing`** — canonical, one row per property (deduped city-wide by
  normalized address+unit). The browsable dataset.
- **`BuyerSearch`** stays, but becomes a **saved filter/alert** over the canonical
  dataset (price + neighborhoods + beds), not the owner of rows.
- The compilation sweep writes `ChicagoListing`; alerts diff new canonical rows against
  each saved search's filter.

## Milestones

### M0 — Canonical dataset model + migration
- Add `ChicagoListing` (all BuyerListing fields + `neighborhood`, `communityArea`,
  city-wide unique on normalized address+unit, `firstSeenAt`, `lastSeenAt`,
  `priceHistory`, `verifiedAt`, source/url provenance). Non-destructive migration.
- Backfill: fold existing BuyerListing rows into it. BuyerSearch keeps its alert role.

### M1 — Chicago location reference
- Static reference: Chicago neighborhoods / 77 community areas → member ZIPs +
  centroid (lat/lng). Used for (a) the location filter options and (b) tagging each
  listing to a neighborhood. Ship as a checked-in data file.

### M2 — City-wide compilation sweep (budget-aware)
- A sweep engine over `neighborhoods × price-bands` using the #1+#2 provider:
  discover → pre-filter → verify → upsert `ChicagoListing` (city-wide dedup).
- **Budget guard:** Brave free tier ~2k q/mo. Sweep is ROLLING — N neighborhoods per
  run, round-robin, config-driven cadence; track `lastSweptAt` per neighborhood so
  coverage rotates. Log coverage + skipped (never silently truncate).
- Add readable neighborhood-page scan (Movoto `/chicago-il/{hood}/condos/`) to deepen
  coverage where Brave snippets are thin (that is where the real sub-$250k units were).

### M3 — Neighborhood tagging + geocode
- Tag each listing with neighborhood/community area: zip→neighborhood first; optional
  geocode (address→lat/lng→area) for rows missing a mappable zip. Powers the location
  filter and a future map.

### M4 — Dashboard: filterable browse UI (the core ask)
- Rebuild the tab's dataset view as a **city-wide browser** with controls:
  - **Price** min/max (inputs + quick bands).
  - **Location** multiselect (Chicago neighborhoods/community areas).
  - **Beds/baths**, **status** (active default), **property type**, keyword.
  - Sort (price, newest, DOM); pagination; result count.
  - Table shows full **address** (+ unit, neighborhood, price, bd/ba, status, DOM,
    source link). `overflow-x` safe.
- Server-side filtered query endpoint (`GET /api/admin/home-search/dataset` with
  price/neighborhood/beds/status/sort/page) hitting `ChicagoListing`.

### M5 — Map view (optional)
- Plot filtered addresses on a Chicago map (geocoded lat/lng), price/location filters
  applied. Self-contained (no external map key if using a static/canvas approach).

### M6 — Saved searches as alerts over the dataset
- Repoint BuyerSearch alerts to diff NEW `ChicagoListing` rows matching each saved
  filter → text via the relay (reuse existing alert plumbing + baseline/dedup). The
  browse UI and the alerts now share one dataset.

### M7 — Hardening + tests
- City-wide dedup (same property across neighborhoods/sources → one row); neighborhood
  tagging correctness; filter-query correctness (price/location/beds/sort/page);
  budget-guard + rolling coverage; sweep is fail-soft per neighborhood. Fixture-based
  engine tests (zero API cost) + filter-endpoint tests.

## Reuse
- #1+#2 provider, two-stage engine, the relay, the tab shell, config store, the
  applicant-style non-destructive migration flow.

## Compliance / budget (unchanged commitments)
- Public discovery + readable verify only; no protected-aggregator scraping; provenance
  per row. Rolling, budget-guarded sweep to stay within the Brave free tier; log
  coverage so "compiled all" never overstates what was actually swept.

## Decisions to confirm
1. Neighborhood granularity: the 77 community areas, or the ~200 popular neighborhood
   names? (Community areas are cleaner to map to ZIPs.)
2. Property scope: condos only (current) or include single-family/multi/townhome?
3. Sweep cadence + neighborhoods-per-run, tuned to the Brave tier you are on.
