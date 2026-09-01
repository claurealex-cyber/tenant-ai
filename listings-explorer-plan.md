# Listings Explorer — new tab (all types, structured, index-first)

A NEW dashboard tab that applies the Rogers Park findings: ALL property types
(single-family / condo / townhome / multi / land), structured data, index-first
coverage, no mandatory price cap — filterable by type + price + location, with
addresses and source links.

## Data-source stance (the "API discovery" decision)
- **NOT reverse-engineering aggregator internal APIs** (Movoto/Compass/CCF/etc.).
  They serve MLS-LICENSED listings — same tier as Zillow/realtor.com — so pulling
  their catalogs via a private API into a redistributable dataset crosses the
  licensed-data + ToS line. Consistent with every prior call this session.
- **Structured data via a LICENSED API instead:** **RentCast** (all types, by
  location, structured JSON, cheap/free tier) is the sanctioned "API" — the clean
  version of what "API discovery" was reaching for. ATTOM/SimplyRETS as heavier
  options later.
- **Free fallback = compliant public read:** read a readable neighborhood INDEX
  page and LINK OUT (what the tab already does), never an internal API, never
  bypassing anti-bot. Every row keeps source + URL + verified_at.

## Provider model (two interchangeable providers behind one interface)
`ListingsProvider { fetchArea(area, filter) -> Listing[] }`
- **RentCastProvider** (primary, licensed, structured — all types).
- **PublicIndexProvider** (free fallback): fetch the readable index page, parse rows.
Config picks which is active; the tab works with either.

## Milestones

### M0 — Data model + provider interface
- Reuse/extend `ChicagoListing` with `propertyType` (single_family|condo|townhome|
  multi|land|coop) + `typeSource`/`typeConfidence` (classify from signals, not just
  the source label — a 12-unit was mislabeled "Single-Family"). Non-destructive
  migration. Define `ListingsProvider` + a `FixtureProvider` for zero-cost tests.
- **Stress gate:** fixture provider drives ingest; type-classification unit tests
  (beds/unit-count ⇒ multi; unit suffix ⇒ condo; label = tiebreaker).

### M1 — RentCastProvider (licensed, structured, ALL types)
- `fetchArea` → RentCast listings endpoint by zip/lat-lng+radius, ALL property types,
  no forced price cap. Map to normalized Listing (type included). Fail-soft w/o key.
- **Stress gate:** injected-fetch tests (parse all types, price/beds/status/type,
  pagination); no-key no-op.

### M2 — Ingest + dedup (the gotchas)
- Upsert into ChicagoListing city-wide. Dedup rules from the live run: normalize
  suffix (Ave/Dr/Ter/Blvd) OUT of the key but keep for display; fractional street #s;
  unit-token variants (#G / Unit G / folded-into-street); address RANGES for multis
  (canonical = low #); "Undisclosed" rows keyed on price+beds+sqft+zip; DO NOT
  collapse two same-price units in one building.
- **Stress gate:** dedup tests for each gotcha; two-same-price-units stays two rows.

### M3 — ZIP↔neighborhood mapping + area scan
- Map each configured ZIP → neighborhood slug(s) (60645 ⇒ west-ridge, NOT rogers-park).
  Scan by neighborhood; a "compile area" pulls all types for that area.
- **Stress gate:** mapping table test; area→slug resolution.

### M4 — New tab: Listings Explorer
- Filters: **property type** (multiselect), price min/max, location (neighborhood),
  beds/baths, status; sort; pagination. Table: address (+unit), type, price, bd/ba,
  sqft, status, DOM, source link. "Compile area (all types)" + provider indicator.
- Sidebar nav entry. Server-side filtered `/dataset` (extend with type filter).
- **Stress gate:** dataset filter tests (type/price/location); UI debounce+cancel
  (reuse the Browse fixes); tab route present in build.

### M5 — Free public-index fallback (compliant)
- `PublicIndexProvider`: fetch the readable index page, parse structured rows, all
  types, link out. Used when no RentCast key. Same normalize/dedup/ingest path.
- **Stress gate:** injected-fetch parse test on a captured index-page fixture;
  provider switch honors config.

### M6 — Full stress + go-live
- Concurrency guard (one compile at a time — reuse), budget guard, coverage logging,
  fail-soft per area. Full suite green. Re-compile Rogers Park to prove the coverage
  jump (all types vs condos-only).

## Non-goals
- No reverse-engineering aggregator internal APIs; no anti-bot evasion; no
  government/distressed sources. Structured data comes from a LICENSED API (RentCast);
  the free path only reads public pages and links out.

## Decisions to confirm
1. RentCast tier / key (structured all-types) vs start on the free public-index path?
2. Reuse ChicagoListing (shared dataset with Home Search) or a separate table?
3. Which property types in scope at launch (all, or exclude land/coop)?
