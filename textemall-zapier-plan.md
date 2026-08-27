# Tenant-AI — Text-Em-All Sending via Zapier (Plan)

**Goal:** Program the sending of messages through the business's **Text-Em-All** number from
the Tenant AI app, using **Zapier** as the transport — the app POSTs to a private Zapier
webhook, and a Zap runs Text-Em-All's **Send Broadcast** action. No browser automation, no
API-tier floor, and it slots behind the app's existing opt-out + ledger discipline.

**Why this over the Safari-driven path** (`textemall-plan.md`): Text-Em-All's official REST API
requires the Credits Plan **and >50,000 messages/month** — far above this account's volume.
Zapier is Text-Em-All's own recommended integration for accounts under that floor. Compared to
scripting the website: plain HTTPS (no fragile private endpoints), no Mac-awake/Safari-session
dependency, replies/opt-outs can flow back via Zapier triggers, and it's a sanctioned
integration rather than a ToS gray area. Trade-off: a paid Zapier plan (~$20/mo; Webhooks is
not on the free tier) and coarser send-timing control than the in-house relay ledger.

---

## 0. Verified facts & decisions (read first)

- **Text-Em-All Zapier surface** (verified 2026-08-27):
  - Actions: **Send Broadcast**, plus contact create/update, create group, find contact.
  - Triggers: **New Inbound Text**, **New Outbound Text**, broadcast-status-changed.
- **Transport = Webhooks by Zapier → Catch Hook.** The app POSTs `{message, phones[]}` to a
  private Zap URL; the Zap's action is Send Broadcast. ⟲ Catch Hook is a **paid-Zapier**
  feature — confirm the plan/tasks cost in M0 before building.
- ⟲ **BLOCKER (carried from `textemall-plan.md` M0):** the Text-Em-All account is mid-onboarding
  (`app.text-em-all.com/onboarding/`, step 1 Email Verification → then Org Info → Phone
  Verification). The Zap's Send Broadcast action connects to a **live** account, so onboarding
  MUST finish before M1's live gate can send anything. Build-out (M1 code + tests) can proceed
  against a mocked hook; only the live gate is gated on onboarding.
- ⟲ **Opt-out is enforced on OUR side, every send.** A number that texted STOP to our line
  (`SmsOptOut`) must never be handed to Zapier/Text-Em-All. This filter is non-negotiable and
  runs before the POST — Text-Em-All's own opt-out is a second layer, not our excuse to skip it.
- ⟲ **The webhook URL is a bearer secret.** Anyone with the Catch Hook URL can send on the
  business's number. It lives ONLY in encrypted SystemConfig (`textemall.zapier_hook_url`),
  never in code, logs, or the browser — same handling as the relay internal_secret.
- **Idempotency:** Zapier may retry a Catch Hook delivery. Send a `clientSendId` (the
  `TextEmAllSend.id`) in the payload so a duplicate delivery is detectable; the ledger row is
  the dedupe authority on our side regardless.

---

## 1. Architecture

```
 Tenant AI server (apps/server)
   services/textemall-zapier.ts
     1. filter recipients through SmsOptOut          ── encrypted config:
     2. dedupe + cooldown vs recent TextEmAllSend        textemall.enabled
     3. create TextEmAllSend ledger row (pending)        textemall.zapier_hook_url
     4. POST {clientSendId, message, phones[]}  ─────▶  Zapier Catch Hook  ──▶  Text-Em-All
     5. 2xx → mark queued; non-2xx → failed (retryable)      (the Zap)          Send Broadcast
                                                                                    │
   (optional) reply/opt-out inbound:                                                ▼
   Zapier "New Inbound Text" trigger ──▶ POST /internal/textemall/inbound ──▶  delivers via
     → record reply, honor STOP into SmsOptOut                                  the TEA number
```

**Key point about delivery truth:** a 2xx from Zapier means "Zapier accepted the request," NOT
"Text-Em-All delivered." Real delivery/So state comes back only via the optional inbound Zap
or Text-Em-All's own dashboard. The ledger therefore distinguishes `queued` (Zapier accepted)
from any later confirmation — it must never claim `sent`=delivered on the POST alone.

**New model** (own ledger — distinct transport from `OutboundRelayMessage`):
```prisma
model TextEmAllSend {
  id           String   @id @default(cuid())
  recipients   String[]           // E.164 actually submitted (post opt-out filter)
  body         String
  status       String   @default("pending") // pending | queued | failed | skipped
  zapStatus    Int?               // HTTP status Zapier returned
  broadcastId  String?            // if a reply/status Zap ever reports it back
  attempts     Int      @default(0)
  lastError    String?
  createdBy    String?            // "manual" | "zillow-auto" | userId
  createdAt    DateTime @default(now())
  queuedAt     DateTime?
  @@index([status])
}
```

---

## 2. Milestones

### M0 — Onboarding + Zap wiring (no product code; mostly the user)
- [ ] **User:** finish Text-Em-All onboarding (verify email `alegclauredlz@gmail.com` → Org
      Info → Phone Verification) so the account can send.
- [ ] **User (or paired):** create the Zap — Trigger *Webhooks by Zapier → Catch Hook*
      (copy the URL), Action *Text-Em-All → Send Broadcast*; connect the Text-Em-All account;
      map incoming `message` → broadcast text and `phones` → recipients. Turn it ON.
