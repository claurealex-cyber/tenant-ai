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

---

## Workflow improvements from the Rogers Park comparison (2026-09-01)
A Fable agent searched Rogers Park across ALL property types with call logging and
compared to the tab's pipeline. Key findings, ranked by impact:

1. **Index-page-first, not snippet-search (biggest win).** ONE fetch of
   `movoto.com/chicago-il/{slug}/` returned 50 structured listings (price/addr/unit/
   beds/baths/sqft/type/status); one `compass.com/homes-for-sale/{slug}-chicago-il/`
   returned all 45 with type + Coming-Soon. SEVEN Brave queries produced ~20 partly-
   stale snippet listings. → Make discover() FETCH the readable neighborhood index
   pages first; Brave becomes the fallback (find index URLs / addresses they miss).
2. **All property types, not "condos".** Condos-only missed 100% of single-family
   (8 in RP, $475k–$795k), all multi-family ($549k–$5.7M), townhomes, land. Add
   Movoto type sub-indexes (`/for-sale/chicago-il/{slug}/single-family`, `/condos/`)
   + the main index for multi.
3. **Drop the mandatory price cap (or per-type).** A condo-tuned cap (~$300k)
   excludes every non-condo — cheapest SFH was $475k. Store all, filter in UI.
4. **Never trust snippet "active"/price — confirm on a 200-fetched page.** Live
   failure: a snippet said 7228 N Rogers "$415,000 listed"; the page says delisted
   01/31, and $415k isn't even in its price history. Snippet prices drifted $10–20k.
5. **ZIP↔neighborhood mapping.** 60645 ≈ West Ridge, not Rogers Park — portals index
   by neighborhood slug. Map each ZIP → slug(s) and scan each index.
6. **Update source lists from reality:** confirmed 403 today — zillow, redfin,
   homes.com, chicagospropertyshop. **@properties fetches 200 but is JS-rendered
   (stats-only, no prices) → stop wasting a verify fetch on it.** **PropertyRocks
   returned ZERO Rogers Park inventory → drop/deprioritize.**
7. **Classify type from signals, don't inherit labels** (Compass called a 12-unit
   "Single-Family"; Movoto vs Compass disagree condo/townhome/multi). Beds/unit-count
   ⇒ multi; unit suffix ⇒ condo; source label = tiebreaker; store disagreements.
8. **Dedup gotchas seen live:** fractional street #s (7031.5), Ave/Dr/Ter variants,
   unit folded into street (CCF), address ranges for multis (pick low #),
   "Undisclosed" rows (key on price+beds+sqft+zip), two same-price units in one
   building (don't collapse). Normalize suffix OUT of the key, keep for display.
9. **Index pagination + Compass Coming-Soon:** indexes page (Movoto 50/85); only
   Compass exposes Coming-Soon (early-warning inventory) — keep it in the scan.
10. **Best Brave templates:** `site:movoto.com {hood} Chicago for sale` (finds index
    + sub-indexes + detail URLs) and `{hood} Chicago multi family building for sale {zip}`.
