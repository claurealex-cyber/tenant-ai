# Tenant-AI — Daily Zillow Automation Plan (server job + Iris heartbeat + dashboard control)

> **STATUS: COMPLETE (2026-08-26).** M0–M6 all built, stress-gated, live-verified. Suite
> **1,741 tests green**, full `turbo build` clean. Automation left **OFF** (the dashboard
> button turns it on). Iris supervisor cron installed (daily 09:30, zero-token, job id in
> `iris-cron.py list`). Key mid-build findings, each root-fixed:
> - **Census-flap duplication (found by drill B, live):** a stranded test property with
>   `smsIntakeEnabled` broke the sole-intake-property fallback → 115 orphan duplicate leads
>   (propertyId null). Fixed threefold: explicit `zillow.default_property_id` config pinned;
>   `ingestLeads` adopts an existing same-person row instead of creating orphans (+ heals
>   old orphans); test cleanups hardened (FK-ordered, per-step resilient). Regression test added.
> - `psql -c "a; b; c"` is ONE transaction — a failed later statement silently rolls back
>   earlier deletes. Cleanup scripts now use separate `-c` flags.
> - `iris-cron.py` gained `--script`/`--workdir` (zero-token launchd jobs, no API keys in
>   wrappers) + a jobs.json bare-list normalization fix.
> - Live gates ran with the baseline pushed to the FUTURE so no real prospect was ever
>   texted during testing; restored to today afterwards.
> - M2 note: config-cache propagation (≤60s) was observed exactly as designed.
> - Drills A–E all observed (off-silent / trigger-missing-run / unreachable / stale-queue /
>   needs-login); docs at `docs/iris-zillow-supervisor.md`.

**Goal:** Every day, automatically import new Zillow leads and text each **new** lead the
survey link — with (1) a dashboard **on/off button** controlling the whole feature, (2) an
**Automation panel** in the Zillow Leads tab showing each day's new leads and how many numbers
were successfully messaged, and (3) an **Iris heartbeat** that watches the automation daily and
raises a hand when something needs the human (expired Safari session, failures, stuck queue).

**Builds on the completed Zillow Leads feature** (`zillow-leads-plan.md`): extraction, import,
guarded sends, and the `/admin/zillow` tab all exist. This plan adds scheduling, control, and
observability — no new send paths, no cap changes.

> **Plan stress-tested 2026-08-27** — this version incorporates the root fixes. Changes from
> v1 are marked ⟲ where the original design would have misbehaved.

---

## 0. Architecture decisions & verified facts (read first)

**No Navigate, no browser-driving AI — scripts do the whole job.** Settled during the base
build's M0 gate: because Safari holds the signed-in Zillow session, the import is a plain
scripted runner (`zillow-extract.ts`: osascript finds/opens the tab, runs a `fetch` against
Zillow's lead API from the page's own context, chunks the JSON out). Nothing in this plan
drives a browser with an LLM. The daily Iris supervisor is a **zero-token script task**; the
AI-prompt variant is an optional later upgrade. The only recurring human/browser step is
re-signing into Zillow in Safari when the session expires (~monthly).

**Verified facts (were M0 unknowns; checked against source 2026-08-27):**
- The server scheduler is **BullMQ** (`jobs/scheduler.ts`): `registerJob({name, handler, cron,
  maxRetries, backoffDelay})`, cron patterns, Redis-backed, and — critically — **a throwing
  handler is auto-retried with exponential backoff**. ⟲ Therefore the engine handler must
  treat domain outcomes (`needs_login`, import failure, "busy") as *recorded results, never
  thrown errors* — BullMQ retry is reserved for infra crashes. Hammering a logged-out Safari
  with backoff retries would be useless and noisy.
