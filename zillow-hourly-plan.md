# Zillow Hourly Auto-Text New Leads (8am–10pm) — Implementation Plan (BUILT 2026-08-27)

**STATUS: BUILT & LIVE-GATED — auto_enabled is OFF (you flip it on to start real outreach).**
- M1 hourly window: `ZillowAutoRun.slot` (per-hour idempotence key, migration `20260827141500_zillow_auto_hourly_slot`), `localSlot()`, window `[auto_start_hour, auto_end_hour]` (set 8–22); 18 unit tests incl. "later hour same day runs again", window edges, out-of-window.
- M2 message: kept `zillowLeadCopy` = "Ghem LLC 1 (you inquired on Zillow): … {Google Form}"; dedupe already marks only-new leads and never re-texts invited ones.
- M3 send rate: new-lead texts stay relay kind `link` (per-lead cooldown + ~3/hr effective cap, 25/day) — a safe trickle from the personal number; overflow rolls to later ticks. (10DLC removes the cap.)
- M4 config: `auto_start_hour=8`, `auto_end_hour=22`, `default_property_id` set; toggle route extended to accept the window. `auto_enabled` left **false**.
- M5 live gate: on the running server, full pipeline ran — extracted 200 leads from Safari, deduped (0 new), 0 real texts (future-baseline), recorded slot `2026-08-27T09`; 2am tick was a no-op.
- M6 dashboard: AutomationPanel shows the 8–22 hourly window + next run; Leads tab shows delivery ("link sent {date}"), the exact sent message (ⓘ tooltip / hover), and a "Link sent ✓" filter (internal leads route now joins the ledger `body`).

To turn it on: Admin → Zillow Leads → Automation → enable (or set `zillow.auto_enabled=true`). Preconditions: Safari signed into Zillow, Mac awake, app running (launchd). 1544 tests pass; only the 4 pre-existing `zillow-import` litter tests fail (unrelated).



**Goal:** Every hour from 8:00am to 10:00pm, extract Zillow leads from the signed-in Safari session, compare against already-extracted leads, and text each NEW lead the Ghem message with the Google Form application link. Reversible from the dashboard.

## What already exists (verified 2026-08-27)
- `services/zillow-import.ts`: `runZillowImport()` → `runZillowExtraction()` (Safari scrape → raw JSON) → `ingestLeads()` (normalize + **dedupe by name/phone key**; genuinely-new rows get `status: "new"`). Re-import is idempotent (tests: "re-import idempotent", "census flap must not duplicate").
- `services/zillow-send.ts`: `sendSurveyBatch()` → `sendSurveyToLead()` for each `status:"new"` lead → `resolveSurveyLink()` (honors the survey toggle = **Google Form**) → texts `zillowLeadCopy()` via the relay, flips the lead `new → invited`. So an already-texted lead is never re-texted.
- `services/zillow-auto.ts`: `runDailyAutomation()` = import + batch-send, wrapped in a crash-safe claim.
- `jobs/zillow-daily.ts`: registered job, cron `0 * * * *` (hourly tick), `maxRetries:0`.
- Config (`zillow` integration): `auto_enabled`, `auto_hour`, `auto_baseline`, `default_property_id`.

**So the extract → dedupe → text-only-new logic is DONE.** The work is turning a once-daily run into hourly-within-a-window, plus the message and enablement.

## Gaps
1. **Frequency:** `claimDay()` keys on `localDay` → runs ONCE per day (the hourly tick only retries `needs_login`/`failed`). Need a per-HOUR claim so it runs each hour.
2. **Window:** only `auto_hour` (single start hour, `not_in_window` = before it). Need start=8 and end=22.
3. **Enablement:** `auto_enabled` is not `true`.
4. **Message:** `zillowLeadCopy` = "Ghem LLC 1 (you inquired on Zillow): Thanks for your interest! Start your rental application here: {GoogleForm}\n\nTo opt out, text STOP to (708) 907-0695." Decision: keep this, or use the exact intake greeting.

## Milestones

### M1 — Hourly-within-window run (replace day-claim with hour-claim)
- Config: add `zillow.auto_start_hour` (default 8) and `zillow.auto_end_hour` (default 22) to the `zillow` integration; keep `auto_hour` as a deprecated alias for start.
- `zillow-auto.ts`: change the claim key from `localDay` (e.g. "2026-08-27") to a per-hour slot (e.g. "2026-08-27T14"). `claimDay → claimSlot`. The `zillowAutoRun` unique key must be the slot. A tick runs only when `start_hour ≤ localHour ≤ end_hour` (inclusive) and this hour's slot isn't already `done`. `needs_login`/`failed` still leave the slot reclaimable so the next hour retries; `done` consumes just that hour.
- The `zillow-daily` job stays cron `0 * * * *`; the window + slot-claim gate what actually runs.
- **Stress:** two ticks in the same hour → one runs, one gets `claim_lost`; a tick at 7am/11pm → `not_in_window`; a crashed `running` slot older than STALE_RUNNING_MS → reclaimed next hour; the calendar rollover at 22:00→08:00 next day starts fresh slots.

