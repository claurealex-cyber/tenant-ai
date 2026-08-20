# Tenant-AI — SMS → Online Survey Intake Plan (Twilio)

**Goal:** A prospective tenant texts the tenant-app's phone number, instantly receives a
link to an online rental-application **survey**, fills it out on the web, and the landlord
(a) configures the survey questions in the dashboard and (b) sees every submission.

**Decisions locked:**
- **Channel = Twilio SMS** (reuse the integration already in tenant-ai).
- **Number = the one already configured in the app** (existing `Property.twilioPhone` +
  `.env` Twilio credentials — no porting, no new provisioning code).
- **Survey = the full rental application** (reuse the existing apply form; one record per
  applicant in the existing Applications view).

---

## 0. Prerequisite reality check (read first)

The Twilio *integration* is fully built (routes, handler, per-property `twilioPhone`,
`SmsConversation`/`SmsOptOut`, STOP/HELP), but in this checkout it looks **not yet
credentialed with a real number**:
- `.env` → **`TWILIO_ACCOUNT_SID` is empty.**
- The only `twilioPhone` values visible are **`+1312555000x`** in the seed file —
  `555` is reserved/non-dialable, i.e. **test placeholders, not a live line.**
- A real number you provisioned via the dashboard would live in the **Postgres DB**,
  which I can't read right now (Docker/Postgres is down — see §0a).

**Therefore Phase 0 = confirm/provision the real number + populate credentials.** No new
number-management code is needed; the app already manages `twilioPhone` per property.

### 0a. Environment blocker to clear first
The Mac **disk is full** (`ENOSPC`). This is why Docker/Colima (and thus Postgres/Redis)
won't start, which blocks DB migrations, seeding, the dev servers, and tests. **Free disk
space before Phase 1** (candidates: `~/.ollama/models`, `~/llama.cpp`, the Colima VM image
in `~/.colima`, `~/.iris/tasks`, `~/.openclaw_backup*`, `~/.Trash`).

---

## 1. Stakeholders & what each needs

| Stakeholder | Needs |
|---|---|
| **Prospective tenant** (texter) | Text the number, get a link fast, fill a mobile-friendly survey, confirmation, ability to resume, clear privacy/opt-out. |
| **Landlord** (admin) | Configure survey questions per property, configure the intake number + auto-reply text, view/filter/export submissions, review & mark status, get notified on new submissions. |
| **Operator** (you) | Provision/own the Twilio number, satisfy A2P 10DLC + STOP/HELP, populate credentials, monitor deliverability. |

---

## 2. Channel — Twilio SMS (committed)

Reuse the existing pipeline: `apps/server/src/routes/twilio-sms.ts`
(`POST /sms/incoming`), `handlers/sms-handler.ts`, `SmsConversation`, `SmsOptOut`,
`lib/twilio-validate.ts`, `lib/rate-limit.ts`.

- Reliable 24/7; works on **all carriers incl. Android**; compliance primitives exist;
  auditable; scales to multiple properties/numbers.
- Cost: ~$1/mo per number + ~$0.0079/SMS, plus **A2P 10DLC** business registration.
- **Number mapping:** inbound `To` number → `Property.twilioPhone` → landlord. Already the
  app's model; we add the "reply with survey link" behavior to the handler.

**The Mac iMessage bridge was evaluated and rejected** (Appendix A) — a live probe showed
55% of messages keep their body in `attributedBody` (mandatory blob decoding) and it's
iMessage-only unless an iPhone forwards SMS, so most Android prospects wouldn't receive
the link.

---

## 3. What already exists (reuse, don't rebuild)

