# Zillow Leads Tab — Manual Send/Retry + Hourly Auto-Refresh — Plan (BUILT 2026-08-27)

**STATUS: BUILT & LIVE-GATED.**
- M1 manual send/retry: **Send/Retry button next to every name** (Send link / Resend / Retry; disabled for opted-out). `sendSurveyToLead(id, { manual })` bypasses the `status!=="new"` guard and sends **kind `link` + `bypassCooldown`** (new relay-meta flag) — kind stays `link` so counters/join are correct. Opt-out + daily cap kept. Batch stays status-guarded (manual defaults false). Live gate: manual got past the status guard (reached opt-out), automation stayed guarded.
- **Cap → retry-after (your ask):** `checkCaps` now returns `{reason, retryAfter}`; a deferred send stores "daily cap — retry after Aug 28, 9:12 AM" on the row + lead, shown in the banner + delivery cell; the sweep refreshes it. `new_recipient_cap` is now **configurable** (default 10 — the carrier-safety guard stays).
- M2 auto-refresh: visibility-gated poll of the small `/auto-status` every 2 min; refetches the lead list only when the automation's totals/last-run changed; pauses when hidden, stops after 3 failures; "refresh now" + "updated HH:MM".
- M3 header: "Automation ON/OFF · hourly 8:00–22:00 · next run HH:00 · updated HH:MM".
- Tests: 70 green across relay/zillow-send/zillow-auto/dashboard (bypassCooldown, manual resend/retry, opt-out, batch-guard, formatCapBlock). Full suite: only the pre-existing zillow-import litter + billing-cycle live-flake fail (unrelated).



**rev. 2 root fixes (verified against code 2026-08-27):**
- (a) **Manual retry must NOT use a different relay kind.** `getAutoStatus` counts sent/deferred by `kind:"link"` (numbersMessaged, deferred queue), so a manual send under `caller`/`intake` would vanish from the counters. → Manual keeps **kind `link`** and passes a new **`bypassCooldown`** flag on the relay meta; the cooldown check becomes `kind==="link" && !bypassCooldown`. Kind stays consistent, counters and the delivery join keep working, and the retry still bypasses the 60-min cooldown.
- (b) **"New this hour" must key on `createdAt` (our import time), NOT `firstContactAt`** (that's Zillow's inquiry date — a lead that inquired days ago but first appeared this hour would be missed). `createdAt` is the DB insert; idempotent re-imports don't bump it, so it == "when we discovered this lead".
- (c) **Don't refetch 205 full leads every 60s** (heavy payload every minute on the ngrok Free 20k/month quota). New leads only appear hourly. → Poll the small `/auto-status` (counts + last-run slot) every ~2 min, visibility-gated; refetch the full lead list ONLY when the lead total or last-run slot changed, or on manual refresh. Heavy fetch stays rare.
- (d) **`sendSurveyBatch` must stay status-guarded.** It calls `sendSurveyToLead(lead.id)`; the new `manual` param defaults **false**, so the automation still only texts `new` leads with the normal cooldown — only the hand button passes `manual:true`.
- Verified fine: the leads-route delivery join is already kind-agnostic (joins by `inviteId`), so it shows manual sends; opt-out is enforced in `relaySendWithGuards`.



**Goal:** Make the Zillow Leads tab the live view of the automation's work: a **Send/Retry button next to every name** to manually text (or re-text) the application link, and the table **auto-repopulates each hour** with new leads + updated delivery status. Read the automation's output at a glance; retry any lead by hand.

## Current state (verified 2026-08-27)
- Per-lead send button exists **only for `status:"new"` + has phone** (`page.tsx` ~line 180). `sendOne(leadId)` → `/api/admin/zillow/send` → `/internal/zillow/leads/:id/send` → `sendSurveyToLead`.
- **`sendSurveyToLead` blocks re-sends:** `if (lead.status !== "new") return skipped` — an `invited`/`failed`/`opted_out` lead can't be re-texted from the UI.
- Delivery state per lead already shown ("link sent {date}", failed reason, queued) + sent-message ⓘ tooltip + "Link sent ✓" filter.
- Page does NOT poll — only `load()` on mount and after an action.
- Cooldown-exempt relay kinds already exist (`intake`, `caller`) so a manual retry CAN actually send even if a link went recently.

## Milestones

### M1 — Manual send/retry for ANY lead (button next to every name)
- **UI:** show a per-lead action button whenever the lead has a phone and isn't opted out:
  - `new` → "Send link"; `invited` → "Resend"; `failed`/`deferred` → "Retry"; `opted_out` → disabled ("opted out").
  - Place it in the row's leading actions (near the name) as the user asked, plus keep the existing right-side action.
  - Per-row spinner (`sendingId`) already exists; extend to all rows.