- **SystemConfig values are encrypted at rest** (`config-resolver.ts` decrypts; ~60s cache).
  ⟲ Therefore the on/off toggle must be written through the dashboard's existing
  encrypt + audit-log + cache-clear write path (the integrations PUT machinery) — a server
  internal endpoint writing plaintext would silently corrupt the flag. No server-side toggle
  endpoint exists in this plan. Propagation to the server process is ≤60s (config cache TTL);
  irrelevant at daily cadence, and "Run now" uses `force` which ignores the flag anyway.
- Iris gateway cron jobs persist in `~/.iris/cron/jobs.json`; existing zero-token jobs are
  **shell scripts** (`run-*.sh`) — the supervisor will be a shell wrapper invoking
  `npx tsx apps/server/scripts/zillow-auto-supervise.ts`.
- **BullMQ needs Redis.** If Redis is down, the scheduled engine never fires — but the
  supervisor's trigger path is plain HTTP to `/internal/zillow/auto-run`, which calls the
  service directly (no queue). ⟲ The two layers intentionally have disjoint failure modes.

**Two layers:**
1. **Engine = server job** (`zillow-daily`): deterministic, config-gated, idempotent per day,
   all guarantees (caps, opt-out, ledger, invite reuse) already server-side.
2. **Iris = supervisor**: daily zero-token cron; reads status, triggers a missed run (safe —
   idempotence), notifies only on trouble. Not the engine: either layer alone still functions.

---

## 1. New pieces

### Server (`apps/server`)