| Capability | Where | Reuse as |
|---|---|---|
| Per-property configurable questions (`fieldKey`,`type`,`required`,`sortOrder`,`isStandard`) | `Question` model; shared `QuestionDefinition`, `STANDARD_APPLICATION_FIELDS` | **Survey schema** |
| Dashboard question editor (add/edit/reorder/delete, ownership-checked) | `apps/dashboard/.../properties/[id]/questions/*` | **"Configure survey" UI** |
| Public multi-step apply form (validation + Turnstile CAPTCHA, custom Qs in step 4) | `apps/tenant-site/.../apply/[id]/page.tsx` | **The survey web app** |
| Submission write path (field split, PII encrypt, duplicate guard, landlord email) | `apps/tenant-site/.../api/apply/route.ts` | **Survey submit API** |
| `Application` storage incl. `customResponses` Json, `channel`, `callerPhone`, review fields | `Application` model | **Submission record** |
| Submissions list/detail + CSV export + status review | `apps/dashboard` applications pages | **"View submissions" UI** |
| Inbound SMS webhook + conversation state + STOP/HELP opt-out + signature validation | `apps/server` `twilio-sms.ts`, `sms-handler.ts`, `twilio-validate.ts` | **Inbound bridge** |
| PII encryption (AES-256-GCM, versioned) | `packages/shared/encryption.ts` | SSN/DOB at rest |
| IL / Cook County rental-law helpers | `packages/shared/illinois-law.ts` | Compliance copy/limits |

**Implication:** Survey, configuration, and submission viewing are **largely done**. The
focused new work is: the "text → link" reply, a link/attribution model, a token-aware
survey entry, and config/submission polish.

---

## 4. Architecture

```
 Prospective tenant's phone
        │  1. "Hi, I want to apply"  (SMS)
        ▼
   Twilio  ──2. POST /sms/incoming──▶  apps/server (Fastify)
        ▲       (validate signature)       │ 3. map To-number → Property → landlord
        │                                   │ 4. create SurveyInvite{token,phone,propertyId,exp}
        │  5. auto-reply: "Apply here:       │ 5. build URL https://<landlord-host>/survey/<token>
        │     https://…/survey/<token>"  ◀───┘    (respect SmsOptOut; STOP/HELP)
        │
 tenant taps link
        ▼
 apps/tenant-site  GET /survey/<token>
        │ 6. resolve token → property + prefilled phone → render apply form (reuse)
        │ 7. POST /api/apply (token in body) → encrypt PII, create Application
        │      (channel="sms_link", callerPhone=invite.phone), mark invite used
        ▼
 Postgres (Application + customResponses)
        │ 8. notify landlord (email) + optional SMS confirmation to tenant
        ▼
 apps/dashboard  → landlord configures questions  &  views/reviews/exports submissions
```

---

## 5. Data model changes (`apps/server/prisma/schema.prisma`)

Minimal, additive:

1. **`SurveyInvite`** (new) — attribution, expiry, resume, conversion analytics:
   ```prisma
   model SurveyInvite {
     id            String   @id @default(cuid())
     token         String   @unique          // URL-safe random
     propertyId    String
     property      Property @relation(fields: [propertyId], references: [id])
     phone         String                     // E.164, the texter
     channel       String   @default("sms")
     createdAt     DateTime @default(now())
     expiresAt     DateTime                    // e.g. now + 7 days
     usedAt        DateTime?
     applicationId String?  @unique
     application   Application? @relation(fields: [applicationId], references: [id])
     @@index([propertyId, createdAt])
     @@index([phone, propertyId])
   }
   ```
2. **`Property`**: add `smsIntakeEnabled Boolean @default(false)`,
   `intakeAutoReply String?`; add relation `surveyInvites SurveyInvite[]`. Reuse existing
   `twilioPhone` as the intake number.
3. **`Application`**: allow `channel` value **`"sms_link"`**; reuse `callerPhone`; add
   back-ref `surveyInvite SurveyInvite?`.
4. *(Optional `Question` enrichment)* `section String?`, `helpText String?`,
   `placeholder String?`, `options Json?` (multiple-choice). Backwards-compatible.

If **one number must serve multiple properties**, add `IntakeNumber { phone @unique,
userId, defaultPropertyId? }` and have the auto-reply ask which property. (Out of scope for
the single-number case.)

---

## 6. Component work

