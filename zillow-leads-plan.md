# Tenant-AI — Zillow Leads Tab + Survey Blast Plan

> **STATUS: COMPLETE (2026-08-26).** All milestones M0–M4 built, stress-gated, and live-verified.
> - M0: `zillow-extract.ts` runner — 3 unattended runs (identical lead sets), cold-start
>   tab-open race and login-redirect misclassification found by the gate and root-fixed.
>   Decision: plain scripted runner; Navigate loop not needed.
> - M1: `ZillowLead`/`ZillowImportRun` models + `zillow-import.ts` + internal routes.
>   Live-gated over HTTP: 199 leads ingested (193 sendable), re-import → `leadsNew: 0`.
> - M2: `/admin/zillow` tab (import, stats, filters, CSV, per-lead + batch send with
>   queue-math confirm) + 6 proxy API routes. 10 route tests green.
> - M3: `zillow-send.ts` — Zillow-specific copy, full guard passthrough. Live gate: real
>   text delivered to the operator phone from the relay, ledger `sent`, lead → `invited`.
> - M4: survey-submit → `applied` flip (live-gated), STOP → `opted_out` reflection (tested),
>   sticky statuses across re-imports (tested).
> - Full suite: **114 files / 1,671 tests / 0 failures** (incl. 36 new; also root-fixed a
>   pre-existing UTC-boundary flake in application-builder.test.ts). `npx turbo build` clean.
> - Gate scripts kept: `apps/server/scripts/zillow-extract-cli.ts`, `zillow-live-gate.ts`.

**Goal:** A new **Zillow Leads** tab in the dashboard that (1) runs an on-Mac import job which
uses **Iris Navigate driving Safari** to sign into Zillow Rental Manager and export the
lead-management list, (2) stores the leads and offers a **CSV download**, and (3) sends each
lead's phone the existing **survey link** from the personal number **(708) 415-8984** through
the Messages relay — with all the existing guards (opt-out, cooldown, caps, ledger).

