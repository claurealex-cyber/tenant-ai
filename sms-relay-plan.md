# Temporary SMS Relay Workflow — Implementation Plan (rev. 2)

**Scope:** Until Telnyx 10DLC registration approves outbound, tenant texts to +17089070695 are answered from the personal number +17084158984 via Messages.app, with a self-hosted survey and a dashboard for responses + settings. All paths relative to `/Users/alejandroclaure/tenant-ai` unless absolute.

---

## 1. Architecture Overview

```
Tenant phone
    │  SMS "hi" → +17089070695 (Telnyx)
    ▼
Telnyx webhook  POST https://<tunnel-domain>/telnyx/sms
    ▼
Fastify (port 3005, trustProxy: true)  routes/telnyx-sms.ts
    │  dedupe on Telnyx message id (ProcessedWebhookEvent) → 200 OK,
    │  then fire-and-forget processTelnyxInbound() serialized per phone
    ▼
handleIncomingSms() (handlers/sms-handler.ts)
    │  STOP/HELP/opt-out checks → property lookup (twilioPhone=+17089070695, isActive)
    │  known-Tenant bypass → normal AI/maintenance flow (intake NOT triggered)
    │  property.smsIntakeEnabled → handleSurveyIntake():
    │      • every inbound persisted to SmsConversation (visible in Messages tab)
    │      • completed application for this phone? → ack reply, forward text to owner
    │      • else mint/reuse SurveyInvite token (partial-unique-guarded)
    ▼
DELIVERY SEAM (processTelnyxInbound reply loop)
    │  relay enabled?  ──yes──►  relaySendWithGuards():
    │                              OutboundRelayMessage row (pending) → opt-out check
    │                              → caps/cooldown → osascript → Messages.app (SMS svc)
    │                              → chat.db delivery confirmation → status=sent
    │  relay disabled? ──────►  sendTelnyxSms() (restored after 10DLC)
    ▼
Tenant taps link → GET /survey/:token (Fastify, inline HTML, 11 questions)
    ▼
POST /survey/:token → single prisma.$transaction:
    │  atomic claim + Application create (completed, DOB encrypted) + invite link
    │  → thank-you page, then fire-and-forget forward (minimal summary, via guards)
    ▼
setInterval sweep (in-process, NOT BullMQ): retries pending/failed/deferred
OutboundRelayMessage rows (links AND forwards), 1–2 sends/run; daily heartbeat
    ▼
Dashboard (Next.js) — new admin tabs:
    /admin/surveys     ← responses list (links into /applications/[id]) + invites
    /admin/sms-relay   ← settings + status panel (ledger, balance, heartbeat, opt-out)

External monitor (healthchecks.io/UptimeRobot) → GET /health/deep every 5 min
launchd KeepAlive: Fastify · ngrok/cloudflared · colima (Docker)
```

Key insight from investigation: **~60% already exists** — SurveyInvite model, token minting (`packages/shared/src/survey-token.ts`), intake branch (`handlers/survey-intake.ts` behind `property.smsIntakeEnabled`), PII encryption, and the SystemConfig/integrations settings pipeline. We build: the delivery seam branch, a Messages.app send module with a **persistent send ledger**, a Fastify-hosted survey page, the forward step, an **ops/supervision envelope**, and two dashboard tabs.

**Design rule adopted throughout (fixes the biggest class of failure):** every relay send is a **DB row first, an osascript call second**. Nothing tenant- or owner-facing is fire-and-forget without a persistent record to retry from and surface in the dashboard.

---

## 2. Survey Platform Decision

**Decision: Self-hosted one-page survey on the Fastify server (Option B). Google Forms (Option A) is the documented fallback; manual CSV (Option C) rejected.**

Rationale:
- **Marginal cost is one HTML string.** Token minting, invite storage, expiry/single-use validation, auto-reply composition, PII encryption, and dashboard/config patterns all exist. Google Forms would still require the same webhook receiver, DB write, forward step, and dashboard tab — it only outsources the form UI while adding an Apps Script trigger to babysit.
- **PII posture (stated honestly).** DOB/income are stored in local Postgres encrypted under `PII_ENCRYPTION_KEY`, consistent with the repo. However, the survey POST **transits** the tunnel provider's edge, where TLS terminates — ngrok or Cloudflare sees plaintext PII in flight. This is an accepted-risk line item the user signs off on (see "User actions required"), mitigated by: tunnel inspection disabled (`inspect: false`, so no plaintext bodies sit in the localhost:4040 buffer), and a move to a real host post-10DLC. Google Forms is still worse: a second *persistent* unencrypted copy in Google's cloud.
- **Attribution.** The invite token ties each response to the texting phone (`invite.phone`) — authoritative and immutable (§4.4); Google Forms depends on tenant-typed phone numbers.
- **No new availability dependency** — but availability itself is now engineered, not assumed: see §4.8 (ops envelope) and milestone M2.
- **Zero third-party setup** for the user beyond the tunnel-domain decision.

**Domain decision is a hard prerequisite of the first live tenant link (M4 gate), not copy polish:** links embed the base URL at mint time, so a later domain change dead-links every outstanding invite. Options: free Cloudflare named tunnel (recommended — clean hostname, no interstitial), paid ngrok, or ngrok's one free **static domain** (reserve it regardless, so a tunnel restart keeps the hostname). If the domain ever changes anyway: keep the old tunnel alive for 7 days (one invite-expiry window), or run a one-off script that re-relays links for unused unexpired invites on the new domain (through the guards).

---

## 3. DB Changes

**Reuse `Application` + `SurveyInvite`; no new SurveyResponse model.** Mapping: email→`email`, full name→`fullName`, DOB→`dateOfBirth` (encrypted), employer→`employer`, gross monthly income→`monthlyIncome`. **Phone attribution:** `callerPhone` = `invite.phone`, always — never the typed form value. The form's editable phone answer is stored as `customResponses.contact_phone` and is everywhere labeled "self-reported (unverified)". The five non-standard questions go in `Application.customResponses` under stable keys: `bedrooms_needed`, `household_size`, `employment_start_date`, `employed_one_year`, `time_at_current_address`, plus `contact_phone`.