### 6.1 Server — inbound bridge (`apps/server`)
- Extend `handlers/sms-handler.ts`: on inbound text to an intake number, if sender isn't
  mid-application, **create a `SurveyInvite`** and reply with the survey URL. Respect
  `SmsOptOut`; keep STOP/HELP. Keep conversational-SMS apply as a fallback.
- Validate Twilio signature on the webhook (`lib/twilio-validate.ts`).
- URL building: resolve landlord host (custom domain/subdomain via tenant-context) →
  `https://<host>/survey/<token>`.
- Rate-limit invite creation per phone (`lib/rate-limit.ts`) to prevent link spam.

### 6.2 Survey web app (`apps/tenant-site`)
- New route **`GET /survey/[token]`**: validate `SurveyInvite` (exists, unexpired, unused),
  resolve its property, render the **existing apply form** with the phone pre-filled.
  Expired/used → friendly "request a new link" page (texts the number again).
- Extend **`POST /api/apply`**: accept `token`; on success set `channel="sms_link"`,
  `callerPhone = invite.phone`, set `invite.usedAt` + `invite.applicationId` in a
  transaction. Keep CAPTCHA, encryption, duplicate guard.
- Mobile-first review (phone is the primary device here). Confirmation screen + optional SMS
  "thanks, we got your application."

