# Public Listing Search → Dataset Pipeline

Turns the ad-hoc "find ≤$250k homes near Wicker Park" search into a repeatable,
compliant, scheduled job that emits a normalized **dataset**. Plugs into the
provider abstraction from `buyer-finder-plan.md` (each source = an adapter).

## Compliance guardrails (non-negotiable — these define "public search")
- **Public data only:** search engines + public/government sources. No protected
  aggregator internal APIs (Zillow/realtor.com/Redfin consumer listings).
- **Read what a human could open**, and **link out** — store the source URL per row.
- **Skip, never bypass:** if a source blocks automated access (anti-bot, login,
  CAPTCHA), log it as `blocked` and move on. No workarounds, no logins, no evasion.
- **Be a good client:** honor robots/rate limits, cache, human-paced cadence.
- **Provenance on every row:** source + URL + fetched_at, so the dataset is
  refreshable and defensible.

## Inputs (the query spec — one row per saved search)
```
{
  areaTag:      "wicker-park-250k",
  zips:         ["60622","60647"],
  center:       { lat: 41.9086, lng: -87.6773 }, radiusMi: 1.5,
  adjacent:     ["West Town","East Village","Ukrainian Village","Humboldt Park","Logan Square","Bucktown"],
  priceMax:     250000, priceMin: null,
  beds: null, baths: null, propertyType: null, keywords: null
}
```

## The steps (one run) — VALIDATED two-stage flow (Fable run 2026-08-31)
The run proved this must be **discover → VERIFY-per-candidate**, not one pass. Snippets
and even list-page cards are frequently stale (3 of 5 snippet candidates were already
SOLD). Nothing counts until a live MLS-fed detail page confirms it Active today.

**Stage 1 — Discover (cheap, wide):**
1. Run the discovery query templates (below) + fetch the readable neighborhood pages.
   Snippets carry price/address/beds even when the underlying site blocks fetch.
2. Extract candidates. **Pre-filter hard here** to avoid wasting verify fetches:
   drop price < ~$90k, beds < 1, or type ∈ {Land, Parking}; drop MLS ids that look
   stale by the sequential-id heuristic (below).