**Additive migration** (`apps/server/prisma/schema.prisma`, real migration via `npm run prisma:migrate` in apps/server — this repo uses real migrations, not db push):

```prisma
model Application {
  // ... existing fields ...
  forwardedAt DateTime?   // owner summary confirmed sent
  // NOTE: reviewedAt ALREADY EXISTS and is owned by the applications review flow
  // (set by /api/applications/[id] on status='reviewed'; rendered on the detail
  // page; asserted by workflow-applications.test.ts). Do NOT re-add it and do
  // NOT stamp it from the surveys tab — the tab reuses the existing status
  // workflow instead (§5).
}

model OutboundRelayMessage {
  id            String    @id @default(cuid())
  to            String
  body          String
  kind          String    // 'link' | 'forward' | 'heartbeat' | 'test'
  status        String    // 'pending' | 'deferred' | 'sent' | 'failed'
  attempts      Int       @default(0)
  lastError     String?
  inviteId      String?   // FK SurveyInvite (link kind)
  applicationId String?   // FK Application (forward kind)
  createdAt     DateTime  @default(now())
  sentAt        DateTime? // osascript success
  confirmedAt   DateTime? // chat.db delivery confirmation
  @@index([status, createdAt])
  @@index([to, kind, status, sentAt])
}

model ProcessedWebhookEvent {
  id         String   @id @default(cuid())
  provider   String   // 'telnyx'
  messageId  String
  receivedAt DateTime @default(now())
  @@unique([provider, messageId])
}
```

The `OutboundRelayMessage` ledger is the backbone: it makes link sends retryable (the sweep covers **both** links and forwards), gives the cooldown a truthful key (last row with `status='sent'` per phone — *delivered-ish*, not *minted*), persists hourly/daily cap counters across restarts (counted by querying sent rows, no separate counter table), and feeds the status panel real data instead of vibes.

**Raw SQL in the same migration:** a partial unique index on `SurveyInvite (propertyId, phone) WHERE "usedAt" IS NULL` — closes the findFirst-then-create race in `createOrReuseSurveyInvite` (catch P2002 → re-fetch). `SurveyInvite` otherwise unchanged; use `channel='sms'`.

**Seed/data prerequisite (not schema):** a `Property` row must exist with `twilioPhone = '+17089070695'`, `isActive = true`, `smsIntakeEnabled = true`, and `intakeAutoReply` intro text — otherwise `handleIncomingSms` silently ignores messages. M1 gate verifies this.

---

## 4. Server Changes (`apps/server`)

### 4.1 Messages.app send module — CREATE `src/services/messages-relay.ts`

