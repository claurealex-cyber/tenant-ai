# SMS Leads Tab — Show Leads Who CALLED and Got the Link — Plan (BUILT 2026-08-27)

**STATUS: BUILT & LIVE-GATED.** M1 (called origin from a full scan of kind="caller" rows), M2 ("Hosted survey (ngrok)" label + caller-message ⓘ tooltip from the caller row), M4 (called count + filter), M4b (visibility-gated 2-min auto-refresh, silent, pause-on-hidden, stop-after-3-failures, "updated HH:MM" + refresh-now), M5 (live gate) all done. sms-leads lib + page + route + tests. 17 tests green; full suite only fails on pre-existing zillow-import litter.

**Live-gate root fixes (caught only by the running route, not the unit tests which set inviteId manually):**
1. `textLinkToCaller` sent kind "caller" WITHOUT `inviteId` → the SMS-leads join (by inviteId) never saw caller rows → "called" undetectable. Fixed: caller sends now pass `inviteId: invite.id`.
2. The sms-leads route's origin allow-list was `["texted_in","zillow"]` → `?origin=called` was silently dropped. Fixed: added "called".
Gate now: `?origin=called` → the caller row with link=google_form and the exact call message.



**rev. 2 root fixes (verified against code 2026-08-27):**
- (a) **`called` must NOT be derived from `latestLedgerByInvite`.** `sms-leads.ts` keeps only ONE ledger row per invite (the latest, `createdAt desc`), so a caller who ALSO texted later would have the `kind:"caller"` row overwritten by the newer `intake` row → "called" lost. → Build a separate **`calledInviteIds = new Set(allLedgerRows.filter(r => r.kind === "caller").map(r => r.inviteId))`** from a FULL scan of the fetched rows (the join already returns all rows via `findMany`; just don't rely on the dedup map for this).
- (b) **The caller message body must come from the `caller`-kind row specifically**, not the latest row — otherwise a later text's body is shown as "what they got on the call". → Keep a `callerRowByInvite` map (first/any `kind:"caller"` row) for the ⓘ tooltip.
- (c) **Auto-refresh (added — the user asked):** the tab currently only loads on mount. Add visibility-gated polling. The SMS-leads result is TINY (≈2 invites, 1 convo today), so polling the full `/api/admin/sms-leads` route every ~2 min is cheap on the ngrok quota (small payload) — no separate endpoint needed. Same discipline as the Zillow/System tabs: pause when hidden, refresh on return, stop after 3 failures, show "updated HH:MM".
- Verified fine: `linkKind` (google_form/hosted) already derives from the invite channel and is correct for caller rows (caller sends set the invite channel via `resolveSurveyLink`); the delivery join is `findMany` so all rows are available (only `kind`+`body` need adding to the select).



**Goal:** On the SMS Leads tab, surface leads who **called** the property number and received the text with the application link — showing **which** link they got (Google Form, or the hosted/ngrok `/survey/<token>` link if that was the mode), with delivery status. The tab already shows texters + link kind; this adds the "called" dimension.

## Current state (verified 2026-08-27)
- `apps/dashboard/src/lib/sms-leads.ts` aggregates everyone who texted or was sent a survey link from: `SurveyInvite` (primary) + `SmsConversation` + `ZillowLead` + `SmsOptOut` + `OutboundRelayMessage` (delivery, joined by `inviteId`) + `Tenant`.
- Already computes **`linkKind: "google_form" | "hosted" | "none"`** from `latestInvite.channel` — i.e. it already knows Google Form vs the hosted/ngrok survey, and counts each.
- **Origins are only `texted_in` and `zillow`** — there is NO `called` origin, so a caller who got the link looks like a texter.
- Caller-link sends ARE recorded: `OutboundRelayMessage.kind = "caller"` (4 present), tied to the lead's `SurveyInvite` via `inviteId`. `textLinkToCaller` mints/reuses a `SurveyInvite` (channel google_form or sms), so callers already appear as rows — just not labeled "called".
- The delivery join currently selects `{inviteId, status, sentAt, lastError}` — **no `kind`**, so "called" can't be derived yet.

## Milestones

### M1 — Derive a "called" origin from the relay ledger (kind = "caller")
- Extend the `OutboundRelayMessage` fetch in `sms-leads.ts` to also select **`kind`** (and `body`).
- A lead's origin includes **`called`** when any of its invites is in **`calledInviteIds`** (full scan of ledger rows where `kind === "caller"`) — NOT from the latest-row-per-invite map (rev. 2a). Add `"called"` to `SmsLeadOrigin`, the origin filter dropdown, and the counts.
- Keep `texted_in` for inbound-text origin (intake/link kinds). A lead can be BOTH (called and texted) — origins is an array, so show both chips.
- **Stress:** a phone with a `caller` ledger row → origin includes `called`; a text-only lead → no `called`; a lead that called AND texted → both; a caller whose send is `deferred` (cap) still shows `called` + "queued".

### M2 — Show which link the caller got + the message
- The row already carries `linkKind` (google_form/hosted) — ensure it's populated for caller-origin rows (it is, via the invite channel). Label hosted as "Hosted survey (ngrok)" so it's unambiguous which link went out.
- Add the **exact message body** behind an ⓘ tooltip, sourced from the **`caller`-kind** ledger row's `body` (via a `callerRowByInvite` map), NOT the latest row (rev. 2b) — so a caller who later texted still shows the message they got on the CALL.
- **Stress:** google_form mode → caller row shows "Google Form" + the form URL in the message; hosted mode → "Hosted survey (ngrok)" + the `/survey/<token>` URL; a caller with no successful send → "no link yet".

### M3 — Optional: include callers with NO link (CallLog)
- The user's focus is "called AND received the link" (M1 covers it via the caller-kind send). Optionally add `CallLog.callerPhone` as a light source so callers who called but got NO link (known tenant, opted-out, or `caller_link` was off) appear with origin `called` + link "none" — so the tab reflects ALL callers, not only those texted.
- Decision point: include all callers (fuller picture) or only callers who received the link (tighter to the ask). Default: **only received** (M1); M3 is opt-in.
- **Stress (if built):** a tenant who called (no prospect link) shows `called` + "none" + a "tenant" flag; an opted-out caller shows `called` + "opted out"; dedupe a caller who also texted into one row.

### M4 — Counts + header
- Extend the counts strip: **called**, texted-in, zillow, google-form, hosted, opted-out. A one-line "of N leads, C called and were texted the link (G Google Form / H hosted)".
- **Stress:** counts match the ledger (`kind:"caller"` sent rows, distinct phones); filters (origin=called, linkKind=google_form) narrow correctly; tenant rows excluded from prospect counts unless "include tenants" is on.

### M4b — Auto-refresh (visibility-gated)
- Poll `load()` (the full `/api/admin/sms-leads` route — payload is tiny) every ~2 min, **visibility-gated**: pause when the tab is hidden, refresh once on return, stop after 3 consecutive failures. Show "updated HH:MM" + a "refresh now" link + a "paused" note (same component logic as the Zillow tab's poller).
- So a new caller/texter appears within ~2 min without a manual reload.
- **Stress:** hidden tab → zero polling (ngrok inspector shows nothing); visible → refreshes ~2 min; a caller texted during a live call shows up on the next poll; 3 failed polls → paused with resume affordance; the poll never double-fires on visibility flips.

### M5 — Live gate
- With `caller_link` on, place a test call → a `caller` ledger row + `SurveyInvite` appear → **within the ~2-min auto-refresh** the SMS Leads tab shows that phone with origin **called**, linkKind **Google Form** (or Hosted), delivery **sent {time}**, and the exact message in the ⓘ tooltip — within the tab's refresh.
- Flip survey mode hosted → a new caller shows "Hosted survey (ngrok)" + the `/survey/<token>` link.
- A caller in cap-deferral shows `called` + "queued — retry after …" (reusing the retry-after line).

## Files
- `apps/dashboard/src/lib/sms-leads.ts` (select `kind`+`body`; derive `called` origin; counts).
- `apps/dashboard/src/app/admin/sms-leads/page.tsx` (called chip + filter, "Hosted survey (ngrok)" label, message ⓘ tooltip, called count, **visibility-gated auto-refresh**).
- (M3 only) `apps/dashboard/src/app/api/admin/sms-leads/route.ts` + lib (CallLog source).
- Tests: sms-leads lib (called-origin derivation, link kind, dedupe called+texted, counts), page filter.

## Notes
- "Hosted survey" == the ngrok `/survey/<token>` link; label it clearly so google_form vs ngrok is obvious.
- Reuses existing plumbing (invites, ledger, linkKind) — the only new data is the `kind` on the delivery join. No schema change.
