# Zillow Leads — On-Command "Scrape & Add New Leads" Button — Plan

**Reality check:** a working button ALREADY exists — `runImport()` → `POST /api/admin/zillow/import` → `runZillowImport()` (Safari scrape → dedupe → add only new leads), showing "Import complete: N found, M new" with needs-login handling and a 180s timeout. This plan **enhances** it into an obvious, well-feedback'd on-command scrape (not a new/duplicate button).

## Current state (verified 2026-08-27)
- Button at `page.tsx` ~226, `disabled={importing}`, description "Imports inquiries from Zillow Rental Manager (via the signed-in Safari session)". Banner shows found/new counts; `needs-login` handled.
- After import it `load()`s the leads; the tab also auto-refreshes (built earlier).
- New leads land as `status:"new"`; the tab already highlights rows added in the last hour (by `createdAt`).

## Milestones

### M1 — Make it obviously a "scrape now" action
- Relabel to **"Scrape Zillow now"** with a scraping spinner ("Scraping Safari… ~20s") while running; disable during run (exists). On success, banner: **"Added N new leads (K total inquiries scanned)."** On zero: "No new leads — you're up to date."
- Keep it prominent at the top of the tab next to the automation status line.
- **Stress:** rapid double-click → only one scrape (disabled during run); success/zero-new/needs-login/error each show the right message; the button re-enables after.

### M2 — Highlight what was just added
- After a scrape, capture the returned new-lead count and **flash/highlight the newly-added rows** (createdAt within the last minute, or the run's `importRunId`), and jump the table to show them (clear the status filter / sort newest-first so new leads are visible).
- A small "N new since last scrape" chip that clears on next scrape.
- **Stress:** a scrape that adds 3 → those 3 are highlighted and visible without scrolling/filtering; a scrape that adds 0 → no highlight, "up to date"; highlight fades after a few seconds.

### M3 — Safari login / failure UX
- On `needs-login`: a clear callout "Safari isn't signed into Zillow Rental Manager — open zillow.com/rental-manager in Safari, sign in, then Scrape again," with the button staying enabled to retry.
- On timeout/other errors: show the reason; never leave a stuck spinner.
- **Stress:** logged-out Safari → login callout, no crash, retryable; a mid-scrape API drop → error banner, button re-enabled; a stale `running` import row (crashed) is reclaimed on the next scrape (server already does this).

### M4 — Wire into counts + auto-refresh
- After a scrape, refresh the counts/header (total, new-awaiting-send) and the leads list (already `load()`); ensure the auto-refresh signature picks up the change so the tab stays current.
- Optionally show the last scrape time + result inline ("last scrape 3:12 PM — 2 new").
- **Stress:** counts update immediately post-scrape; the 2-min auto-refresh doesn't double-count; leaving the tab and returning shows the latest.

### M5 — Live gate
- Click "Scrape Zillow now" with Safari signed in → extraction runs, new leads (if any) appear highlighted, banner shows the count, counts update — no page reload.
- Log out of Zillow in Safari → Scrape → login callout, retry after signing in succeeds.
- Confirm the manual scrape and the hourly automation share the same dedupe (a lead added by one isn't re-added by the other).

## Files
- `apps/dashboard/src/app/admin/zillow/page.tsx` (relabel, spinner copy, new-lead highlight + chip, login callout, last-scrape line).
- (No server change — `runZillowImport` already returns `{status, leadsFound, leadsNew, runId, error}`; optionally surface `importRunId` to the client for precise highlight.)

## Notes
- This is a MANUAL trigger of the same pipeline the hourly automation uses — same Safari scrape, same dedupe, same "only new" semantics. No new scraping code.
- Scraping is Safari-login-dependent and ~15–30s; the 180s timeout already covers it.