Exports `sendViaMessagesRelay(to: string, text: string): Promise<void>`. Rules (all proven on this Mac via Iris's MessagesTool):

- **`execFile`, never `exec`** — no shell quoting.
- **Pin the SMS service** (NOT iMessage — iMessage fails for Android recipients and may send from the ymail Apple ID):

```ts
import { execFile } from "node:child_process";

function aplEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
// Literal newlines break osascript -e strings: split and join with ' & linefeed & '
function aplString(s: string): string {
  return s.split("\n").map((l) => `"${aplEscape(l)}"`).join(" & linefeed & ");
}

export function sendViaMessagesRelay(to: string, text: string): Promise<void> {
  // to must be validated E.164 (+1...) by the caller before reaching this template
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      [
        "-e", 'tell application "Messages"',
        "-e", "set targetService to 1st service whose service type = SMS",
        "-e", `set targetBuddy to buddy "${aplEscape(to)}" of targetService`,
        "-e", `send ${aplString(text)} to targetBuddy`,
        "-e", "end tell",
      ],
      { timeout: 25_000 },
      (err, _stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())
    );
  });
}
```

- Compatibility fallback if `buddy`/`service` breaks on a future macOS: `send "msg" to participant "+1..." of account id "716D7199-9C65-487C-936F-2FC119365FB9"`.
- **TCC is launch-context-dependent.** macOS attributes AppleEvents consent to the *responsible process*: under Terminal the grant is Terminal→Messages; under a launchd LaunchAgent (our production mechanism, §4.8) node itself needs its own grant; under npm/turbo/IDE wrappers attribution differs again. Therefore: the production launch mechanism is decided in **M2, before** the relay module's live gate, and the M3 live-send gate runs **through the real server started the real way** — never via an interactively-run one-shot script, which would test the wrong TCC context. Expect one interactive approval on first launchd-context send; that's part of the M3 gate.
- **Detect `-1743` / "not authorized"** in stderr and treat it as a distinct failure class: mark the `OutboundRelayMessage` row `failed` with `lastError='tcc'`, fire `display notification`, and surface a red "TCC revoked — re-approve automation" banner in the status panel. `brew pin node` (the grant is pinned to `/opt/homebrew/Cellar/node/25.2.1/bin/node`; upgrades re-trigger the prompt). Runbook rule: after any node/macOS upgrade, press the settings tab's Send-test button and confirm delivery.
- **AppleScript success ≠ delivery** — the iPhone relays silently, and `send` can succeed while the iPhone is off/out of coverage. Two detectors:
  - **chat.db confirmation:** Full Disk Access already exists. ~2 minutes after an osascript success, the sweep queries `~/Library/Messages/chat.db` (`message.is_sent` / `date_delivered` for the handle) — read-only sqlite. Confirmed → `confirmedAt` set, status `sent` (and `forwardedAt` for forwards). Unconfirmed → row stays `pending` for the sweep to retry, panel shows "unconfirmed". This is the *only* real delivery signal for the forward path and is **in scope**, not "optional later".
  - **Daily heartbeat:** the sweep sends `"relay heartbeat <date>"` (kind `heartbeat`, through the guards, counts toward caps) to the forward-to number each morning. A missing morning text tells the user the relay is down even when everything on the Mac *looks* green (Text Message Forwarding silently toggled off after Apple ID password changes / iOS updates, Messages signed out, iPhone dead for days).

### 4.2 Relay branch + intake-mode behavior — MODIFY `src/routes/telnyx-sms.ts`, `src/handlers/survey-intake.ts`, `src/handlers/sms-handler.ts`

**Webhook dedupe (before anything else):** parse `data.payload.id` from the Telnyx body (the current interface at lines 7–17 doesn't even read it) and insert into `ProcessedWebhookEvent` before processing; on unique-violation, return 200 without processing. DB-backed so it survives restarts across Telnyx's retry window (ngrok blips dropping the 200 mid-flight cause retries routinely). Prune rows >7 days in the sweep.

**Per-phone serialization:** wrap `processTelnyxInbound`'s mint+send section in a keyed in-process promise chain (`Map<phone, Promise>`), so a double-tap send or a retry racing the original can't mint two tokens / send two texts. The partial unique index (§3) is the DB-level backstop.

**Delivery seam** (replacing the reply loop):

```ts
const relayEnabled = (await resolveConfig("sms_relay", "enabled")) === "true";
for (const reply of result.replies) {
  if (relayEnabled) {
    await relaySendWithGuards(from, rewriteForRelay(reply), replyMeta(reply)); // §4.3
  } else {
    await sendTelnyxSms(to, from, reply);
  }
}
```

`rewriteForRelay` fixes two copy problems that only exist in relay mode:
- **Identity in the notification preview.** iOS "Filter Unknown Senders" buries texts from +17084158984 with no notification; the first ~40 chars are all the tenant may ever see on the lock screen. Prefix every relayed message: `"GHEM Properties (you texted 708-907-0695): "`.
- **Opt-out points at a number that actually processes STOP.** `handleSurveyIntake` (survey-intake.ts:65) appends "Reply STOP to opt out." — under relay, a STOP reply would go to the personal iPhone, which nothing processes: no `SmsOptOut` row, system keeps texting them, TCPA exposure. Rewrite the suffix in relay mode to: `"To opt out, text STOP to (708) 907-0695."` (Manual mirror affordance for STOPs that land in the personal thread anyway: §5.)

**Intake-mode behavior fixes in `handleSurveyIntake` / `handleIncomingSms`** — as written, `smsIntakeEnabled=true` short-circuits *every* non-STOP/HELP text into a survey link, killing the AI flow property-wide and recording nothing. Three changes:
1. **Persist every inbound text** in intake mode (create/append the `SmsConversation` row) so the dashboard Messages tab shows what tenants actually said. Zero visibility is not acceptable for a business line.
2. **Known-Tenant bypass:** the `isTenant` lookup already exists at sms-handler.ts:78 — when the caller is a current tenant, skip the intake branch entirely so maintenance/Q&A flow keeps working ("my sink is leaking" must not get an application link).
3. **Follow-ups and post-submission texts:** before minting, check for a completed `channel='sms_link'` Application (or a `usedAt` invite within 30 days) for this phone+property. If found, reply "We received your application and will be in touch" — **never** a fresh link ("thanks, just submitted!" must not trigger "apply again" from a personal number; that reads as phishing and burns cap). Additionally, any text that is *not* the first link-triggering message gets forwarded to the owner via the relay: `"Tenant +1312… asked: <text>"` (sanitized per §4.5) — so a human can reply from Messages.app and the funnel has a conversational escape hatch.

Document explicitly (§8, settings help text): **while `smsIntakeEnabled=true`, the AI apply conversation is off** for non-tenants; that is a deliberate mode, with a toggle on the settings tab (§5).

### 4.3 Guards + send ledger — CREATE `src/services/relay-guards.ts`

`relaySendWithGuards(to, text, meta)` — every relay send in the system (links, forwards, heartbeat, test) goes through this, including sweep retries. Sequence:

1. **Reserve synchronously, before the first await:** insert the `OutboundRelayMessage` row (status `pending`) and claim the in-memory cooldown slot in the same tick — no check-then-act across awaits.
2. **Opt-out check:** query `SmsOptOut` for `to` before *every* send (not just relying on the upstream handler) — covers forward retries and phones opted out mid-flow.
3. **Per-tenant cooldown** (`cooldown_minutes`, default 60): applies **only to survey-link replies** (`meta.kind==='link'`; `handleSurveyIntake` tags its reply). STOP/HELP confirmations and owner forwards are **exempt from the cooldown** (suppressing an opt-out confirmation is a compliance regression) but still count toward global caps. Keyed on the latest `status='sent'` link row for this phone — link *delivered*, not link *minted*, so a failed send doesn't suppress its own recovery.
4. **Global caps, persisted:** counted from `OutboundRelayMessage` sent-rows (survives restarts — an in-memory counter zeroed by a reboot would let the sweep burst). `hourly_cap` default **5**, `daily_cap` default **25**, plus a **per-new-recipient cap** (max N first-contact sends/day, default 10) — because sender IDs are spoofable via cheap VoIP, an attacker rotating spoofed 'from' numbers can otherwise make the personal iPhone text arbitrary victims URL-bearing messages; the per-tenant cooldown never triggers on rotating numbers, so only these global/daily/new-recipient caps stand between the user's personal number and a smishing-signature spam flag. On breach: mark the row **`deferred`** (never silently drop — a dropped link is a lost lead), log, and let the sweep drain deferred rows in later hours at the capped rate. Reserve 2 slots/hour for forwards so link traffic can't starve summaries and vice versa. Deferred/failed counts get a badge in the status panel.
5. **Send + confirm:** osascript → `sentAt`; chat.db confirmation later flips `confirmedAt` (§4.1). Failure → `failed` + `lastError`, retried by the sweep with capped attempts (e.g. 5).

**Sweep (see §4.5 for why it is a `setInterval`):** every 10 minutes, retries `pending`/`failed` (attempts < max) and drains `deferred` rows of **all kinds**, max **1–2 sends per run** — a backlog drains over successive runs; burst-after-quiet from a consumer line is precisely the carrier-flag signature to avoid. All sweep sends go through `relaySendWithGuards` (no bypass path exists).

### 4.4 Survey routes — CREATE `src/routes/survey.ts`, register in `src/index.ts`

Fastify serves no HTML today; precedent for non-JSON is `reply.type("text/xml")` in twilio-voice.ts. No plugin needed. **Set `trustProxy: true` on the Fastify instance** — without it every tunneled request has `request.ip === 127.0.0.1` (the ngrok agent's local connection), which breaks rate limiting and any IP-based logic (see also §4.7 on `/internal` routes).

- **`GET /survey/:token`** — validate token (exists, `usedAt` null, `expiresAt` future; port the 404/410/410 logic from `apps/tenant-site/src/app/api/survey/[token]/route.ts`). Return `reply.type("text/html").send(html)`: one self-contained mobile-first page (inline CSS, no framework, large touch targets) with exactly the 11 questions:
  1. Email (`type=email`, required) 2. Full name 3. Phone (`type=tel`, prefilled from `invite.phone`, editable — stored as self-reported contact phone only, §3) 4. Date of birth (`type=date`) 5. Bedrooms needed (select 1–4+) 6. Number of people living in the apartment (`type=number`) 7. Where do you work 8. Date of employment (`type=date`) 9. Employed at current job at least 1 year (y/n radio) 10. Gross monthly income (`type=number`) 11. How long at current address
  Invalid/used/expired tokens get a friendly HTML error page, not JSON. Bad-token path is cheap: single indexed lookup, no DB writes, generic page — scanning must cost us nothing.
- **`POST /survey/:token`** — server-side validation of all 11 fields (length caps, HTML stripped). **On validation failure, re-render the form with the tenant's entered values preserved (escaped)** — never a bare error page; a tenant who typed 11 fields on a phone will not do it twice. Then one **`prisma.$transaction`** containing all three writes, so a mid-flight failure (Postgres hiccup, encryption error) rolls back the claim and the token stays valid:
  1. Atomic claim: `updateMany({ where: { token, usedAt: null }, data: { usedAt: now } })`, count 0 ⇒ 410 page.
  2. Create `Application` with **apply-route parity** (the tenant-site route at `apps/tenant-site/src/app/api/apply/route.ts` is the semantic reference): `channel='sms_link'`, **`status='completed'` + `completedAt`** (otherwise rows sit 'in_progress' forever and evade every completed-status query), `callerPhone = invite.phone` (authoritative, immutable — the typed phone goes to `customResponses.contact_phone`), `dateOfBirth` encrypted via `packages/shared/src/encryption.ts`, extras in `customResponses`. Port the **30-day duplicate check** (completed application for same phone) — duplicate ⇒ friendly "we already have your application" HTML, roll back the claim.
  3. Link `surveyInvite.applicationId`.
  On unexpected error: 500 page saying "something went wrong — please resubmit" (the token survived). Reply with the thank-you page **first**, then fire-and-forget `forwardSurveySummary` (which is ledger-backed, so "fire-and-forget" is safe here).
- **Rate limiting:** do **not** reuse the existing keyGenerator (`lib/rate-limit.ts:39-45` keys on the FIRST X-Forwarded-For entry — client-supplied, trivially rotated for a fresh bucket per request). For survey routes: key on the **last** XFF entry (appended by the tunnel, reflecting the true peer) at 30 req/min, **plus** an absolute global budget on survey traffic (120 req/min total, independent of key) so header games can't exceed a ceiling and a keyless scanner collapsing to one bucket can't 429 real tenants indefinitely.

### 4.5 Forward-to logic — CREATE `src/services/survey-forward.ts`

`forwardSurveySummary(applicationId)` composes the owner summary and sends it via `relaySendWithGuards(forwardTo, summary, {kind:'forward'})` where `forwardTo = resolveConfig("sms_relay","forward_to")`. `forwardedAt` is set only when the ledger row reaches confirmed/sent (§4.1) — never on bare osascript success.

- **Minimal by default.** SMS to a personal number transits carrier infra, both parties' Messages history, and iCloud sync — re-broadcasting applicants' financial PII there undercuts the whole §2 posture, without applicant consent. Default summary: `"New application: <first name>, <bedrooms>br — view: <dashboard link>. Texted from: +1312… (self-reported contact: +1773… )"` — the self-reported line appears only when it differs from the verified number, labeled as unverified. **No income, employer, email, or DOB.** A `forward_detail` knob (`minimal` | `full`, default `minimal`) lets the user explicitly opt into full summaries (still never DOB) knowing the exposure — flagged in the settings tab helper text.
- **Content neutralization before ANY relay send** (shared `sanitizeForSms()` used by forwards *and* the §4.2 tenant-text forwarding): collapse all whitespace runs and control characters (`\n`, `\r`, U+2028/U+2029, bidi controls) in each user-supplied value to single spaces, cap each value at ~80 chars and the total at ~600, always prefix with fixed labels (`Employer: …`). `aplEscape` protects the osascript layer; this protects the *recipient* from message-structure forgery — a submitted "name" of `John\n\nGHEM SECURITY: reply with your password` must not render as a second message from a trusted number.
- **Retry: a plain in-process `setInterval`, NOT a BullMQ job.** Verified: the scheduler is *not* tolerant of Redis absence in the way that matters — `src/index.ts` awaits `registerJob()` for every job **before** `server.listen()`, and `lib/redis.ts` uses `maxRetriesPerRequest: null`, so with Redis down at boot `queue.upsertJobScheduler` sits in ioredis's offline queue forever and the server hangs before ever listening. The one component that must be reliable cannot ride the least reliable dependency. The sweep (`setInterval`, 10 min) lives in the server process, needs only Prisma, and exists whenever the server does. It: retries/drains the `OutboundRelayMessage` ledger (§4.3), runs chat.db confirmations, sends the daily heartbeat, prunes `ProcessedWebhookEvent`, and runs the daily Telnyx balance check (§4.8).

### 4.6 Base URL fix — MODIFY `src/handlers/survey-intake.ts`

`resolvePublicBaseUrl` currently prefers `websiteConfig.customDomain` per userId then falls back to `TENANT_SITE_URL || http://localhost:3002` (not public). **Scope the override:** apply `resolveConfig("sms_relay","survey_base_url")` **only when the property is the relay property / `sms_relay.enabled` is true or the property has no live customDomain** — a blanket global-first override would hijack link generation for any future landlord with a real custom domain, and per §8 the config outlives the relay. Resolution order: customDomain (non-relay properties) → `survey_base_url` → env fallback. Link becomes `https://<domain>/survey/<token>`, served by Fastify itself.

### 4.7 Server hardening — MODIFY `src/index.ts`

- **Fail fast at boot** if `PII_ENCRYPTION_KEY` is missing/malformed (64-hex) — not per-submission, where it would burn a tenant's token mid-transaction.
- **Startup ordering:** move the `registerJob` loop **after** `server.listen()`, and wrap each `registerJob` in `Promise.race` with a 10s timeout so Redis absence degrades (logged, skipped) instead of hanging the webhook endpoint. This fixes the reboot-with-Docker-down hang for the whole server, independent of this feature.
- **`/internal/relay-test`:** "localhost-only" is meaningless behind a tunnel — every tunneled request arrives from 127.0.0.1, so an IP check passes for the entire internet, handing anyone who finds the hostname a send-SMS-from-the-personal-iPhone button. Two required layers: (1) require a shared-secret header (random 32-byte value, `sms_relay.internal_secret` in SystemConfig/env, compared constant-time via `crypto.timingSafeEqual`); (2) route the test send through `relaySendWithGuards` (`kind:'test'`) so even a leaked secret is bounded by caps and logged in the ledger. Preferred stronger variant if time allows: bind internal routes to a second Fastify instance on 127.0.0.1:3006 that the tunnel does not forward — making the localhost claim actually true — with the secret kept as defense in depth.
- **`GET /health/deep`:** `SELECT 1` via Prisma + Redis ping (Redis failure reported in the body but non-fatal), returning 200 only when Postgres is reachable. Rationale: `/telnyx/sms` 200s *before* any DB access, so with Docker down the server looks alive while `processTelnyxInbound` throws into a log nobody reads and Telnyx never retries — "server up" must not equal "tenant gets a reply". This endpoint is what the external monitor watches (§4.8).

### 4.8 Ops envelope (new — the availability problem is engineered, not delegated)

Concrete artifacts, built and drilled in M2:

- **launchd LaunchAgents with `KeepAlive`** for: the Fastify server (production node binary path, env file), the tunnel agent (ngrok with `inspect: false` and the reserved static domain, or `cloudflared`), and `colima` (Docker: Postgres 5433/Redis 6380). LaunchAgents (user session) rather than LaunchDaemons because osascript→Messages requires a logged-in Aqua session anyway.
- **Sleep:** `sudo pmset -c sleep 0 disablesleep 1` (or Amphetamine) so lid-closed ≠ dead.
- **Reboot path:** enable auto-login (accepting the FileVault tradeoff) **or** document that any reboot requires a manual login before anything runs — user decision, recorded in the runbook (see "User actions required").
- **External monitoring** — external, because any on-Mac alerting dies with the Mac: a free healthchecks.io/UptimeRobot check hits `https://<tunnel-domain>/health/deep` every 5 minutes and emails/pushes the user on failure. This catches: Mac asleep/rebooted, tunnel dead (ngrok process died while the server lives — Telnyx would be getting tunnel 404s), Docker down (deep check fails while the process runs).
- **Telnyx-side monitoring** — a green M0 is a point-in-time fact; trial credit bleeds down with inbound + number rental, and trial numbers can be reclaimed, killing inbound *at Telnyx* with nothing observable on the Mac. The sweep checks `GET /v2/balance` daily (API key already configured for `sendTelnyxSms`) and alerts through the heartbeat channel when below threshold; the status panel shows balance + a red banner. M0 records the starting balance and computes weeks-of-runway.

---

## 5. Dashboard Changes (`apps/dashboard`)

### MODIFY `src/components/layout/DashboardShell.tsx`
Append to `adminNavItems` (renders only for `role === "admin"`; navigation-consistency test doesn't assert on this array):
```ts
{ label: "Survey Responses", href: "/admin/surveys", icon: "clipboard" },
{ label: "SMS Relay", href: "/admin/sms-relay", icon: "chat" },
```
Reuse existing icon keys — no new SVG cases.

### CREATE `src/app/admin/surveys/page.tsx` — Survey Responses tab
Copy the `admin/audit/page.tsx` exemplar (list + filter + pagination, `"use client"`, `<DashboardShell>`, standard header/spinner/empty-state/error-banner idiom). These rows also appear in the landlord-facing `/applications` page (which already filters `channel='SMS Link'` and has a full detail page) — so this tab **complements rather than duplicates**: each row **links to the existing `/applications/[id]` detail page** instead of re-implementing an expandable full view, and "seen/reviewed" state reuses the **existing status workflow** (`completed` → `reviewed` via the existing PATCH) rather than a new toggle fighting over `reviewedAt` (§3). Columns: submitted-at, name, verified phone, bedrooms, income, forward status (green `sentAt+confirmedAt` / yellow pending-or-unconfirmed / red failed), status. Filters: property, status, **submitted-date range, name/phone search**; **CSV export button** (repo has CSV precedent) — the user will screen applicants by pulling rows out. Secondary section: outstanding (unused, unexpired) SurveyInvites **including link-send status from the ledger** — invites whose link send failed/deferred are flagged so the user can text the person manually from Messages as a last resort. Per-row "Opt out this phone" action (upserts `SmsOptOut`).

### CREATE `src/app/api/admin/surveys/route.ts` (+ `[id]/route.ts`)
Hand-rolled admin gate per repo convention (**not** the api-handler wrapper): `getServerSession(authOptions)` → 403 unless `session.user.role === "admin"`. `GET` list: prisma `findMany` where `channel='sms_link'` (+ filters), `skip/limit` (cap 100), `{ entries, pagination: { total, skip, limit } }`. **The list response never contains `dateOfBirth`** — shipping every applicant's plaintext DOB on each page load (network tab, browser memory, error reporters) defeats at-rest encryption; DOB is decrypted only in a per-id detail fetch (`GET /api/admin/surveys/[id]?include=pii`), and in practice the row links to `/applications/[id]` anyway. A test asserts the list payload is DOB-free. `POST /api/admin/surveys/optout`: upsert `SmsOptOut` for a phone (the manual STOP-mirror affordance).

### CREATE `src/app/admin/sms-relay/page.tsx` — SMS Relay settings tab
Reads/writes through the **existing** `/api/admin/integrations` GET/PUT with `integrationId: "sms_relay"` — form idiom from `admin/integrations/page.tsx`. Settings: **Relay enabled**, **Survey base URL**, **Forward-to number**, **Relay-from number** (display), **Per-tenant cooldown**, **Hourly cap**, **Daily cap**, **Forward detail** (minimal/full, with PII-exposure helper text), **SMS intake enabled** (proxies the `Property.smsIntakeEnabled` flag via a small PATCH — it is this feature's main mode switch and the §8 retirement step; helper text: "ON = survey-link intake, AI apply conversation off"). Helper text notes the ≤60s resolver cache.

**Status panel** (from `/api/admin/sms-relay/status`, which reads the ledger + Telnyx balance): relay property intake state; last 10 `OutboundRelayMessage` rows with status (real data for "last send result"); pending/deferred/failed counts (badge); unconfirmed-delivery count; last heartbeat sent/confirmed; **Telnyx balance with red low-balance banner**; count of outstanding unexpired invites (the §8 "safe to retire tunnel?" number); TCC-failure banner when recent rows have `lastError='tcc'`.

**Manual opt-out box:** phone input + button → the optout route — one click to honor a STOP the user saw in their personal Messages thread.

**Send test message** button → CREATE `src/app/api/admin/sms-relay/test/route.ts` (POST, admin-gated) → calls Fastify `POST /internal/relay-test` with the shared-secret header (§4.7); the send goes through the guards as `kind:'test'`.

### CREATE tests (repo pattern: route-handler tests, flat in `src/__tests__/`)
`src/__tests__/admin-surveys.test.ts` and `src/__tests__/admin-sms-relay.test.ts`: `PII_ENCRYPTION_KEY` 64-hex at top before imports; vi.mock next-auth/@/lib/auth/@/lib/prisma/@tenant-ai/shared via importOriginal; mockAdminSession/mockClientSession/mockNoSession helpers; dynamic `await import("../app/api/admin/surveys/route")`; always assert 403 for non-admin and no-session; assert list payload contains no `dateOfBirth`; relative imports for routes.

---

## 6. Settings Storage

Add an `sms_relay` entry to `INTEGRATION_REGISTRY` in `packages/shared/src/integrations.ts` (category `"communication"`):

| key | envVar | sensitive | required | default/example |
|---|---|---|---|---|
| `enabled` | `SMS_RELAY_ENABLED` | no | no | `"false"` |
| `survey_base_url` | `SMS_RELAY_SURVEY_BASE_URL` | no | yes | tunnel domain (fixed before M4) |
| `forward_to` | `SMS_RELAY_FORWARD_TO` | no | yes | `+17735621795` |
| `relay_from` | `SMS_RELAY_FROM` | no | no | `+17084158984` |
| `cooldown_minutes` | `SMS_RELAY_COOLDOWN_MIN` | no | no | `"60"` |
| `hourly_cap` | `SMS_RELAY_HOURLY_CAP` | no | no | `"5"` |
| `daily_cap` | `SMS_RELAY_DAILY_CAP` | no | no | `"25"` |
| `forward_detail` | `SMS_RELAY_FORWARD_DETAIL` | no | no | `"minimal"` |
| `internal_secret` | `SMS_RELAY_INTERNAL_SECRET` | **yes** | yes | random 32-byte hex |

This gives us for free: AES-encrypted storage in `SystemConfig` under `sms_relay.<key>`, env-var fallback, the admin PUT machinery, and server-side reads via `resolveConfig("sms_relay", …)` (Fastify shares the resolver through `lib/config-store.ts`). Booleans/numbers are strings — parse at read sites. **Gotcha:** 60-second resolver cache ⇒ a dashboard toggle takes up to a minute to affect the running server; documented in helper text. Cap *counters* are NOT SystemConfig — they derive from `OutboundRelayMessage` rows (§4.3) so restarts can't reset them.

Per-property knobs (`smsIntakeEnabled`, `intakeAutoReply`) live on the `Property` row; set in M1 via script/Prisma Studio, toggled thereafter from the sms-relay settings tab (§5).

---

## 7. Security / PII

- **DOB encryption:** encrypt with `packages/shared/src/encryption.ts` before the Application insert. Decrypt only in the admin per-id detail fetch (never list responses). **Never include DOB in any SMS.** Key presence verified at server boot (§4.7).
- **PII in transit:** the survey POST terminates TLS at the tunnel provider's edge (ngrok or Cloudflare) — plaintext there is an accepted risk the user signs off on (see User actions). Tunnel run with `inspect: false` so no request bodies accumulate in the local ngrok inspector (localhost:4040). Post-10DLC, prioritize a real host.
- **Forwarded SMS minimization:** minimal summary by default (§4.5); income/employer/email only under explicit `forward_detail=full` opt-in; all user-supplied content passed through `sanitizeForSms()` (whitespace/control/bidi collapse, length caps, fixed labels) before any relay send — prevents message-structure forgery against the forward recipient.
- **Admin gating:** both new dashboard API routes hand-roll the `role === "admin"` check; tests assert 403s.
- **Public survey endpoint abuse:** 144-bit single-use tokens (transactional claim), 7-day expiry — enumeration infeasible, replay blocked, failed submissions don't burn tokens (§4.4). Rate limiting keys on the tunnel-appended (last) XFF entry with a global absolute budget; bad-token paths are cheap and generic; input length caps prevent 1MB `customResponses` blobs; HTML stripped; re-rendered form values escaped.
- **Relay abuse (SMS-to-anyone oracle):** spoofable inbound sender IDs mean the guards, not the cooldown, are the real defense — persisted hourly (5) / daily (25) / new-recipient caps, opt-out check before every send, deferred-not-burst semantics, all sends ledgered (§4.3). Copy varies per property/message (never byte-identical bodies). Clean tunnel domain (§2) is itself a spam-score mitigation.
- **`/internal/relay-test`:** shared-secret header (constant-time compare) + guard-routed; IP checks explicitly rejected as meaningless behind the tunnel (§4.7).
- **Webhook auth unchanged:** Telnyx signature validation (`telnyxSignatureHook`) stays on `/telnyx/sms`; message-id dedupe added on top.
- **osascript injection:** `aplEscape` on recipient and message; recipient validated E.164 before the template.
- **Opt-out integrity:** relay-mode copy directs STOP to the monitored number; `SmsOptOut` checked at the guard layer on every send; manual mirror affordance for STOPs seen in the personal thread; opt-out confirmations exempt from cooldown suppression.
- **Messages history hygiene:** relay sends appear in the personal Messages threads — inherent to the design; the ledger + status panel are the system of record.

## 8. Rollback / Retirement Plan (10DLC approval day)

The relay is a **delivery-layer branch behind one flag** — retirement is a toggle plus two explicit decisions:

1. Flip **Relay enabled → off** in /admin/sms-relay. Within ≤60s the reply loop reverts to `sendTelnyxSms` (outbound from +17089070695 — carrier-clean and consistent with the inbound number).
2. **Decide `smsIntakeEnabled`** (toggle is on the settings tab): keep link-intake (links now delivered by Telnyx — everything keeps working), or flip it off to return to the AI apply conversation. Nothing flips this automatically; leaving it on is a valid end-state but must be chosen, not defaulted into.
3. **Keep the tunnel + survey routes alive until the last unexpired invite passes `expiresAt`** — up to 7 days of already-texted links point at the tunnel domain; retiring it on approval day dead-links tenants mid-funnel. The status panel shows the outstanding-invite count; retire the tunnel when it reads zero (or run the re-relay script from §2).
4. Update `intakeAutoReply` / relay copy to drop the "replying from our direct line" wording and restore the plain "Reply STOP to opt out." suffix (the Telnyx number processes it natively again).
5. Forward-to summaries: keep the Messages relay (works regardless of 10DLC) or switch `forwardSurveySummary` to `sendTelnyxSms` once +17735621795 is reachable on the upgraded tier. The heartbeat + balance checks retire with the relay or stay as cheap monitoring — user's call.
6. Nothing to migrate or delete: `forwardedAt`, the ledger (useful audit trail), and the `sms_relay` registry entry stay. The `survey_base_url` override is already scoped (§4.6) so it cannot leak onto future landlords' domains.
7. The ops envelope (§4.8) **stays** until the webhook + survey hosting move to a real host — outbound no longer needs the Mac, but inbound and the survey page still do.

## 9. Milestones

**M0 — Live trial-tier inbound check + Telnyx account facts (gate before any code)**
Have a third, non-verified number text +17089070695. Also: record the account balance, compute weeks-of-runway at expected volume, and ask Telnyx support whether trial numbers expire/get reclaimed and whether inbound has sender restrictions (answers go in the runbook). Gate: the test message appears in server logs via the tunnel webhook, and balance/runway is documented. If inbound is blocked, stop and escalate (see User actions) — nothing else matters until inbound from arbitrary tenants works.

**M1 — Data prerequisites + migration + server hardening**
Property row for +17089070695 (`smsIntakeEnabled=true`, `intakeAutoReply`); Prisma migration: `Application.forwardedAt` (**only** — `reviewedAt` already exists and is owned by the applications review flow), `OutboundRelayMessage`, `ProcessedWebhookEvent`, partial unique index on SurveyInvite; `sms_relay` registry entry; §4.7 hardening (PII-key fail-fast, registerJob after listen with 10s timeout, trustProxy). Gate: `npm run prisma:migrate` clean; `npx vitest run` (full suite, 1,428 tests) green; server boots and listens with Docker/Redis deliberately stopped (degrades, no hang); texting the number (relay off) produces a SurveyInvite row **and a logged Telnyx outbound attempt failing with 40010 *or* 10039** — the test sender is unverified, so trial-tier 10039 (unverified recipient) is the *expected* error and equally proves the intake branch fired and the seam was reached; the gate's real assertion is invite-row + send-attempt, not a specific carrier code.

**M2 — Ops envelope + tunnel domain (gate before any live relay send)**
launchd LaunchAgents (Fastify, tunnel, colima) with KeepAlive; `pmset` sleep disabled; auto-login decision recorded; `/health/deep`; external monitor configured against the tunnel URL; tunnel finalized — Cloudflare named tunnel or reserved ngrok static domain, `inspect: false`, `survey_base_url` set (this domain is now frozen for the life of the relay). Gate: (a) reboot drill — power-cycle the Mac; webhook, tunnel, and Docker all return without touching the keyboard (or the manual-login caveat is explicitly accepted and documented); (b) kill the tunnel process → external monitor alerts within 10 min; (c) stop Docker → `/health/deep` fails → monitor alerts, while `/telnyx/sms` still 200s (documented behavior).

**M3 — Messages relay module + guards + ledger**
`messages-relay.ts`, `relay-guards.ts`, sweep `setInterval`, unit tests (mock execFile: escaping, newline joining, E.164 validation; guard tests: cooldown keyed on sent-rows, link-only cooldown scope, hourly/daily/new-recipient caps → deferred, opt-out check, synchronous reservation). Gate: unit tests green **and** a live send executed **through the production launch mechanism** — server started via its LaunchAgent, send triggered via the secret-gated `/internal/relay-test` — delivering to +17735621795, user confirms receipt, chat.db confirmation flips the ledger row (this validates the *real* TCC context; an interactively-run script would not). TCC drill: revoke the Automation grant, trigger a send, verify the row goes `failed/tcc` + notification fires, re-approve, verify the sweep retries to `sent`. `brew pin node` applied.

**M4 — Relay branch live**
Seam branch in `telnyx-sms.ts` (webhook dedupe, per-phone serialization, `rewriteForRelay`), intake-mode fixes (§4.2: conversation persistence, tenant bypass, completed-application ack, follow-up forwarding). Gate: with relay ON, a live text from the third-party test phone receives the survey link from +17084158984 within ~30s, lock-screen preview starts with the GHEM identity prefix and the STOP line names 708-907-0695; the inbound appears in the dashboard Messages tab; a text from a phone seeded as a known Tenant does NOT get a link (normal flow); a second "thanks!" text after a (seeded) completed application gets the ack, not a new link, and is forwarded to the owner; replaying the same Telnyx message id is a no-op; with relay OFF, behavior reverts (log shows Telnyx path).

**M5 — Survey page + submit + forward**
`routes/survey.ts` (GET/POST with transaction + apply-route parity), scoped base-URL fix, `survey-forward.ts` + sanitization + heartbeat + balance check. Gate: end-to-end on a real phone — tap the texted link, fill all 11 questions, submit; Application row `status='completed'` with DOB ciphertext in DB (plaintext via decrypt helper), `callerPhone = invite.phone` regardless of the edited form phone (typed value in `customResponses.contact_phone`), invite `usedAt` + `applicationId` set; second submit on same token → 410; second application within 30 days → friendly duplicate page, token not burned; **kill Postgres mid-submit once — verify usedAt rolled back and a resubmit succeeds**; +17735621795 receives the **minimal** summary, `forwardedAt` set only after chat.db confirmation; kill Messages mid-send once — verify the sweep retries (≤2/run); a multi-line malicious "name" arrives whitespace-collapsed under its fixed label; morning heartbeat text arrives.

**M6 — Dashboard tabs**
Both pages, API routes (incl. status + optout), nav entries, admin tests. Gate: `npx turbo build --force` green; new vitest files green (incl. the no-DOB-in-list assertion); as admin, the M5 response is visible in /admin/surveys, its row links to the working `/applications/[id]` detail page, CSV export downloads, date/search filters work; non-admin gets 403; settings tab round-trips a value (change cooldown → SystemConfig row updated → server reads it after cache expiry); `smsIntakeEnabled` toggle round-trips; status panel shows real ledger rows, Telnyx balance, heartbeat time, outstanding-invite count; Test-message button delivers (and a request without the secret header is 401); manual opt-out box creates an `SmsOptOut` row.

**M7 — Guard + failure drills (sign-off)**
Gate: (a) text twice within cooldown → one link sent, second suppressed with a `deferred`/skip record visible in the panel; (b) exceed hourly cap synthetically → rows go `deferred` (not dropped), then drain in the next window at ≤2/run — restart the server mid-test to prove counters persist; (c) **STOP drill, Telnyx side:** STOP to +17089070695 → `SmsOptOut` row created, **exactly one confirmation relayed** (the handler correctly replies with `shouldRespond=true` — suppressing it would be the bug), a subsequent text from that phone → silence, no relay send; (d) **STOP drill, personal side:** STOP sent to +17084158984 (lands in the personal thread), user clicks the manual opt-out button, subsequent texts to the Telnyx number verified suppressed; (e) link then STOP within 5 minutes → the confirmation is still delivered (cooldown exemption); (f) expired/used-token pages render friendly errors; (g) runbook finalized in the settings help text/README: Mac-asleep behavior, node-upgrade → press-test-button rule, heartbeat-missing = relay-down, low-balance response, retirement checklist (§8).

## 10. User actions required

Actions only the user can perform (account, portal, phone, physical, or policy decisions). Each is tied to the milestone that blocks on it.

1. **[M0] Send test texts from a third, non-Telnyx-verified phone** (borrow one) and later tap the survey link / fill the form on it (M5), and confirm receipt of test/summary texts on +17735621795 (M3, M5).
2. **[M0] Telnyx account:** if inbound from unverified senders is blocked, upgrade the account or expedite 10DLC — nothing proceeds without it. Ask support the trial-expiry/inbound-restriction questions (or approve us drafting the ticket). Keep the balance topped up per the runway math; respond to low-balance banners/alerts.
3. **[M2] Mac availability decisions:** approve `pmset` sleep-disable (or install Amphetamine); decide auto-login vs FileVault-protected manual login after reboots (this determines whether a power cut = silent outage until you type a password); keep the Mac plugged in and the user session logged in (Messages needs Aqua).
4. **[M2] External monitor account:** create the free healthchecks.io/UptimeRobot check under your email so alerts reach you (we configure the check itself).
5. **[M2] Tunnel/domain decision — blocks the first live link:** free Cloudflare named tunnel (recommended, ~10 min, needs your Cloudflare account), paid ngrok, or free ngrok static domain (reserve it in the ngrok dashboard). The chosen domain is frozen for the relay's lifetime.
6. **[M3] Click the one-time macOS Automation approval** when the launchd-launched server first sends via Messages, and re-approve + press the settings-tab test button after any node/macOS upgrade (`brew pin node` reduces this).
7. **[M4→ongoing] Accept the consumer-line risk and identity mix:** relayed texts come from your personal +17084158984; app-generated traffic on a consumer line is technically against carrier A2P rules (caps are the guardrail, spam-flagging of your personal number is the downside); business and personal threads mix in your Messages history. Explicit sign-off required before relay goes ON.
8. **[M4→ongoing] Watch your personal Messages** for tenant replies (they do NOT reach the webhook) and mirror any STOP you see there via the dashboard's opt-out button — this is a compliance obligation, not a nicety.
9. **[M4→ongoing] Keep the iPhone on, in coverage, signed into Messages, with Text Message Forwarding to this Mac enabled** — re-check the forwarding toggle after Apple ID password changes and iOS updates. The missing-morning-heartbeat signal is yours to notice.
10. **[M5] Sign off on the PII-in-transit accepted risk** (tunnel edge sees survey submissions in plaintext, §7) and decide whether to opt into `forward_detail=full` (income/employer over SMS) — default stays minimal.
11. **[Retirement] On 10DLC approval:** flip Relay off, decide the `smsIntakeEnabled` end-state (link intake vs AI conversation), and don't retire the tunnel until the panel's outstanding-invite count is zero (§8).