**Stage 2 — Verify (one detail fetch per surviving candidate — unavoidable):**
3. Fetch the candidate's Movoto detail page (or @properties MLS page — the status
   oracle). **Confirm status = Active TODAY** and pull the fields missing from cards
   (sqft, DOM, HOA, MLS #, remarks). A card can read Active while the detail says
   Contingent — trust the detail.
4. **Quality screen** from remarks: keep move-in signals (rehabbed / updated / hardwood
   / in-unit laundry / granite+stainless); drop "as-is / investor / cash only / TLC /
   estate sale". Flag garden units (`#G/GN/GS`) for the human (light/flood).

**Then:**
5. **Filter** to area (zips OR center+radius) AND ≤ priceMax.
6. **Dedup** — key on normalized address+unit (see rules); merge across sources, keep
   all source URLs; canonicalize via the Movoto `461_{id}` detail URL.
7. **Persist** — upsert: insert new, update changed price/status, mark rows not seen
   this run `stale`; append price/status changes to `price_history`; stamp `verified_at`.
8. **Emit** — only rows that VERIFIED Active-and-new since last run → alert via the relay.

### Query templates (validated)
- **Discovery:** `{neighborhood} Chicago condos for sale under ${priceMax} {zip}`
- **Verification (mandatory, per candidate):** `"{streetNo} {streetName}" {unit} Chicago condo for sale`
- **Anti-pattern:** the `site:` operator — the engine ignores it unreliably; don't depend on it.

## Normalized dataset schema
```
listing_id      (stable: hash of normalized address+unit)
source          (movoto | chicagocondofinder | compass | atproperties | propertyrocks | snippet)
source_url      (public link — provenance); canonical_url (Movoto 461_{id})
fetched_at
address, unit, zip, lat, lng
price, beds, baths, sqft, property_type
mls_number      (MRED — event id, for reference only, NOT the key)
status          (active | contingent | pending | closed | removed | stale)
verified_at     (when status was confirmed on a live MLS-fed detail page — null = unverified)
listed_date, days_on_market, hoa
remarks, quality_flags   (move_in | garden_unit | as_is ...)
first_seen_at, last_seen_at
price_history   [{ price, seen_at }]
area_tag        (which saved search matched)
blocked_sources [] (per-run coverage note)
```

## Storage
- **MVP:** append to `datasets/listings-<area>.csv` (or Parquet) — a portable dataset.
- **Product:** a `BuyerListing` Postgres table in tenant-ai (queryable + drives the
  alert engine). Same columns as above.

## Cadence
- Scheduled job (cron), conservative to respect source limits. Each run diffs against
  the stored dataset → only genuinely new rows alert. Cadence config-driven.

## Mapping to code (reuse the provider abstraction)
- `ListingProvider { discover(filter) → Candidate[]; verify(candidate) → Listing|null }`.
  Adapters: `SearchProvider` (Brave/SerpApi discovery), `MovotoProvider` (verify
  workhorse), `AtPropertiesProvider` (status oracle), optional `RentCastProvider`
  (licensed structured). No government providers.
- Engine = discover → pre-filter → verify → filter → dedup → upsert dataset → diff → notify.
- **Output = the dataset** (table or CSV) + optional alert. The dataset is the
  deliverable; the alert is a view on top of it.

## AI ↔ code bridge
The pipeline is deliberately half deterministic code, half AI judgment. The seam
between them is a **schema-validated JSON handoff**: the model does the fuzzy
extraction/judgment on a page and emits a `Listing` object; code validates it and owns
everything else. That JSON contract IS the bridge. (Same mechanism tenant-ai already
uses — intake-qa wraps an LLM in deterministic handler code; Iris/Workflow force
structured output with a schema; Anthropic tool-use returns validated JSON.)

**Split by determinism:**
| Deterministic CODE owns | AI/LLM owns |
|---|---|
| cron, HTTP fetch, rate-limit, cache | read messy snippet/HTML → extract fields |
| price/area filters, dedup KEY (address+unit) | judge quality vs distressed from remarks |
| DB upsert, diff, alert delivery, provenance | confirm status / resolve "same property?" |
| the MLS-id freshness math (once codified) | the ambiguous calls code can't express |

**Wiring — tiered (recommended):** code does the mechanical fetch + cheap regex/
heuristic pre-filter; **escalate to the LLM only for survivors** (the ~2–3 candidates
that passed the hard filters and need status/quality judgment). LLM runs on a handful,
not on every raw result. Fallbacks: `LLM-as-extractor` (code fetches, LLM+schema
returns one Listing) for the simple path; `agent-per-run` (Iris/Agent SDK) only if the
verify stage needs full agent flexibility.

**The verify-stage LLM contract (the literal interface):**
- IN: the fetched detail-page text/HTML + the candidate stub (address, url).
- OUT (schema-forced JSON, validated by code before persist):
```
{ address, unit, zip, price, beds, baths, sqft, property_type,
  mls_number, status:            "active|contingent|pending|closed",
  days_on_market, hoa, listed_date,
  is_quality: boolean,           // move-in vs distressed, from remarks
  quality_flags: string[],       // ["move_in","garden_unit","as_is",...]
  confidence: 0..1 }
```
Code rejects non-conforming JSON, drops `status != active` and `is_quality=false`, and
never lets the LLM touch scheduling, dedup keys, or the alert send.

**Promote-to-code loop (the bridge shrinks over time):** every stable rule the LLM
discovers becomes deterministic code, so the LLM is called on fewer cases each
iteration. Already promoted from the run: the price/beds/type non-home filter, the
MLS-id freshness heuristic, the quality keyword lists. Keep harvesting these from LLM
output → cheaper, more reproducible, less model dependency.

## Source map (validated 2026-08-31 — the adapter baseline)

| Source | Role | List URL pattern | Fields on list card | Detail-page fields | Notes |
|---|---|---|---|---|---|
| **Movoto** ⭐ | workhorse | `/chicago-il/{hood}/condos/` | price, address+unit, beds, baths, sqft*, status badges, detail URL | MLS #, HOA, DOM, remarks, year | detail `461_{id}` has everything; tolerates stale ids (redirects to current → canonicalizer). Price-filter & page-2 URL grammar unknown → **fetch full neighborhood page, filter client-side** |
| **ChicagoCondoFinder** | MLS# + status | `/{area}-real-estate/{lo}-{hi}/` (band) or `/{hood}-condos-for-sale.php` | address, price, beds, baths, **status incl. Contingent**, **MLS #** on the card | — | only source with MLS# on cards; `?p=N`, price-DESC → use the band URL |
| **@properties** | status oracle | (not guessable) `/{mls}/{slug}` | — | **authoritative status incl. Closed + sold price**, beds/baths/sqft, HOA, list date, remarks | get the URL from a quoted-address search; use to VERIFY |
| **Compass** | secondary | `/homes-for-sale/{hood}-chicago-il/condos/` | price, address, beds, baths, status | HOA, DOM | JS lazy-load → **coverage unreliable**, do a count-sanity check |
| **PropertyRocks** | wide, noisy | `/{hood}/` | address, price, beds, type | — | MLS-fed but mixes in parking/land → must type/price-floor filter |
| **Zillow / Redfin / Trulia / Homes.com** | snippets ONLY | — | price, address, beds, MLS# via search snippet | **fetch 403** | snippet data **frequently stale** — discovery only, never trust status |

**Blocked / dead (recorded, no workaround):** redfin.com 403 · homes.com 403 · trulia 403 · realestate.com DNS ENOTFOUND.
**Deliberately OUT:** government/foreclosure (HUD/Fannie/Freddie/Cook County) — distressed, not quality.

## Dedup + freshness rules (validated)
- **Primary key = normalized street address + unit.** Normalize `Ave`↔`Avenue`,
  `#307`/`APT 307`/`Unit 307`/`-307`, garden `#G`/`GN`/`GS`. Same building ≠ same unit
  (2129 vs 2131 vs 2137 N Kedzie) — match the unit exactly.
- **MLS # = a listing EVENT, not a property** — re-lists get new numbers (500 N Damen
  #307 cycled 10878771 → 10987746 → 12611275). Don't key on it.
- **MRED-id freshness heuristic:** ids are roughly sequential; current mid-2026
  listings run ~126xxxxx–127xxxxx. A snippet quoting an `118xxxxx`/`108xxxxx` id is a
  2023/2020-era listing → treat as **stale until verified**.

## Extraction filters (validated — bake into stage 1/2)
- Non-home filter: `price ≥ ~$90k AND beds ≥ 1 AND type ∉ {Land, Parking}` (killed
  the $9,500 "condo" parking space and $28k land).
- Status truth: only a **live Movoto-detail / @properties page** counts as Active; a
  snippet or list card does not.
- Quality remarks screen (keep vs drop lists above). Flag garden units for the human.

## Non-goals
- No scraping protected aggregator listings (licensed data + ToS + anti-bot).
- No government/foreclosure/REO sources — they skew distressed, not quality.
- Not full-MLS coverage — QUALITY listings via compliant search-snippet discovery of
  MLS-fed aggregators, plus optional RentCast (licensed) for structured data.
