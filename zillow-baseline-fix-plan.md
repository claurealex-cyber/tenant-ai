# Zillow Automation — Only Text Leads Imported AFTER Go-Live — Fix Plan (BUILT 2026-08-27)

**STATUS: BUILT & LIVE-GATED.** M1 (createdAt-only boundary in `sendSurveyBatch` + set-once "now" baseline in the toggle route, preserved on re-enable, with resetBaseline), M3 (AutomationPanel copy: "New leads only — the N existing leads will NOT be messaged" vs "Include backlog"), M5 gate all done. Read-only live gate against the real 196 leads: **baseline=now → 0 eligible**; add one new lead (even with a 90-day-old inquiry) → it is the ONLY one eligible; existing leaked = false. 42 tests green (createdAt boundary, re-import stability, set-once/reset baseline). Full suite: only pre-existing zillow-import litter fails.

Build lesson: `tsc` (the production build) compiles test files, so a null-check gap in a test broke the build and crash-looped the launcher — always run `tsc` after test edits, not just vitest.



**rev. 2 root fixes (verified against `zillow-import.ts` / `zillow-send.ts` 2026-08-27):**
- (a) **The `firstContactAt` age-window must NOT apply in "New leads only" mode.** `sendSurveyBatch` also filters `firstContactAt >= now-60d` (unless `includeOlder`). With a `createdAt` baseline, a genuinely-new lead imported after go-live but whose Zillow inquiry is >60 days old would be wrongly dropped by that window — re-introducing the inquiry-date dependency the fix removes. → In new-only mode the boundary is **`createdAt >= baseline` ALONE**; the age window is used only in "Include backlog".
- (b) **`createdAt` is set-once and survives re-import** — the `ingestLeads` update block never writes `createdAt` (Prisma `@default(now())` fires only on create), so an existing lead re-scraped every hour keeps its original `createdAt`. This is WHY a createdAt baseline is stable and the 196 existing leads stay excluded forever. (Verified: the update touches name/firstContactAt/etc., never createdAt.)
- (c) **Drop the "move existing leads to status='backlog'" idea (was M2b).** `STICKY_STATUSES = {invited, applied, opted_out}` — "backlog" is NOT sticky, so the next hourly re-import would reset it to "new" and it would become auto-eligible again. The createdAt baseline (re-import-stable, per (b)) is the correct, robust guard. If a visual "backlog" bucket is ever wanted, it MUST be added to `STICKY_STATUSES`.
- (d) **Baseline is set ONCE (first enable) and preserved on re-enable.** Setting `baseline=now` on every enable means a disable→(import happens)→re-enable would skip the leads imported while off. → On enable in new-only mode, set `auto_baseline=now` **only if none exists**; re-enable keeps the existing baseline. Provide an explicit "Reset baseline to now" control for a deliberate fresh start.



## How this matches the ask ("compare to existing, only add new, message only new")
The behavior is two mechanisms working together:
1. **Only ADD new leads to the list** — ALREADY WORKS. Each scrape runs `ingestLeads`, which compares every scraped lead to what we already have (by phone or name + property): an existing lead is UPDATED in place (no duplicate); a never-seen lead is CREATED (status `new`). Re-scraping the 200 adds zero duplicates.
2. **Message only the NEWLY-ADDED leads** — this fix. A lead is "newly added" exactly when `ingestLeads` CREATES it (sets `createdAt`, which is then never changed by re-imports — rev. 2b). The automation texts only leads whose `createdAt` is after go-live. So the ~196 leads already in the list are grandfathered and never auto-texted; only leads a later scrape ADDS get a message.

Net: exactly what was asked — compare each scrape to the existing list, add only the new ones, and message only those new ones. (Manual per-lead send still works on any lead.)

## Problem (verified 2026-08-27)
The user wants: when the automation is enabled, ONLY leads that populate AFTER go-live get texted; the ~196 leads already in the DB must NOT be messaged. Current behavior does NOT guarantee this:
- `sendSurveyBatch` filters the auto-baseline on **`firstContactAt`** (Zillow inquiry date), falling back to `createdAt` only when `firstContactAt` is null.
- Enable sets baseline = **midnight today** ("today" mode).
- Of the 196 existing `new` leads: 191 inquired before today, 2 today, 3 null → **5 would be texted immediately** on enable. And filtering on inquiry date is the wrong axis: "leads we already have" is defined by **import/discovery time (`createdAt`)**, not when the renter inquired.