- **Server:** `sendSurveyToLead(leadId, { manual?: boolean })`. When `manual`:
  - Bypass the `status !== "new"` guard (allow resend to `invited`/`failed`/`deferred`).
  - Send with **kind `link` + `bypassCooldown: true`** (new relay-meta flag) so a hand-retry isn't blocked by the 60-min cooldown, WITHOUT changing the kind (keeps `getAutoStatus` counters and the delivery join correct). STILL honor opt-out and the daily cap (a manual button must not be a spam cannon).
  - Explicit `opted_out` short-circuit: return a clear cannot-send before the relay, and the UI disables the button.
  - On success, keep the lead's audit trail: set/keep `inviteId`, flip `failed`→`invited`, record the ledger row (visible as "link sent").
- **Route:** `/api/admin/zillow/send` accepts `{ leadId, manual?: true }` → `/internal/zillow/leads/:id/send` with the flag. Admin-guarded (already). `sendSurveyBatch` keeps calling `sendSurveyToLead(id)` with `manual` unset → the automation stays status-guarded + cooldown-on; only the hand button forces.
- **Stress:** resend to an `invited` lead → actually sends (not "skipped: status is invited"); retry a `failed` lead → sends; opted-out → button disabled AND server returns cannot-send; a lead with no matched property/phone → clear "can't send" reason; manual sends still stop at the daily cap.

### M2 — Hourly auto-refresh (show the automation's work as it happens)
- Poll the **small `/auto-status`** (flag, last-run slot, counts) every ~2 min, **visibility-gated** (pause when hidden, refresh on return, stop after 3 consecutive failures) — same discipline as Admin → System, because every request is metered on ngrok Free.
- **Refetch the full lead list only on change:** when `/auto-status`'s lead total or last-run slot differs from what's shown (or on manual refresh) → then `load()` the leads. Avoids pulling ~205 rows every poll. Show "updated HH:MM" + "next automation run: HH:00".
- **New-this-hour highlight:** rows whose **`createdAt`** (our import time — NOT `firstContactAt`, which is Zillow's inquiry date) is within the last 60 min, so the hourly batch's additions stand out.
- **Stress:** hidden tab → zero polling (network tab shows nothing); visible → refreshes ~60s; a lead texted by the automation flips to "link sent" on the next poll without a manual reload; 3 failed polls → paused with a "click to resume".

### M3 — Automation summary header (the work being done)
- Top counters (reuse `/auto-status` + leads): total leads, **new (awaiting send)**, **link-sent today**, failed/deferred (queued), opted-out; automation on/off + window (8–22) + **next run** + last run outcome (ran/needs_login/failed) with time.
- A compact "last run" line: "09:00 — 3 new, 3 texted, 0 failed." from the latest `ZillowAutoRun` slot.
- **Stress:** counters match the ledger/DB; a `needs_login` last run shows a clear "Safari needs sign-in" callout (the automation is otherwise fine).

### M4 — Live gate
- Manually resend to a known `invited` test lead → SMS goes out (kind `link`, bypassCooldown), delivery cell flips to "link sent {today}", ledger row present, AND `getAutoStatus.numbersMessaged` counts it (kind still "link").
- Retry a `failed` test lead → sends.
- Opted-out lead → button disabled; forcing the route returns cannot-send; no ledger row.
- Leave the tab open across a forced automation run → new leads + delivery statuses appear on the next poll, no manual reload.
- Daily cap honored: manual retries beyond the cap defer (queued), not error.

## Files
- `apps/dashboard/src/app/admin/zillow/page.tsx` (name-adjacent button for all statuses, visibility-gated polling, new-this-hour highlight, header counters).
- `apps/server/src/services/relay-guards.ts` (new `bypassCooldown` meta flag; cooldown check honors it).
- `apps/server/src/services/zillow-send.ts` (`sendSurveyToLead(id, { manual })`: bypass status guard + `bypassCooldown`, keep daily cap + explicit opt-out; kind stays `link`).
- `apps/server/src/routes/internal.ts` (`/leads/:id/send` accepts `manual`).
- `apps/dashboard/src/app/api/admin/zillow/send/route.ts` (pass `manual`).
- Tests: `zillow-send` (manual bypass, opt-out, cap), dashboard send route (manual flag), page polling (visibility-gated).

## Notes / decisions
- Manual retry bypasses only the 60-min cooldown (via `bypassCooldown`), and KEEPS the daily cap — a button that ignored all guards could spam a lead or the whole list. A true "ignore even the daily cap" for one lead would be a separate explicit confirm.
- Kind stays `link` for ALL Zillow sends (automation + manual) so counters/delivery stay consistent; only the cooldown is flagged off for manual.
- Auto-refresh polls the small status every ~2 min (visibility-gated) and refetches the heavy lead list only on change — the hourly automation is the real cadence, the poll just surfaces it cheaply.