- [ ] Confirm the Zapier plan that includes Webhooks and its per-task cost; record here.
- [ ] Manual smoke: from a REST client, POST a one-number test payload to the Catch Hook →
      confirm a real text arrives on the operator's phone and the Zap run shows success.
- **Gate:** a hand-fired POST delivers one real text; hook URL, payload shape Zapier expects,
      and cost all recorded in this file.

### M1 — Server send service + ledger (can build against a mock hook)
- [ ] Migration (`TextEmAllSend`); `services/textemall-zapier.ts` (opt-out filter, dedupe/
      cooldown, ledger-before-POST, `clientSendId`, 2xx→queued / else failed); encrypted config
      keys `textemall.enabled`, `textemall.zapier_hook_url`, `textemall.daily_cap`,
      `textemall.cooldown_minutes`.
- [ ] Tests (Zillow-suite lessons: mock the outbound `fetch`, real-DB ledger with `TEST_PREFIX`
      phones, mock `resolveConfig`, inject clock, set `PII_ENCRYPTION_KEY` for any encrypt path):
      opt-out filter removes STOP numbers · empty-after-filter is a no-op skip · dedupe/cooldown ·
      ledger pending→queued on 2xx, →failed on non-2xx/throw (retryable) · daily cap · disabled
      flag refuses · `clientSendId` present in payload · hook URL never logged.
- **Gate:** tests + full suite green. (No live send yet if onboarding incomplete.)

### M2 — Internal routes + dashboard control
- [ ] Internal routes (existing `x-relay-secret`): `POST /internal/textemall/send {to[],body}`,
      `GET /internal/textemall/status` (enabled, today's counts, ledger tail),
      `GET /internal/textemall/history`.
- [ ] Dashboard proxy routes + a **Text-Em-All** panel: enabled toggle (encrypted write, like
      the Zillow automation toggle), a compose-and-send box (pick audience → confirm → send),
      history with per-send status + zapStatus, and a "not configured" state until the hook URL
      is set. The confirm dialog states these go out via Text-Em-All's number through Zapier.
- [ ] Tests: route auth/proxy (admin-zillow.test.ts style), toggle encrypted-write proof,
      panel states (disabled / no-hook / queued / failed).
- **Gate:** tests + `turbo build` green. **Live gate (needs onboarding done):** send from the
      dashboard to the operator's phone → text arrives, history row `queued`; an opted-out
      number is refused with a clear reason and never reaches Zapier.

### M3 — Inbound replies / opt-out back-channel (optional)
- [ ] Second Zap: Trigger *Text-Em-All New Inbound Text* → Action *Webhooks POST* to
      `POST /internal/textemall/inbound` (shared-secret in the URL/header).
- [ ] Handler: record the reply; if the body is a STOP keyword, upsert `SmsOptOut` for that
      phone (mirrors the relay STOP handling) so future sends on ANY channel skip them.
- [ ] Tests: inbound parse, STOP→opt-out reflection, non-STOP recorded only, bad-secret 401.
- **Gate:** tests green; live: a reply of "STOP" from the operator phone flips it to opted-out
      and a subsequent send skips it.

### M4 — (Optional) wire as a lead-blast channel
- [ ] Make Text-Em-All(-via-Zapier) a selectable send channel for Zillow-lead / SMS-lead
      survey blasts, reusing the invite/link machinery so submissions still land in
      Applications and the applied-flip still fires. Copy stays opt-out-compliant.
- [ ] Tests: channel selection, invite reuse, applied-flip.
- **Gate:** live: one lead texted via Text-Em-All, link opens, submission lands, lead flips.

### M5 — Full-system stress & handoff
- [ ] Full suite + `turbo build`; restart via `./start.sh`.
- [ ] Plan + memory updated; feature ships **OFF** until the user enables it.
- **Gate:** suite green; observed real send recorded; user told what the toggle does and the
      recurring Zapier cost.

---

## 3. Risks
| Risk | Mitigation |
|---|---|
| Account not onboarded → can't send | M0 user step; M1 builds against a mock hook so only the live gate waits |
| Catch Hook URL leaks → anyone sends on our number | encrypted config only, never logged/exposed; rotate the Zap URL if leaked |
| 2xx ≠ delivered (Zapier accepted, TEA may fail) | ledger status `queued` not `sent`; optional inbound/status Zap for real confirmation |
| Sending to an opted-out number | `SmsOptOut` filter before every POST, on top of Text-Em-All's |
| Zapier retries a hook → double send | `clientSendId` + ledger dedupe authority |
| Zapier plan/task cost creeps with volume | daily cap config; cost recorded at M0; batch into one broadcast where possible |
| Zapier or TEA changes field mapping | Zap is user-owned/no-code to fix; app payload is stable `{clientSendId,message,phones}` |

## 4. Out of scope
- Cap-raising or opt-out bypass.
- Auto-onboarding / auto-login to Text-Em-All (manual, one-time).
- Rich delivery-receipt analytics (would need the official API's DLR webhooks; revisit only if
  volume ever crosses the 50k API floor, at which point the API path in `textemall-plan.md` §5
  becomes available and strictly better).