### 6.3 Dashboard (`apps/dashboard`) — config + submissions
- **Questions config:** reuse `/properties/[id]/questions`; if enriching `Question`, add a
  type picker (text/yes-no/number/date/**multiple-choice**), help text, sections, live
  preview.
- **Intake config (new):** `/properties/[id]/intake` — toggle `smsIntakeEnabled`, show the
  intake number, edit `intakeAutoReply`, show a test-send + the public survey URL/QR.
- **Submissions:** reuse applications list/detail; add a **channel filter** (incl.
  `sms_link`), show originating phone; optional "Survey links" tab (invites sent vs.
  completed = **conversion rate**). CSV export already exists.
- All pages/routes follow the existing **NextAuth session + ownership** pattern
  (`getServerSession` → 401; `findFirst({ where:{ id, userId }})` → 404).

### 6.4 Shared (`packages/shared`)
- Token helper (generate/verify URL-safe random token; DB-backed for analytics + resume).
- If multiple-choice added: extend `QuestionType` + validators.
- Reuse existing validators, encryption, email templates, audit, csv.

---

## 7. End-to-end flows

**Prospective tenant:** text number → receive link (<5s) → open survey (phone pre-filled,
property branded) → complete steps + CAPTCHA → submit → on-screen + SMS confirmation →
(if abandoned) link valid until `expiresAt` to resume.

**Landlord:** dashboard → pick property → **Questions** (add/reorder/mark required) →
**Intake** (enable SMS, set auto-reply, get number/QR) → as texts arrive, watch
**Submissions** (filter by channel/phone, open detail, decrypt-on-view PII, add review
notes, set status, export CSV) → email alert per new submission.

**Operator:** confirm/provision Twilio number + A2P 10DLC → set webhook to `/sms/incoming`
→ map number to property (`twilioPhone`, `smsIntakeEnabled`) → populate `.env` creds →
monitor deliverability/opt-outs.

---

## 8. Security, privacy, compliance

- **A2P 10DLC / TCPA:** register the brand/campaign; first auto-reply includes opt-out
  language; honor STOP/HELP (**exists** via `SmsOptOut`); keep a consent record.
- **PII:** SSN/DOB encrypted at rest (**exists**); decrypt only on authorized landlord
  view; never log plaintext; keep SSN out of URLs/tokens.
- **Token safety:** random, single-use, time-boxed (`expiresAt`, `usedAt`); rate-limit
  invite creation per phone; CAPTCHA on submit (**exists**).
- **IDOR:** every dashboard route ownership-checked (**existing pattern**).
- **Audit:** write `AuditLog` for config + submission-status changes (**helper exists**).
- **Webhook auth:** validate Twilio signatures (**`twilio-validate.ts` exists**).
- **IL / Cook County:** reuse `illinois-law.ts` for application-fee / source-of-income
  rules and required disclosures in the survey footer.

---

## 9. Phased implementation

- **Phase 0 — Unblock & confirm:** free disk space; start Docker/Postgres; **confirm the
  real Twilio number from the DB** (or provision one) and populate `TWILIO_ACCOUNT_SID/
  AUTH_TOKEN`; verify `/sms/incoming` reachable (tunnel/webhook).
- **Phase 1 — Data model:** add `SurveyInvite`, `Property.smsIntakeEnabled/intakeAutoReply`,
  `channel="sms_link"`; migration + Prisma generate; (optional) `Question` enrichment.
- **Phase 2 — Survey entry & submit:** `/survey/[token]` + token-aware `/api/apply` (phone
  prefill, invite consumption, attribution).
- **Phase 3 — Inbound bridge:** extend `sms-handler` to mint invite + reply with link;
  signature validation; rate-limit; opt-out respected.
- **Phase 4 — Dashboard:** Intake config page; submissions channel filter + originating
  phone; optional invites/conversion view.
- **Phase 5 — Notifications & polish:** landlord email alert, tenant SMS confirmation,
  resume page, branded/expired pages.
- **Phase 6 — Compliance & hardening:** A2P registration, consent/audit, IL disclosures.
- **Phase 7 — Tests:** see §10.

---

## 10. Testing (mirror existing vitest patterns: real DB, `TEST_PREFIX`, cleanup)

- **Unit:** token generate/verify; invite expiry/used logic; channel/phone attribution.
- **Server:** inbound → invite created + correct URL; opt-out short-circuits; rate-limit;
  unknown/unmapped number handled; bad Twilio signature rejected.
- **Survey API:** valid token prefilling; expired/used rejected; submission sets
  `channel`,`callerPhone`,`usedAt`,`applicationId`; PII encrypted; duplicate guard.
- **Dashboard:** ownership/401/404 on intake + submissions routes; CSV; status changes audited.
- **E2E (manual/verify):** real text → link → submit → appears in dashboard.
- **FK cleanup order:** SurveyInvite → Application → Property → User.

---

## 11. Open decisions / risks

1. **Confirm the real provisioned number + credentials** (Phase 0). The visible config is a
   `555` placeholder with an empty `ACCOUNT_SID`; need the live number + populated creds.
2. **A2P 10DLC lead time** for US business SMS (days–weeks) — register early.
3. **One number → one or many properties?** Single→single reuses `Property.twilioPhone`;
   many on one number ⇒ add `IntakeNumber` and have the auto-reply ask which property.
4. **Multiple-choice questions** — include in `Question` now or later.
5. **Disk full** (§0a) blocks all local build/test until cleared.

*(Decided: channel = Twilio; number = the app's existing one; survey = full application.)*

---

## Appendix A — Mac iMessage/SMS bridge (evaluated, NOT chosen)

Kept for reference. Rejected for public intake because a live probe of this Mac
(macOS 15.7.2) showed **~55% of messages keep their body in `attributedBody`** (mandatory
blob decoding) and the bridge is **iMessage-only unless an iPhone forwards SMS** (most
Android prospects wouldn't receive the link), plus Mac-always-on + Apple-ToS fragility.
Iris itself has no receive path to copy (it's send-only via the T-Mobile email→SMS gateway).
The genuine implementation, if ever revisited:

- **Receive:** poll `~/Library/Messages/chat.db`; `JOIN message↔handle`; convert Apple-epoch
  `date` (`/1e9 + 978307200`); decode `attributedBody` for the text; track a `ROWID`
  high-water mark for dedup. Requires **Full Disk Access**.
- **Send:** `osascript` → `tell application "Messages" … send <text> to buddy <+E.164>`.
  Requires **Automation** permission. SMS (green) only if an iPhone forwards texts to the Mac.
- **Schedule:** a `launchd` agent (`StartInterval` ~5–10s) runs the poller, POSTs new
  messages to the server (same handler), and sends the reply via AppleScript.