**Config keys** (SystemConfig, written only via the dashboard's encrypting write path):
- `zillow.auto_enabled` — "true"/"false", default off.
- `zillow.auto_hour` — local hour the daily window opens, default "09".
- `zillow.auto_baseline` — ISO date set at enable time (see the first-enable rule below).

**⟲ First-enable blast guard.** At enable time there may be ~190 sendable "new" leads sitting
in the table. Auto-queueing texts to all of them the morning after flipping a switch is a
surprise nobody asked for. Rule: the engine only auto-sends leads whose `firstContactAt`
(fallback `createdAt`) is **on/after `zillow.auto_baseline`**. The ON dialog sets the baseline
and offers the choice explicitly: "only leads discovered from today" (baseline = today,
default) vs "also queue the N current new leads" (baseline = epoch). The manual batch button
keeps its own semantics (everything ≤60 days) — automation is the conservative one.

**Model** — ⟲ one **mutable row per day** (not an immutable claim):
```prisma
model ZillowAutoRun {
  id            String    @id @default(cuid())
  day           String    @unique   // "2026-08-27" server-local
  status        String    // running | done | needs_login | failed
  attempts      Int       @default(0)
  leadsFound    Int       @default(0)   // latest import's numbers
  leadsNew      Int       @default(0)   // cumulative new leads today
  queuedSends   Int       @default(0)   // cumulative sent+deferred today
  sentImmediate Int       @default(0)   // cumulative sent-at-run-time today
  error         String?
  importRunId   String?
  startedAt     DateTime  @default(now())
  finishedAt    DateTime?
}
```
⟲ v1 had `@unique day` as a one-shot claim, which meant a 9am `needs_login` **consumed the
whole day** — the user re-logs into Safari at 11am and nothing happens until tomorrow — and a
`force` re-run would violate the unique constraint outright. New semantics:
- **Done consumes the day; failure does not.** The hourly tick runs when the local hour is in
  the window (hour ≥ `auto_hour`) and today's row is absent or in `needs_login`/`failed`.
  Result: after a Safari re-login, the next hourly tick **heals automatically** — no human
  "Run now" required (the banner still offers it for impatience).
- **Atomic claim without a second table:** claim = `create` (unique `day`) for the first
  attempt, `updateMany(where: {day, status: {in: [needs_login, failed]}}, set: {status:
  running, attempts: {increment}})` for retries — a 0-count update means another trigger won
  the race; exit quietly. `force` additionally claims a `done` row the same way.
- **Counters are cumulative across the day's attempts**; `leadsFound` reflects the latest
  import. A `running` row older than ~15 min is stale (crashed) and claimable like a failure.
- ⟲ `skipped_off` is gone. Disabled automation records **nothing** — the status endpoint
  reports the flag itself; a daily noise row added no information. Toggling ON at 3pm simply
  lets the next hourly tick fire (still within the day's window).

**Service** `services/zillow-auto.ts` — `runDailyAutomation({force?})`:
gate on `auto_enabled` (unless force) → day-claim as above → `runZillowImport()` → batch-send
scoped by the baseline rule → update the day row. Domain failures **return** statuses
(`needs_login`, `failed`, `busy` when the extraction lock is held); the function throws only on
infra errors. ⟲ The BullMQ handler wraps it in a catch-all so BullMQ's retry/backoff never
fires against Safari; job-level `maxRetries: 0`.

**Job** `jobs/zillow-daily.ts`: cron `"0 * * * *"` (hourly tick; the hour-window + day-claim
logic above decides whether anything happens). Registered beside billing-cycle et al.

**Internal routes** (existing `x-relay-secret` auth):
- `POST /internal/zillow/auto-run` `{force?}` → runs inline, returns the day row.
- `GET /internal/zillow/auto-status` → `{enabled, baseline, today, last30Days,
  deferredQueue: {depth, oldestAgeDays}, totals: {leads, numbersMessaged, applied}}`.
  ⟲ Metrics defined precisely: **numbersMessaged** = distinct `ZillowLead.phone` having ≥1
  relay-ledger row with their `inviteId`, `kind: "link"`, `status: "sent"` (the ledger is the
  delivery truth; intake texters who aren't Zillow leads are excluded by the invite join).
  **deferredQueue.oldestAgeDays** = age of the oldest `deferred` link row (the supervisor's
  staleness signal).
- ⟲ No `auto-toggle` endpoint (see §0 encryption fact) — the toggle lives dashboard-side.

### Dashboard (`apps/dashboard`)

**Automation panel** at the top of `/admin/zillow`:
- State button **"Automation: RUNNING — turn off" / "OFF — turn on"**. The ON dialog restates
  pacing caps AND the ⟲ baseline choice ("from today" vs "also the N existing new leads").
  Toggle + baseline written via the existing encrypted-config write helper, audit-logged.
- "Run now" (`force`) + next-window readout; disabled with a spinner while a run is inline.
- **Needs-attention banner** on `needs_login` ("Open Safari, sign into Zillow Rental Manager —
  the automation retries hourly and will pick itself up") or `failed`.
- **Daily history table**: date · leads found · new · queued · sent so far (live ledger join) ·
  attempts · status.
- **Milestone strip** (cumulative): leads acquired · numbers successfully messaged · surveys
  completed — badges at 25/50/100/200 messaged. ⟲ In `survey_mode=google_form`, submissions
  can't be observed, so "surveys completed" renders as "n/a in Google-Form mode" rather than a
  silently frozen zero.

**Proxy routes**: `api/admin/zillow/auto-status`, `auto-run` (same requireAdmin +
proxyToServer pattern); `auto-toggle` is a dashboard-local route (encrypted write + audit),
not a proxy.

### Iris (`~/.iris`)

One **daily cron job**, zero-token shell-script task (~09:30, after the engine's first tick;
`workingDirectory: ~/tenant-ai`), wrapping `apps/server/scripts/zillow-auto-supervise.ts`
(secret resolved in-process, same as the live-gate script):
1. read `auto-status`;
2. if enabled and today's row is missing or unhealed-failed → POST `auto-run` (no force;
   respects the same claim semantics), re-check;
3. notify (macOS notification via osascript, matching the relay's `notifyOnMac` pattern) ONLY
   on: `needs_login`, `failed` after the retrigger, server unreachable, or
   `deferredQueue.oldestAgeDays > 3`; otherwise exit silently.
- ⟲ Because the engine self-heals hourly, the supervisor's real jobs are (a) the notification
  layer and (b) covering the Redis-down case via direct HTTP. If the Iris gateway is down,
  the engine is unaffected.

---

## 2. Milestones

### M0 — Remaining spikes ✅ DONE 2026-08-26
- [x] Iris cron: jobs are **launchd agents** (`dev.iris.cron.<id>`) generated by
      `~/.iris/scripts/iris-cron.py`. ⟲ Root fix applied to the tool itself: new `--script`
      (zero-token job, no API keys copied into the wrapper) and `--workdir` options, plus a
      jobs.json bare-list normalization bug fix. Spike job fired ON SCHEDULE via launchd
      (22:26:01 for a 22:26 schedule), ran in the requested workdir, logged to
      `runs/<id>.jsonl`, and exercised the notify-unless-"all clear" path. Removed after.
- [x] `pmset -g`: `sleep 0` — the Mac never sleeps; hourly ticks always fire.
- [x] Safari-launch: the runner never sets `current tab` (no focus steal) and reuses the
      first matching rental-manager tab (max one lingering tab). Verified during base build.
- **Gate: PASSED.**

### M1 — Server engine ✅ DONE (15 unit tests + live gate: disabled→refused, force→real import, idempotent re-force, supervisor all-clear)
- [ ] Migration (`ZillowAutoRun`), `zillow-auto.ts`, `zillow-daily.ts` (cron `0 * * * *`,
      `maxRetries: 0`, catch-all handler), 2 internal routes, `zillow-auto-supervise.ts`.
- [ ] Tests (⟲ lessons from the base build baked in: mock the import, scope every batch by a
      test property, mock `resolveConfig`, never source `.env` into the runner, inject the
      clock for hour-window and staleness logic):
      off-gate (no row written) · first-claim vs retry-claim vs race-loser · `needs_login`
      does not consume the day and heals on the next tick · `done` blocks re-runs, `force`
      overrides · counters accumulate across attempts · stale `running` row is reclaimed ·
      baseline filter (epoch vs today) · handler never throws on domain failures ·
      auto-status metric queries (numbersMessaged join, oldest-deferred age).
- **Gate:** new tests + full suite green. Live: `auto-run` with automation off → refused
      (unless force); force → real import, day row correct; second force same day → row
      updated, no duplicate texts (invite reuse + cooldown hold); simulated `needs_login`
      (rename status in DB) → next tick reclaims it.

### M2 — Dashboard control & observability ✅ DONE (7 route tests incl. encrypted-write proof; live enable/disable observed)
- [ ] Toggle + baseline dialog (encrypted write + audit), Run-now, banner, history table,
      milestone strip, 3 API routes.
- [ ] Tests: route auth/proxy; toggle writes encrypted value + audit row + baseline; panel
      states (off / running / needs_login / failed / google-form caveat).
- **Gate:** tests + `turbo build` green. Live: flip ON with "from today" → forced run visible
      in history; flip OFF → scheduled tick does nothing and status shows off; needs-login
      banner renders when the day row says so.

### M3 — Iris supervisor ✅ DONE (installed 09:30 daily; all 5 drills observed; $0/day)
- [ ] Build the checker + shell wrapper; install the daily cron job; commit the job definition
      and install command to `~/tenant-ai/docs/iris-zillow-supervisor.md`.
- [ ] Drill every notify condition for real: automation off → silent; missing run → triggers
      it (day row appears); simulated `needs_login` → notification arrives; server stopped →
      "unreachable" notification; stale deferred queue (backdate a row) → notification.
- **Gate:** all five drills observed; a healthy day passes silently at $0 token cost.

### M4 — Full-system stress & handoff ✅ DONE (suite 1,741 green, build clean, stack restarted, automation OFF)
- [ ] Full suite + `turbo build`; restart via `./start.sh`.
- [ ] One observed real day-zero run with automation ON (baseline "from today"): any genuinely
      new Zillow lead is imported and queued; history and milestones reflect it.
- [ ] Plan + memory updated; feature left **off** unless the user has already flipped it.
- **Gate:** suite green; observed run recorded; user told exactly what the button does.

---

## 2b. Addendum — Text-in Leads view (added 2026-08-27; ⟲ re-stress-tested same day)

**Ask:** a dashboard view of everyone who **texted the company number** and what link they
received — the Google Form when `survey_mode=google_form` was active, or the hosted (ngrok)
survey otherwise — alongside the Zillow-blast recipients.

**Investigation findings (verified against source AND live DB):**
- The existing **Messages** tab shows tenant-portal `Message` rows, NOT SMS intake — texted-in
  prospects currently have no dashboard surface at all. This view fills a real gap.
- ⟲ **`SmsConversation` is NOT durable.** The hourly `sms-cleanup` job deletes conversations
  24h after last activity (`SMS_CONVERSATION_EXPIRY_HOURS = 24`). Live proof: after a week of
  operator test texts, exactly **1** conversation row survives while **3** `SurveyInvite` rows
  persist. v1 of this addendum built the universe and transcripts on conversations — it would
  have rendered a nearly empty page that forgets every lead within a day. Root fix below.
- The **durable** records are exactly the right ones:
  - `SurveyInvite` (phone, property, `createdAt`, `channel`) — rows are never deleted
    (`expiresAt` only gates link validity). Every intake reply and every Zillow send mints
    one, so "texted in AND received a link" ≡ "has an invite not attributed to Zillow".
  - `OutboundRelayMessage.body` (joined by `inviteId`) — ground truth for what actually went
    out (forms.gle vs ngrok URL, frozen at queue time — truthful across `survey_mode` flips)
    plus delivery state and `sentAt`. Durable.
  - `ZillowLead.inviteId` — attributes invites to the Zillow blast. **Origin is a set, not an
    enum**: an invite can be Zillow-originated AND its phone can text in later (invite reuse
    hands them the same row) — render both chips (`texted in`, `Zillow`), never guess one.
  - `Application` via `invite.applicationId` — name + applied state (hosted mode only);
    `SmsOptOut` — opted-out rendering. Both durable.
- ⟲ **One tiny migration IS needed** (v1 claimed zero writes): to keep each lead's own words
  after the 24h conversation purge, add `SurveyInvite.inboundMessage String?` — the intake
  handler snapshots the triggering text (≤250 chars, like `ZillowLead.lastMessage`) at
  mint/reuse time. Zillow-originated invites get theirs from `ZillowLead.lastMessage` at read
  time. The live `SmsConversation` (when still present) powers a full-transcript expander,
  honestly labeled "full transcript available for 24h after last activity".
- ⟲ **Known tenants are not leads.** A tenant texting "my sink leaks" reaches the AI
  maintenance flow and must not clutter a leads view: rows whose phone matches a `Tenant` of
  the property's landlord are excluded by default (a filter can reveal them, chip `tenant`).
- Reads are dashboard-local Prisma (like every admin page) — no server endpoints, no proxy.
  Volume is hundreds of rows: build the merged row set in the query module and paginate
  in memory (the Zillow tab precedent) — no cross-table SQL pagination gymnastics.

**Shape:** new admin page **"SMS Leads"** (`/admin/sms-leads`, nav next to Zillow Leads):
one row per phone+property. **Universe = SurveyInvite rows (durable) ∪ live SmsConversation
rows** (the union catches texters who never got a link — known-tenant bypass, AI-flow,
opted-out); default filter shows texted-in origin. Columns: phone · name (from application
when known) · property · first contact (earliest invite `createdAt`) · origin chips
(`texted in` / `Zillow`) · **link sent** chip (`Google Form` / `Hosted survey` / `none yet`,
from the latest invite's `channel`, ledger body as tiebreaker) · delivery (ledger) ·
applied/opted-out · their message (`inboundMessage`) · transcript expander when a live
conversation exists. Filter chips by origin, link kind, and state; counts across the top.

### M5 — Text-in Leads data layer ✅ DONE (migration + intake snapshot + lib; 9 real-DB tests; live gate showed operator history w/ correct labels)
- [ ] ⟲ Migration: `SurveyInvite.inboundMessage String?`; intake handler snapshots the
      triggering text at mint/reuse (server-side, one line + test). Historical invites
      render "—" (their conversations are already purged; documented, not fudged).
- [ ] `apps/dashboard/src/lib/sms-leads.ts`: query module building the row shape above
      (invite-primary universe, conversation union, origin chip set via `ZillowLead.inviteId`,
      link-kind derivation, ledger join, tenant exclusion, in-memory merge/pagination).
- [ ] `api/admin/sms-leads` route (admin-guarded, filterable).
- [ ] Tests, real-DB with `TEST_PREFIX` isolation: durable-universe (delete the test
      conversation, row persists with `inboundMessage` — simulates the 24h purge) ·
      texted-in vs Zillow vs BOTH origin chips (same phone, reused invite) · google_form vs
      hosted link-kind incl. mode-flip mid-history (old ledger body stays truthful) ·
      none-yet (conversation without invite) · tenant exclusion + reveal filter ·
      delivery states · opted-out · applied via invite→application.
- **Gate:** tests green; live query returns the operator's real invite history from this
      week with correct link-kind labels — despite those conversations being long purged.

### M6 — Text-in Leads UI ✅ DONE (/admin/sms-leads page + nav + 4 route tests; build clean)
- [ ] `/admin/sms-leads` page (DashboardShell, filter chips, pagination component,
      transcript expander with the 24h-window label) + nav entry.
- [ ] Route/page tests per existing admin-page precedent; `turbo build` green.
- **Gate:** full suite green; live: the page shows the operator's real texted-in history with
      hosted-survey labels; ⟲ the Google-Form case is gated with a **seeded**
      `channel: "google_form"` invite + ledger row (test data, cleaned after) — NOT by
      flipping the production `survey_mode` toggle mid-gate.

---


---

## 3. Explicitly out of scope
- Raising relay caps or altering pacing (the daily batch still trickles through the sweep).
- Auto-login to Zillow — `needs_login` stays a human step, now self-healing after re-login.
- Emailing phone-less leads (possible later milestone via SendGrid).
- Multi-property routing changes — inherits the existing matcher and default property.
- A Google-Form submission tracker (would need Forms API polling; separate plan if wanted).

## 4. Risks
| Risk | Mitigation |
|---|---|
| Safari session expired at run time | `needs_login` recorded without consuming the day; hourly self-heal after re-login; banner + Iris notification |
| BullMQ retrying into a logged-out Safari | handler catch-all + `maxRetries: 0`; domain outcomes are return values, never throws |
| Redis down → scheduled job never fires | supervisor triggers via direct HTTP (no queue); "unreachable/missing" notification |
| First enable queues ~190 old leads unexpectedly | baseline rule + explicit choice in the ON dialog; default is "from today only" |
| Double-trigger (tick + supervisor + Run now) | single mutable day row with atomic claim transitions; invite reuse + cooldown as belt-and-suspenders |
| Toggle written outside the encrypting path | no server toggle endpoint exists; dashboard is the only writer (encrypt + audit + cache-clear) |
| Config cache staleness (≤60s) after toggling | irrelevant at daily cadence; "Run now" uses force |
| Mac asleep at tick time | hourly window catch-up; M0 pmset check documents reality |
| Silent send starvation (caps eaten by forwards/heartbeats) | auto-status exposes oldest-deferred age; supervisor alerts at >3 days |
| Iris gateway down | engine unaffected; only the notification layer is lost |
| SMS transcripts purged after 24h (`sms-cleanup`) | Text-in Leads universe is invite-primary (durable); lead's words snapshotted to `SurveyInvite.inboundMessage` at mint time |
| Tenant maintenance texts polluting the leads view | tenant-phone rows excluded by default, revealable by filter |
