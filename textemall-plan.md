# Tenant-AI — Text-Em-All Sending Integration Plan

**Goal:** Program the sending of messages through the **Text-Em-All** number the business
already has — the same way the Zillow importer works: drive the signed-in Text-Em-All website
in Safari via AppleScript + in-page `fetch`, wrapped in the app's guard/ledger discipline so
sends are paced, opt-out-respecting, de-duplicated, and auditable.

**Builds on** the proven Zillow pattern (`zillow-extract.ts`: osascript finds/opens the tab,
runs a `fetch` from the page's own signed-in context, reads results back). This plan applies
that technique to Text-Em-All's outbound broadcast flow, and slots the result behind the
existing `relaySendWithGuards`-style ledger so Text-Em-All becomes a first-class send channel.

---

## 0. Decision: which sending path (READ FIRST — affects everything)

Three ways to send through Text-Em-All exist; pick per volume + terms, not by default:

| Path | Fit | Cost / gate | Verdict |
|---|---|---|---|
| **Official REST API** (`docs.text-em-all.com`, auth via `dev.text-em-all.com`) | Clean, supported, webhooks for replies/DLRs | **Credits Plan only + must send >50,000 msgs/month** to qualify | Best IF the account qualifies. Landlord volume (~200 leads) is far below the 50k floor, so likely **not available**. |
| **Zapier integration** (Text-Em-All's own recommended fallback for <50k) | No code, triggers/actions | Zapier subscription; limited to Zapier's action shapes | Viable low-effort option; worth pricing before building anything. |
| **Safari-driven website automation** (this plan's default) | Works at any volume on the existing plan, no API tier | Depends on Text-Em-All's private web endpoints (brittle; may violate ToS — verify §1) | The Zillow-style path. Default ONLY if API/Zapier don't fit. |

**M0 gate decides this.** Do NOT build the Safari path before confirming (a) the account can't
get API access at its volume, AND (b) automating the website doesn't breach Text-Em-All's
terms of service in a way the user is unwilling to accept. If the API is available, this whole
plan collapses to a small typed API client (much simpler, more durable) — see §5.

⟲ **Compliance is heavier here than for Zillow reads.** Zillow automation *read* the user's own
leads. This plan *sends* marketing/transactional texts through a third-party sender that has
its own 10DLC registration, opt-out obligations, and ToS. The app's own opt-out list
(`SmsOptOut`) MUST be enforced before every Text-Em-All send, on top of Text-Em-All's — a
number that texted STOP to our line must never receive a Text-Em-All message.

---

## 1. M0 — Reconnaissance & decision (no product code)

> **M0 recon started 2026-08-27 — BLOCKED: account not onboarded.** The Safari session at
> `app.text-em-all.com` is signed in but sitting on `/onboarding/` at **step 1 of 3, Email
> Verification** — "Please click the link in the email we sent to: alegclauredlz@gmail.com".
> Remaining onboarding: (2) Organization Information, (3) Phone Verification. No auth token in
> localStorage yet; the send/broadcast flow does not exist to reconnoiter until onboarding
> completes. A `/zapier` tab was also open (the Zapier fallback was being explored).
> **Cannot proceed with endpoint capture until the account is live and can actually send.**
> Next human step: finish the 3-step onboarding (verify email → org info → verify phone), land
> on the real dashboard, open the "new broadcast" flow, then resume the recon below.

- [ ] **Account/plan check:** log into the real Text-Em-All account. Record: current plan,
      whether API access is offered at this plan/volume, and the sending number(s) on file.
- [ ] **API-first probe:** if the Credits Plan / 50k path is remotely attainable, request auth
      at `dev.text-em-all.com`, capture the base URL, auth scheme, and the send-broadcast
      endpoint + payload. If obtained → **switch to §5, stop here.**
- [ ] **ToS read:** confirm whether scripted browser sending is permitted or prohibited. Record
      the finding verbatim in this file. If prohibited and the user still wants it, get explicit
      acknowledgement before proceeding (this is a send path, not a read).
- [ ] **Safari-session recon (only if pursuing the web path):** sign into Text-Em-All in Safari,
      open the "new broadcast/message" flow, and with the Network tab (or an in-page
      `window.fetch` capture BEFORE their bundle binds it — Zillow lesson) identify:
      the create-broadcast endpoint, how recipients are attached (inline list vs uploaded
      contact list vs saved group), the message-body field, the send/confirm call, and how a
      send is confirmed (response shape / broadcast id). Save one real captured request.
- **Gate:** §0 table resolved to ONE path in writing here; if web path, one real broadcast
      request captured and its confirm signal understood; ToS position recorded.

---

## 2. Architecture (Safari-driven path)

Mirrors the Zillow extractor, in reverse (send instead of read):

```
 tenant-ai server (this Mac)
   services/textemall-send.ts
      │  build recipients + body
      ▼
   services/textemall-driver.ts   ── osascript ──▶  Safari (signed-in Text-Em-All tab)
      │  (find/open tab, in-page fetch to the                │  create broadcast → send
      │   captured endpoint, read confirm)                   ▼
      │                                            Text-Em-All delivers via its number
      ▼
   OutboundTextEmAll ledger row (pending → sent/failed, broadcastId, recipients count)
```

**New model** (its own ledger, parallel to `OutboundRelayMessage` — different transport,
different failure modes, must be independently auditable):
```prisma
model TextEmAllSend {
  id           String   @id @default(cuid())
  recipients   String[]           // E.164 numbers actually submitted (post opt-out filter)
  body         String
  status       String   @default("pending") // pending | sent | failed | skipped
  broadcastId  String?            // Text-Em-All's id from the confirm response
  attempts     Int      @default(0)
  lastError    String?
  createdBy    String?            // "manual" | "zillow-auto" | userId
  createdAt    DateTime @default(now())
  sentAt       DateTime?
  @@index([status])
}
```

**Driver** (`textemall-driver.ts`): the Zillow-extract osascript machinery reused —
find-or-open the Text-Em-All tab, classify page state (`ok` / `needs-login` / `loading` — the
about:blank-reports-complete trap applies), run the captured create+send `fetch` from page
context, read the confirm/broadcastId back. `needs-login` never attempts credentials.

**Send service** (`textemall-send.ts`): the guard layer, modeled on `relaySendWithGuards`:
- filter recipients through `SmsOptOut` (and Text-Em-All's own opt-out if the API exposes it);
- de-dupe within the batch and against recent `TextEmAllSend` rows (cooldown);
- create the ledger row BEFORE the send (nothing fire-and-forget);
- one send in flight at a time (Safari is a shared surface — the Zillow `busy` lock);
- record confirm → `sent` + broadcastId, or `failed` + reason (retryable by a sweep).

---

## 3. Milestones (Safari-driven path)

### M1 — Driver + ledger
- [ ] Migration (`TextEmAllSend`); `textemall-driver.ts` (session find/open/classify + the
      captured send call); `textemall-send.ts` (opt-out filter, dedupe, ledger, in-flight lock).
- [ ] Config keys (encrypted SystemConfig): `textemall.enabled`, `textemall.from_number`,
      `textemall.daily_cap`, `textemall.cooldown_minutes`.
- [ ] Tests (Zillow-test lessons baked in: mock the driver, real-DB ledger, `TEST_PREFIX`
      phones, mock `resolveConfig`, inject clock): opt-out filter drops STOP numbers ·
      dedupe/cooldown · ledger lifecycle pending→sent/failed · needs-login recorded not
      retried · in-flight lock rejects concurrent sends · page-state classifier
      (about:blank=loading, login-redirect=needs-login).
- **Gate:** tests green; live: ONE real send to the operator's own phone via the signed-in
      Text-Em-All tab, confirm arrives, ledger row `sent` with a broadcastId. (Baseline safety:
      send only to the operator number during the gate — never a lead list.)

### M2 — Internal routes + dashboard control
- [ ] Internal routes (existing `x-relay-secret`): `POST /internal/textemall/send`
      `{to[], body}`, `GET /internal/textemall/status` (enabled flag, today's counts, ledger
      tail, needs-login), `GET /internal/textemall/history`.
- [ ] Dashboard proxy routes + a **Text-Em-All** panel/tab: enabled toggle (encrypted write,
      like the Zillow automation toggle), compose-and-send to a chosen audience, send history
      with delivery/broadcastId, needs-login banner ("sign into Text-Em-All in Safari").
- [ ] Tests: route auth/proxy (admin-zillow.test.ts style), toggle encrypted-write proof,
      panel states.
- **Gate:** tests + `turbo build` green; live: send from the dashboard to the operator phone,
      history row + confirm visible; opted-out number is refused with a clear reason.

### M3 — Wire to the lead pipeline (optional, gated on user intent)
- [ ] Make Text-Em-All a selectable send channel for Zillow-lead / SMS-lead survey blasts
      (channel switch alongside the relay + Telnyx paths), reusing the invite/link machinery so
      submissions still land in Applications. Copy stays Zillow/opt-out-compliant.
- [ ] Tests: channel selection, invite reuse, applied-flip still fires.
- **Gate:** live: one lead texted via Text-Em-All, link opens, submission lands, lead flips.

### M4 — Full-system stress & handoff
- [ ] Full suite + `turbo build`; restart via `./start.sh`.
- [ ] Plan + memory updated; feature ships **OFF** until the user enables it.
- **Gate:** suite green; observed real send recorded; user told what the toggle does.

---

## 4. Risks (Safari-driven path)
| Risk | Mitigation |
|---|---|
| Text-Em-All ToS prohibits scripted sending | M0 records the position; explicit user ack required before building; API/Zapier preferred if viable |
| Private web endpoints change | driver fails loudly (send → `failed`, never silent); captured request kept for re-mapping |
| Double-send (retry racing a confirm) | ledger row before send + in-flight lock + broadcastId dedupe |
| Sending to an opted-out number | `SmsOptOut` enforced before every send, on top of Text-Em-All's own |
| Safari session expired mid-send | `needs-login` status + dashboard banner; never auto-logs-in |
| Confirm ambiguity (send fired but response lost) | treat unknown as `failed`-pending; a sweep reconciles via broadcastId lookup if the site exposes one |

---

## 5. If the API IS available (collapses most of this plan)
Replace the driver with a typed client (`textemall-client.ts`): base URL + auth from
`dev.text-em-all.com`, `POST` the send-broadcast endpoint, store `broadcastId`, subscribe the
reply/DLR webhook to an internal route. Keep the SAME `TextEmAllSend` ledger, the SAME
`SmsOptOut` pre-filter, the SAME dashboard panel/toggle — only the transport swaps. This is
strictly better (durable, supported, real delivery receipts) and is the reason M0 checks the
API first.

## 6. Out of scope
- Any cap-raising or bypass of opt-out.
- Auto-login to Text-Em-All (session is manual, like Zillow).
- Reply-handling/inbox scraping (separate plan; the API path gets replies via webhook instead).