**Decisions locked:**
- Scraper runtime = **Iris Navigate + Safari** (user's requirement). Playwright/Chromium port of
  `~/Downloads/zillow_gui.py` is the **fallback**, not the default.
- Outbound = the **existing Messages relay** (`relaySendWithGuards`, kind `"link"`), i.e. texts
  come from (708) 415-8984 exactly like today's survey replies. No new send path.
- Survey = the existing tokenized invite links (`SurveyInvite` + `buildSurveyUrl`), so Zillow
  leads land in the same Applications view as SMS-link applicants.
- The import job runs **on this Mac only** (Safari + Messages live here); the dashboard just
  triggers/observes it via the server.

---

## 0. Reality checks (read first)

1. **Safari session beats credential automation.** Safari on this Mac can hold a logged-in
   Zillow session (user signs in once, manually). Navigate then only has to *open the
   lead-management page and extract*, not perform login. Login automation (the brittle part of
   the Python script) becomes a rare recovery path, done by hand when cookies expire.
2. **Data extraction ≠ screen-scraping.** The lead table is fed by Zillow's internal
   `leadManagementTable` POST API. In Safari the reliable extraction is
   `do JavaScript` (AppleScript) running a `fetch` against that endpoint with
   `credentials:"include"` from the signed-in page — same technique the Python script uses via
   `page.evaluate`. Requires enabling **Safari → Develop → Allow JavaScript from Apple Events**
   (one-time, manual).
3. **Iris Navigate is permission-gated** (`requiredPermission: .prompt`). The spike must confirm
   the right non-interactive invocation (`iris -p` + permission flag/config) so the server can
   run it unattended. If unattended Navigate can't be made safe/reliable, M1's runner falls back
   to a plain AppleScript/JXA script (no LLM loop) — Navigate is only genuinely needed if
   Zillow's UI demands adaptive interaction.
4. **Caps make bulk sends a trickle — by design.** Current relay caps: hourly 5 (links get
   hourly−2 = 3/hr), daily 25, new-recipient 10/day, 60-min per-tenant cooldown. Deferred rows
   drain at ≤2 per 10-min sweep. 300 leads ≈ 12+ days. That protects the personal number from
   carrier spam-flagging. The tab must SHOW this queue honestly (sent / deferred / failed), and
   we do NOT raise caps in this plan.
5. **Compliance:** texting someone who inquired about your listing is a response to their
   inquiry, but every message keeps the STOP language and the relay identity prefix
   ("Ghem LLC 1 (you texted …)" is wrong here — see M3 for Zillow-specific copy). Opt-outs are
   enforced by `relaySendWithGuards` on every send. Old leads (> ~60 days) default to excluded
   from bulk send.
6. **Zillow ToS/brittleness:** this exports the user's own lead data via their own login, but it
   rides an internal API — expect breakage when Zillow changes it. The parser must fail loudly
   (import status "failed: shape changed"), never silently import 0.

---

## 1. Architecture

```
 Dashboard (Next.js)                     apps/server (Fastify, this Mac)
 ┌────────────────────┐  POST /api/…    ┌───────────────────────────────┐
 │ Zillow Leads tab   │ ──────────────► │ /internal/zillow/import       │
 │  Import · table ·  │  (proxy w/      │   spawn: import runner        │
 │  CSV · Send links  │   secret)       │   (Iris Navigate → Safari)    │
 └────────────────────┘                 │        │ writes JSON          │
        ▲ poll status / list           │        ▼                      │
        │                               │ parse → upsert ZillowLead     │
        │                               │ /internal/zillow/send         │
        │                               │   mint SurveyInvite →         │
        │                               │   relaySendWithGuards("link") │
        │                               └──────────┬────────────────────┘
        │                                          ▼
        │                               Messages.app relay → (708) 415-8984 → lead's phone
        └── Applications view (existing) ◄─ lead applies via survey link
```

New DB model (Prisma):

```prisma
model ZillowLead {
  id             String    @id @default(cuid())
  phone          String?          // E.164 after normalization; null if Zillow gave none
  name           String
  email          String?          // Zillow relay email
  propertyText   String           // raw "propiedad" string from Zillow
  propertyId     String?          // matched Property, default Ghem LLC 1
  firstContactAt DateTime?
  zillowStatus   String?          // Zillow's own status label
  lastMessage    String?          // truncated last message text
  status         String    @default("new") // new | invited | applied | opted_out | no_phone
  inviteId       String?          // SurveyInvite minted for this lead
  importRunId    String
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  @@unique([phone, propertyId])
}

model ZillowImportRun {
  id          String   @id @default(cuid())
  status      String   // running | done | failed
  leadsFound  Int      @default(0)
  leadsNew    Int      @default(0)
  error       String?
  rawJsonPath String?  // audit copy of what was captured
  startedAt   DateTime @default(now())
  finishedAt  DateTime?
}
```

---

## 2. Milestones

### M0 — Spike: Safari extraction under Iris Navigate  *(gate before any app code)*

> **Spike findings (2026-08-26, first live run — extraction PROVEN):**
> - Signed-in Safari + `do JavaScript` fetch works. Minimal body: `{clientTimeZone:"America/Chicago"}`.
> - Pagination: `limit` (max **100**) + `start` (max **100**) → at most the **200 newest leads**
>   per query shape; `start≥150` → 400 "invalid 'start'". Zillow's own UI has the same cap
>   (`getNextPageParam` stops past 100). 200 leads currently span ~7 weeks — covers the 60-day
>   send window. Older reach, if ever needed: the `folder`/`listingAliases`/`readRepliedStatus`/
>   `renterProgressStatus` filter fields (seen in Zillow's bundle) or the separate
>   `leadManagementSearch` endpoint.
> - Response shape: `{response:{leads[], totalLeadCount, hasNextPage, pageLeadCount, earliestDateSearchedMs, tooMuchDataRequested}}`;
>   lead fields match the Python parser (`renterInfo`, `listingDetails.address`, `latestContact`, `statusLabel`).
> - Monkey-patching `window.fetch` does NOT capture the page's own calls (bundle binds fetch at
>   module init) — always use direct fetch from page context, never interception.
> - Large payloads exit Safari via `window.__x.json.slice(offset, offset+60000)` chunk reads.
> - Live proof: 200 leads (193 with phones, 199 after dedup) → `.zillow/leads-raw.json` +
>   `.zillow/zillow_leads_spike.csv` (115 leads for 2615 W 61st St, 84 for 5665 W 95th St).
- [ ] Manually sign into Zillow Rental Manager in Safari; enable Develop → Allow JS from Apple Events.
- [ ] Hand-run an AppleScript/JXA snippet in the signed-in tab that `fetch`es
      `…/leadManagement/leadManagementTable` (POST, credentials include) and dumps JSON to
      `~/tenant-ai/.zillow/leads-raw.json`. Confirm the response shape matches the Python
      parser's expectations (`response.leads[].renterInfo` etc.).
- [ ] Wrap the same extraction as an **Iris invocation**: `iris -p "<goal + contract>"` where the
      contract is "open LEADS_URL in Safari, ensure the lead table loaded, execute the provided
      JS, verify the output file exists and parses, report count". Confirm it runs
      **non-interactively** (permission mode flag) and survives: session valid, session expired
      (must FAIL with a clear "needs manual login" status, not attempt credentials).
- [ ] Pagination: replay the POST with page params (port `fetch_more_pages` logic to the injected JS).
- **Gate:** two consecutive unattended runs produce identical-count JSON with ≥1 real lead;
  expired-session run reports the right error. Decision recorded: Navigate loop vs plain
  AppleScript runner (use the simplest thing that passed).

### M1 — Server: import pipeline
- [ ] Prisma migration for `ZillowLead` + `ZillowImportRun`.
- [ ] `apps/server/src/services/zillow-import.ts`: spawn the M0 runner (child process, 5-min
      timeout, one at a time — reject concurrent runs), then parse: port `parse_lead`/dedup from
      the Python script; normalize phones to E.164 (+1, strip formatting; leads without a valid
      US phone → `status:"no_phone"`); match `propertyText` → `Property` by address substring,
      default Ghem LLC 1; upsert on `(phone, propertyId)` — re-imports refresh Zillow status but
      never regress `invited/applied` status.
- [ ] Routes in `apps/server/src/routes/internal.ts` (same `x-relay-secret` auth):
      `POST /internal/zillow/import` (start run, returns runId),
      `GET /internal/zillow/import/:runId` (status),
      `GET /internal/zillow/leads` (list + filters),
      `GET /internal/zillow/leads.csv` (CSV download, same columns as the Python export).
- [ ] Unit tests: parser (fixture = sanitized `zillow_raw_*.json` from a real M0 run), phone
      normalization, dedup/upsert idempotence, status non-regression, shape-change → loud failure.
- **Gate:** `npx vitest run` green; a real import run lands real leads in Postgres.

### M2 — Dashboard: the Zillow Leads tab
- [ ] `apps/dashboard/src/app/(dashboard)/zillow/page.tsx` + sidebar entry "Zillow Leads".
- [ ] Dashboard API routes proxying the internal endpoints (session-authed, secret stays server-side).
- [ ] UI: **Import from Zillow** button (disabled while a run is live, live status via polling,
      clear error surface incl. "Safari session expired — sign in manually and retry");
      leads table (name, phone, property, first contact, Zillow status, our status, last
      message) with filters + pagination (reuse existing pagination component);
      **Download CSV** button;
      import-run history strip.
- [ ] Tests: mock-based route tests + table rendering states (per existing dashboard patterns).
- **Gate:** build green; real import visible in the tab; CSV opens in Numbers/Excel with correct columns.

### M3 — Send survey links from (708) 415-8984
- [ ] `apps/server/src/services/zillow-send.ts`: for a lead — skip unless `status:"new"` +
      valid phone; `createOrReuseSurveyInvite(propertyId, phone)`;
      **Zillow-specific copy** (they never texted us, so `rewriteForRelay`'s "you texted" is
      wrong): `"{Property} (you inquired on Zillow): Thanks for your interest! Apply here:\n{url}\n\nTo opt out, text STOP to (708) 907-0695."`;
      `relaySendWithGuards(phone, text, { kind: "link", inviteId })`;
      outcome → lead: sent/deferred → `invited` (deferred drains via existing sweep),
      opted-out → `opted_out`, failed → stays `new` with error shown.
- [ ] Routes: `POST /internal/zillow/leads/:id/send` and `POST /internal/zillow/send-batch`
      (batch = filter `new` + first-contact ≤ 60 days unless overridden; enqueue all — caps and
      sweep do the pacing).
- [ ] UI: per-row **Send survey** button + **Send to all new** with a confirm dialog that states
      the queue math ("N leads; ~3/hour, 25/day — estimated M days"); per-lead delivery status
      pulled from the `OutboundRelayMessage` ledger.
- [ ] Tests: send-state machine, opt-out/no-phone/already-invited skips, batch honors the
      60-day filter, deferred handling; caps behavior covered by existing relay-guards tests.
- **Gate:** vitest green; **live gate:** one real lead row (the user's own phone seeded as a
  fake lead) receives the survey text from (708) 415-8984, link opens, submission appears in
  Applications, lead flips to `applied`.

### M4 — Lifecycle closure
- [ ] On application completion (`completeApplication` / survey submit path): if `callerPhone`
      matches a `ZillowLead`, set `status:"applied"`.
- [ ] Reflect `SmsOptOut` rows into lead status on list read (opted-out leads render greyed, send disabled).
- [ ] Re-import idempotence test: import → send → re-import → statuses preserved, no dupes.
- **Gate:** full suite green (target: existing 1,428 + new, 0 failures beyond the known
  late-fees flake).

---

## 3. Explicitly out of scope
- Raising relay caps or any anti-spam loosening.
- Automating the Zillow LOGIN (credentials in keychain, typed by robot). Manual Safari sign-in
  is the session source; the old Python auto-login stays in Downloads as reference only.
- Auto-replying inside Zillow's message thread (no API; ToS risk).
- Sending to leads with no phone (email fallback could be a later milestone via SendGrid).

## 4. Risks
| Risk | Mitigation |
|---|---|
| Zillow changes the internal API shape | Parser fails loudly; raw JSON kept per run for quick re-mapping |
| Safari session expires mid-run | Runner detects login redirect → run status "needs manual login" |
| Navigate loop nondeterminism | M0 gate may demote runner to plain AppleScript; Navigate only if needed |
| Carrier flags the personal number | Existing caps + trickle sweep + STOP language; batch confirm shows pacing |
| Lead texted us before (already in SmsConversation) | `createOrReuseSurveyInvite` + cooldown dedupe naturally |