## Fix (root): baseline on IMPORT time, set to the go-live moment
Define the boundary as **`ZillowLead.createdAt >= go-live timestamp`** — the moment we imported the lead, not the inquiry date. Every lead currently in the DB has `createdAt` before go-live → excluded; anything scraped after go-live → included.

### M1 — Filter the auto-baseline on `createdAt` (import time); set-once baseline
- `sendSurveyBatch`: in **new-only mode** the boundary is **`createdAt >= since` ALONE** — replace the `firstContactAt`-primary OR AND drop the `firstContactAt` age-window for this path (rev. 2a). The `includeOlder`/"backlog" path keeps the age window.
- `auto-toggle` enable (new-only): set `auto_baseline = now` **only if no baseline exists yet** (rev. 2d); re-enable preserves it. "Include backlog" sets `new Date(0)`. Add a "Reset baseline to now" action.
- Rename modes: **"New leads only" (default)** vs **"Include existing backlog"**.
- **Why it's stable:** `createdAt` is set-once and untouched by re-import (rev. 2b), so the 196 existing leads keep `createdAt < baseline` forever, even as the hourly scrape re-imports them.
- **Stress:** 196 existing `new` leads → `sendSurveyBatch({ sinceDate: now })` **eligible = 0**; re-run the hourly import (re-scrape) then the batch again → STILL 0 (createdAt unchanged); a lead with `createdAt > baseline` → eligible; a new lead with a >60-day-old inquiry imported after go-live → STILL eligible (age window not applied in new-only); disable→enable doesn't move the baseline forward → leads imported while off are NOT skipped.

### M2 — Grandfather = the set-once createdAt baseline (no status change)
- The guard IS the set-once `auto_baseline` (rev. 2d) + the createdAt filter (rev. 2b) — no status mutation needed, and status-mutation would be fragile anyway (rev. 2c: re-import reverts non-sticky "backlog"→"new"). Existing leads stay `status:"new"` (still manually sendable) but never auto-eligible.
- **Stress:** after enable, the 196 stay `new` and manually sendable but are never auto-picked, even after several hourly re-scrapes; clearing/resetting the baseline is the ONLY way to make them eligible, and it requires the explicit "Reset baseline" action.

### M3 — Enable UX shows the guarantee
- The enable confirm dialog states: **"Automation will text only leads imported from now on. The 196 existing leads will NOT be messaged (you can still send those manually)."** Show the current excluded count.
- **Stress:** the dialog's excluded count matches `COUNT(status='new')` at enable; picking "Include existing backlog" changes the copy to warn it WILL text the backlog (subject to caps).

### M4 — Manual sends unaffected
- The per-lead "Send/Resend" button and the "Send batch" action are OPERATOR actions — they may still send to existing leads on demand (that's intended). Only the AUTOMATION honors the go-live baseline.
- **Stress:** manual send to an existing backlog lead still works; the automation tick skips it.

### M5 — Live gate
- Set baseline = now, run `runDailyAutomation({ force: true })` (dry, future-safe) → batch eligible = 0 against the 196 existing.
- Import one synthetic lead with `createdAt = now` → next automation tick makes exactly that lead eligible; the 196 remain untouched.
- Confirm across two hourly ticks WITH a re-scrape in between (which re-imports the 196): their `createdAt` is unchanged, so eligible stays 0; only the post-go-live synthetic lead is auto-texted.

## Files
- `apps/server/src/services/zillow-send.ts` (new-only boundary = `createdAt >= since` only; age-window kept for include-backlog).
- `apps/dashboard/src/app/api/admin/zillow/auto-toggle/route.ts` (baseline = now ONLY if unset; preserve on re-enable; "Reset baseline" action; mode labels).
- `apps/dashboard/src/app/admin/zillow/AutomationPanel.tsx` (mode copy + excluded-count guarantee).
- Tests: `zillow-send` (createdAt baseline excludes existing, includes new-with-old-inquiry), `zillow-auto` (enable→now baseline), toggle route.

## Note
This changes ONLY the automation's eligibility boundary. It does not touch the dedupe (still only-new leads), the caps, or manual sends.