### M2 — New-lead detection + the Ghem message
- Confirm (test) that a second run in the same window texts ZERO already-invited leads and only newly-appeared `status:"new"` leads.
- Message decision (owner): keep `zillowLeadCopy`, OR switch `sendSurveyToLead` to `buildIntakeReply({name, intakeAutoReply:null}, url)` = "Thanks for your interest in {property}! Start your rental application here: {GoogleForm}\n\nReply STOP to opt out." — the same wording texters get. Either way the link is the Google Form (survey toggle).
- **Stress:** google_form mode → the texted link is the Google Form; a lead with no matched property or no phone is skipped (not errored); STOP/opted-out leads are never texted.

### M3 — Send rate under the personal-number relay
- New-lead texts are relay kind `link` (per-lead cooldown + **effective hourly cap 3**, daily 25, new-recipient cap 10/day). So at most ~3 new leads/hour go out from (708) 415-8984; the rest stay `new` and go out on later hourly ticks (the batch re-picks them). Decision: accept the trickle, or raise `hourly_cap`/`daily_cap`, or give Zillow auto-sends a dedicated (higher) cap. Note: 10DLC removes this entirely (sends move to the Telnyx number).
- **Stress:** import 20 new leads → only ~3 texted this hour, rest remain `new`; next hour texts the next batch; no lead double-texted; caps honored.

### M4 — Enable + operability
- Set live config: `auto_enabled=true`, `auto_start_hour=8`, `auto_end_hour=22`, `default_property_id` (the property new leads attach to when address match is ambiguous). Refresh both config caches.
- Preconditions the owner must keep true: **Safari stays signed into Zillow Rental Manager**, the **Mac stays awake** (Energy settings already set), and **Tenant AI stays running** (launchd). A `needs_login` outcome is logged and simply retried next hour — it never consumes the slot.
- Surface per-hour outcomes (ran/new/queued/needs_login) in Admin (the zillow admin pages already exist) so a logged-out Safari is visible.
- **Stress:** logged-out Safari → `needs_login`, no crash, retried next hour; app restart mid-window → next tick resumes; out-of-window ticks are silent no-ops.

### M5 — Live gate
- In-window manual trigger against the running server (`/internal/zillow/*` or the auto path) → extraction runs, new leads imported, new leads texted the Google Form message; a second immediate trigger same hour → `claim_lost`/`already_done` (no double run, no double text). Verify the ledger shows only-new sends and the caps.
- Verify a genuinely new Zillow lead (appearing between two runs) is detected and texted.

### M6 — Dashboard: Leads tab showing all lead info + who got the link
A **Zillow Leads** tab already exists (`/admin/zillow`, sidebar) with a leads table (status new/invited, delivery status, lastError, sentAt), a status filter, the automation panel, and import/send buttons. Enhance it (no brand-new tab needed) so it clearly answers "who are my leads and who got the application link":

- **All-leads table columns:** name, phone, property (matched), lead status (new / invited / opted_out / failed), first-contact time, and `lastMessage` (their latest Zillow inquiry text). Sortable by newest; searchable by name/phone/property.
- **"Application link sent" view:** for each `invited` lead show the delivery detail already tracked — sent ✓ / failed (with reason) / deferred, the `sentAt` timestamp, and the exact message + Google Form link that went out (from the relay ledger `OutboundRelayMessage`, joined by `inviteId`). A quick filter/toggle: All · New · Link sent · Failed.
- **Counters up top:** total leads, new (awaiting send), link-sent today, failed/deferred, + "next hourly run at HH:00" and last run outcome (from `zillowAutoRun`).
- **Per-lead actions (exist):** re-send link, view on Zillow. Add: mark opted-out.
- Data sources already present: `/api/admin/zillow/leads`, `/runs`, `/auto-status`, `/csv`; add a small join to `OutboundRelayMessage` (by `inviteId`) so the sent message text is visible. Reuse the existing page/components; extend, don't replace.

**Stress:** a lead texted this hour shows "link sent ✓" with the Google Form message; a cooldown/failed send shows the reason; an opted-out lead shows opted_out and is excluded from sends; the counters match the ledger.

## Risks / constraints
- **Extraction pulls 200 of 315 (page 1).** Zillow sorts newest-first, so new leads are almost always on page 1 → hourly cadence catches them. If >200 truly-new leads appear in one hour (unlikely), the overflow waits for the importer's later runs — or add pagination later.
- **Scraping frequency:** 15 runs/day through the signed-in session is modest, but Zillow could flag heavy automation; keep it to the window, not 24/7.
- **PII:** raw dumps in `.zillow/` (gitignored) accumulate; add a retention sweep (keep last N) if disk matters.
- **Personal-number caps** throttle sends until 10DLC (M3).

## Files
`packages/shared/src/integrations.ts` (`auto_start_hour`, `auto_end_hour`), `apps/server/src/services/zillow-auto.ts` (slot claim + window), `apps/server/src/services/zillow-send.ts` (message, if changed), config rows; `apps/dashboard/src/app/admin/zillow/*` (extend the existing Leads tab + a ledger join for sent-message visibility). No new job — the hourly tick already exists.
