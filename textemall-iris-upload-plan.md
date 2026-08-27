# BUILD STATUS 2026-08-27 — SAFE FOUNDATION BUILT; LIVE PARTS DEFERRED

**Built (autonomous, no live-fire):**
- **M1 CSV generator + batch ledger.** `.textemall/` gitignored; migration adds `TextEmAllBatch` (one row/day) + `ZillowLead.sentVia/sentBatchId`; `services/textemall-csv.ts` builds a baseline-scoped, opt-out-filtered, sent-batch-deduped CSV (single `Name` column, empty-skip). 6 tests.
- **M4 reversible channel toggle + branch.** `zillow.send_channel` (relay default | textemall); `runDailyAutomation` SEND branches (import unchanged): relay = `sendSurveyBatch` byte-identical; textemall = **build the day's CSV + record a `built` batch ONCE/day at `textemall_broadcast_hour` (first in-window tick ≥ hour, per-day claim) and NEVER send/flip leads**. `/api/admin/zillow/send-channel` route with the rev.4-I guard (refuses textemall unless `survey_mode=google_form`; does NOT auto-change it). 5 branch + reversibility tests, 4 route tests. Full suite green except pre-existing litter/flake; production `tsc` clean.

**NOT built — deferred (require live external systems + your setup; unsafe to automate after the relay-leak incident):**
- **M0 spikes** (Iris file-picker, contact-COUNT read, delete semantics, the Google-Forms POST end-to-end, Text-Em-All credit balance) — these are the go/no-go gates from rev.2–4; several could fire a REAL broadcast or need your Zap/account.
- **M2** Iris delete+upload GUI drive, **M3** the form-trigger broadcast, **M5** live orchestration + the GUI lock (rev.4 H). These send real messages / drive Text-Em-All's GUI and must run only with the group holding your own number and the Zap confirmed (rev.2 #6).

**Net:** flipping `send_channel=textemall` today safely produces a daily CSV of only the new leads (baseline-scoped, opt-out-filtered) at `~/tenant-ai/.textemall/leads-<date>.csv` for you to upload/broadcast MANUALLY (B1) — the working relay is untouched and one flip back to `relay` restores it. The fragile unattended parts await the M0 spikes.

# Tenant-AI → Text-Em-All — Plan — REV. 4 (third stress-test pass)

**rev. 4 root fixes (verified against code 2026-08-27):**

G. **Regression introduced by rev. 3 #B — "fire only on the tick where `hour == broadcast_hour`" means a MISSED noon tick skips the broadcast for the whole day.** If the Mac is asleep, the app is restarting, or Safari is logged out at 12:00, the 13:00 tick has `hour != 12` → no-op → no broadcast that day, silently. The relay is self-healing (every hour); this once-a-day-at-an-exact-hour design has no intra-day retry. → **Fire on the FIRST in-window tick where `hour >= broadcast_hour` AND no `sent`/claimed `TextEmAllBatch` exists for `localDay` yet.** So a missed noon runs at 1pm, 2pm, … until it succeeds or the 22:00 window ends; a `needs_login` at noon retries on the next tick (like the relay). Still exactly once/day (the per-day claim guarantees it).

H. **GUI-automation mutual exclusion is broader than the BullMQ worker.** The hourly Zillow IMPORT drives **Safari via osascript**; the Text-Em-All step drives the GUI via **Iris Navigate**. BullMQ `concurrency=1` serializes *zillow-daily* ticks, and the import→textemall steps within one tick are sequential — BUT the **manual "Scrape now" button** hits `/internal/zillow/import` directly (Safari), and could run WHILE the queued textemall Iris drive is clicking Text-Em-All → two automations fighting for screen focus, both corrupting. → Add a **process-wide GUI lock** (a single mutex/advisory lock) that EVERY GUI-driving path acquires: the hourly Safari import, the manual scrape, and the Text-Em-All Iris drive. A path that can't get the lock defers/fails cleanly. Never let two screen-driving jobs overlap.

I. **`survey_mode` is GLOBAL — forcing `google_form` for the Text-Em-All channel silently changes the INTAKE-TEXT and CALLER flows too.** `resolveSurveyModeConfig` drives `resolveSurveyLink` in `survey-intake.ts` (every inbound text AND every caller link), not just Zillow. rev. 2's "force textemall → google_form" would flip what texters and callers receive, and flipping back to relay wouldn't restore the prior mode. → **Do NOT auto-change `survey_mode`.** Instead, on enabling `send_channel=textemall`, **REFUSE unless `survey_mode` is already `google_form`** (the operator sets it deliberately), and document that the broadcast, intake texts, and caller links then all share that one Google-Form link — which is actually consistent, but must be a deliberate, non-side-effecting choice.

J. **"Free" covers Zapier, NOT Text-Em-All's own per-message cost.** Text-Em-All charges message **credits** per SMS segment per recipient even on the base plan; the static broadcast (property name + a ~70-char Google-Form URL + opt-out line) is very likely **multi-segment**. → **M0 must confirm the Text-Em-All account has a plan/credit balance that sustains daily broadcasts** at the expected volume, and the message copy should be trimmed toward one segment (short link if possible). Budgeting credits is a precondition, not an afterthought.

K. **"Delete every contact" — remove-from-GROUP vs delete-CONTACT is unverified and changes opt-out persistence + account hygiene.** If Text-Em-All keeps an account-level contact list and the delete only removes from the group, re-uploading the same number over days creates **duplicate account contacts** (bloat) — but opt-outs stay on the account contact (good). If delete removes the contact entirely, a re-uploaded previously-opted-out number could resurface (bad) unless Text-Em-All keeps a separate account-level opt-out registry. → **M0 must verify:** (a) which delete Iris performs, (b) that an opted-out number, once deleted and re-uploaded, is STILL suppressed at send. If (b) fails, the delete-all model is unsafe for opt-out compliance.

L. **Zillow leads have a single `name` field (+`nameKey`), no first/last.** The CSV's `First Name, Last Name` split (e.g. "Brideveaux Dupree-Taylor") is lossy/guessy. → Use a **single `Name` column** (Text-Em-All auto-maps name; a preview confirms), or put the whole name in `First Name` and leave `Last Name` blank — don't heuristically split.

Verified fine on this pass: BullMQ `concurrency=1` correctly serializes *queued* ticks (the remaining overlap is only the manual-scrape path — fix H); the per-day claim makes the once/day guarantee hold across the retry-within-window change (fix G).

---

# Tenant-AI → Text-Em-All — Plan — REV. 3 (second stress-test pass)

**rev. 3 root fixes (deeper mechanics, verified against code 2026-08-27):**

A. **The delete-all-standing-group model rests on ONE unverified, load-bearing capability: Iris reliably reading Text-Em-All's contact COUNT.** The whole "no stale contact gets re-texted" correctness hinge (§2d #4) is *verify empty (count 0) before upload* and *verify count == N after*. M0 lists reading the count as "still to confirm." If Text-Em-All's UI has no count Iris can read reliably, those invariants are uncheckable and the model is unsafe. → **M0 becomes a HARD go/no-go gate:** if Iris cannot reliably (1) read the group's contact count, (2) delete a contact and see the count drop, and (3) confirm empty, then the standing-group-delete approach is **abandoned** and the send falls back to **B1 (manual)** — because the Zap is bound to one fixed group and per-contact delete is the only rotation, there is no scripted plan-B for the group if the count can't be read. Do not build Half-A automation until M0 clears this.

B. **Split IMPORT (hourly) from BROADCAST (once/day) — the branch is at the SEND, not the whole run.** `runDailyAutomation` does import (L176) THEN send (L187) every hourly tick. Root structure:
   - **The hourly IMPORT keeps running unchanged on both channels** (leads stay fresh, deduped, baseline-scoped).
   - **Only the SEND branches:** `relay` → `sendSurveyBatch` every hour (as today); `textemall` → do NOTHING except on the FIRST in-window tick where `hour >= textemall_broadcast_hour` AND no `sent`/claimed `TextEmAllBatch` exists for `localDay` yet (rev.4 G: self-healing if the noon tick is missed) — then run the Iris delete+upload+form pipeline once. This keeps the relay path's shared prefix (claim + import) byte-identical (reversibility gate #6 is about *this* prefix), and the textemall broadcast self-gates to once/day without touching the 8–22 window.

C. **Partial failure AFTER the broadcast fires would double-contact tomorrow.** If the form POST succeeds (broadcast goes out) but the lead-status flip then fails, tomorrow's CSV re-includes those leads → a second broadcast. Root fix ordering: **stamp `TextEmAllBatch.status = "sent"` (and the phone list) the instant the form POST returns 2xx — BEFORE flipping leads.** Tomorrow's dedupe excludes any phone in a `sent` batch (not just `invited` leads), so a failed/partial lead-flip never causes a re-broadcast; the flip is a separate, idempotent, retryable step. "Already sent today" (per-day claim + a `sent` batch) hard-blocks a second POST.

D. **Delete-commit race (symmetric to the upload-commit race #13).** Iris deletes N contacts and the UI shows 0, but Text-Em-All may not have committed the deletes before the (poll-delayed) broadcast fires → a "deleted" contact still receives it. → Iris must **re-check the count after a short settle** and treat "empty" as *committed-empty*; the form POST happens only after both the delete AND the upload are confirmed committed.

E. **Caller-ID identity fragmentation (real compliance/UX risk).** Leads would now see up to THREE numbers from one landlord: the **+1 708-907-0695** property/Telnyx line, the **+1 708-415-8984** personal relay, and a **new 312 Text-Em-All** broadcast number. A STOP to any one of them opts out only *that* system (Text-Em-All enforces its own; the relay uses `SmsOptOut`; they don't sync). → Document the fragmentation prominently; strongly prefer consolidating to ONE outbound identity; at minimum, the dashboard must show which number contacted each lead, and the cross-channel STOP-sync (gap #7 optional) should be reconsidered as REQUIRED before scaling, not optional — three unsynced opt-out surfaces is a genuine TCPA exposure.

F. **The toggle silently changes responsiveness by ~24h.** `relay` texts new leads within the hour they're imported; `textemall` only broadcasts once/day at `broadcast_hour`, so a lead imported at 1pm waits until ~noon tomorrow. → The channel selector UI must state this latency ("Text-Em-All sends once a day at ~12pm; new leads may wait up to a day") so switching channels is an informed choice.

Verified fine on this pass: the per-day claim + empty-batch skip (#11) correctly prevents an empty broadcast; Filter-by-Zapier is free (rev.2 #8); the baseline-scoped CSV (rev.2 #2) keeps the 196 existing leads out.

---

# Tenant-AI → Text-Em-All — Iris CSV Upload + Trigger Options (Plan) — REV. 2 (stress-tested)

**rev. 2 root fixes (verified against the code 2026-08-27):**

1. **CRITICAL — the automation is HOURLY, not a noon daily run.** `zillow-daily` fires cron `0 * * * *` and `runDailyAutomation` claims a per-HOUR slot (`localSlot`, window 8–22). On the Text-Em-All channel that means **delete+upload+broadcast EVERY HOUR** — mass re-broadcasting. Root fix:
   - The Text-Em-All broadcast fires **at most once per LOCAL DAY**, gated by a **per-day `TextEmAllBatch` claim keyed on `localDay`** (NOT the hourly `localSlot`, and NOT "like ZillowAutoRun" which is now hourly). Every hourly tick after the day's batch is `sent` → **no-op**.
   - Add `zillow.textemall_broadcast_hour` (default 12). The Text-Em-All pipeline runs only on the tick whose hour == that value (and only if not already done today). **Do NOT change the shared 8–22 window to noon** — that would break the relay automation. The relay channel keeps running hourly; the Text-Em-All channel self-gates to once/day at its hour.

2. **The Text-Em-All CSV MUST honor the go-live baseline (just built).** "New leads" = leads with **`createdAt >= zillow.auto_baseline`** (import-time boundary), non-opted-out, deduped vs the `TextEmAllBatch` phone history — identical eligibility to the relay path, so the ~196 existing leads are NEVER broadcast and channel-flips don't re-contact. (M1's CSV query reuses the same boundary as `sendSurveyBatch`.)

3. **PII: `.textemall/` MUST be gitignored (M1).** The CSV holds lead names/phones. `.zillow/` is already ignored; `.textemall/` is NOT — add it before writing any CSV, or lead PII lands in git (the exact class of bug we hit with `.zillow/`).

4. **"Google Forms → New Response" is NOT reliably instant on Zapier's FREE tier** — treat it as **poll-delayed (up to ~15 min)**. The plan must NOT depend on instant firing. It's safe anyway because of the **load-bearing invariant: the standing group holds ONLY today's batch from the moment Iris finishes the upload until the broadcast fires** — a 15-min delay is fine as long as the next day's clear doesn't start before this day's broadcast is processed (guaranteed by once/day + the noon hour + the per-day claim). Correct every "INSTANT" claim to "within the trigger's polling interval."

5. **Google-Forms programmatic POST is a SPIKE-GATED assumption, with a mandatory fallback.** A bare `entry.*` POST to `/formResponse` often needs extra fields (`fvv=1`, `pageHistory`, `fbzx`, `partialResponse`) and can be blocked by reCAPTCHA/bot heuristics; the cited technique is from 2019. → **M0 must prove END-TO-END** (real POST → the Zap actually fires → a broadcast is produced), not just "a response row appears." If it doesn't hold reliably, **fall back to B1 (manual send)** — do NOT ship B3 on an unproven POST. B1 manual stays the always-available path.

6. **LIVE-FIRE TEST SAFETY (hard rule — we already leaked real texts once via the relay).** Every gate that could cause a send (the Iris upload, the form POST, any broadcast) runs ONLY with:
   - the standing group containing **exclusively the operator's own number**, and
   - the Send-Broadcast Zap **confirmed active and bound to that group** first.
   Never run a gate with real leads in the group; never POST the trigger form while real contacts are loaded. A mis-timed test = a real broadcast to real people.

7. **Survey-link lives in TWO places (Zap message + tenant-ai config) — a real divergence hazard.** The broadcast's Google-Form URL is static in the Zap; tenant-ai's `sms_relay.google_form_url` is separate. If the user changes the form URL in tenant-ai, the Zap keeps the old link and leads get a dead link. → Add a **startup/pre-broadcast check** that compares tenant-ai's configured `google_form_url` against a `textemall.zap_survey_url` config the operator sets to match the Zap; **refuse to fire (or warn loudly)** on mismatch. Elevate from a footnote to a gate.

8. **Resolved uncertainty: Filter by Zapier IS free/built-in** (unlike Webhooks by Zapier, which is premium). So gap #12's token+Filter lock-down is available on the free plan — implement it; don't fall back to obscurity-only.

9. **Reconsider the primary-path premise (surface, don't hide).** This adds a **fragile, unattended GUI-automation dependency (Iris driving Text-Em-All every day)** on top of a WORKING relay. The reversibility guarantee (§2 ⭐) is the safety net, but daily reliability is a genuine risk. Recommendation: ship **B1 (manual send) first** behind the channel toggle, prove the CSV+Iris-upload half, and only automate the send (B3) once M0's POST spike + a week of manual runs show the GUI path is stable. Don't make the brittle end-to-end auto-send the day-one deliverable.

---

# Tenant-AI → Text-Em-All — Iris CSV Upload + Trigger Options (Plan)

**Goal:** Get new Zillow/SMS leads into a Text-Em-All contact group and send them a survey-link
broadcast, **without paid Zapier, Google service accounts, or the Text-Em-All API tier** — by
(1) having tenant-ai generate a CSV, (2) having **Iris drive the Text-Em-All "Upload File"**
import (the step plain scripting can't do), and (3) firing the broadcast. This plan also
catalogs every free **trigger** we can use to automate the send — including the **Google Forms**
trigger, which tenant-ai can fire with a plain unauthenticated POST.

---

## 0. Investigation findings (verified 2026-08-27)

**Text-Em-All CSV upload** ([support](https://support.text-em-all.com/article/341-uploading-a-file-of-contacts)):
accepts **.csv/.xlsx/.xls**, needs **≥1 valid 10-digit phone** (any common format), and the
importer **auto-detects columns (name/phone/notes) and shows a preview to confirm** — so exact
headers matter little; a clean `First Name, Last Name, Phone` CSV maps itself. Contacts import
**into a group**. ⟲ Because a broadcast texts the whole group AND the Send Broadcast Zap is
permanently bound to ONE fixed group (§2d #4), each day Iris **deletes the old contacts from that
standing group and uploads the new batch** — nobody is re-texted because the group only ever
holds today's leads at broadcast time.

**Iris can do the upload; plain JS cannot.** Browsers block setting a file `<input>` via
JavaScript, so `do JavaScript` can't upload. **Iris Navigate drives the real screen** (Computer
tool: clicks, keys, native dialogs), so it can click Upload File, handle the macOS Open dialog
(reliable trick: **⌘⇧G → type the exact path**), and complete the column-map/preview. This is the
core reason the file lands via Iris, not a script.

**Free Zapier triggers tenant-ai can fire (for automating the SEND):**
- ⭐ **Google Forms → "New Response" — INSTANT and free.** And tenant-ai can submit a Google
  Form with a plain **unauthenticated `POST https://docs.google.com/forms/d/e/<FORM_ID>/formResponse`**
  with `entry.<id>=value` params — **no credentials, no service account, fires the Zap
  instantly.** This is the cleanest programmatic trigger we have.
  ([confirmed technique](https://theconfuzedsourcecode.wordpress.com/2019/11/11/you-may-restfully-submit-to-your-google-forms/))
- **Google Sheets → "New Row"** — free but **~15-min polling**, and tenant-ai writing rows needs
  a **Google service account** (more setup). Fallback, not first choice.
- **Webhooks by Zapier** — instant, but **premium** (paid plan). Excluded.
- Others (Gmail "New Email" via app-sent mail, RSS, Schedule by Zapier) — clunkier; noted only.

**Text-Em-All on Zapier (already tested live):** *Create/Update Contact* action **has a Groups
field** (Option A works); *Send Broadcast* needs Group + Message + Caller ID (**the 312 number**)
+ **Start Date = `now`** (default tries to schedule for 4pm — this bit us). First-broadcast
`AwaitingAutomaticApproval` gate has been cleared; delivery proven.

**Zapier free ceilings:** 100 tasks/month, limited Zap count. Fine at ~10 new leads/day; the CSV
upload path (Iris) sidesteps per-contact task cost entirely — only the *send trigger* (if via
Zapier) costs a task.

---

## 1. Architecture — two independent halves

```
 HALF A: leads → contacts in the group        HALF B: fire the broadcast
 ┌───────────────────────────────┐            ┌────────────────────────────────────┐
 tenant-ai builds CSV  →  Iris deletes         tenant-ai POSTs the TRIGGER form →
 (new, opt-out-filtered,   old contacts &      Zap → broadcast to the standing group
  deduped → fixed path)    uploads new batch    (from the 312 caller ID)
 └───────────────────────────────┘            └────────────────────────────────────┘
     (Iris — GUI only it can do)              (tenant-ai POST, gated on Iris success)
```

Half A must complete before Half B fires (strict ordering, §2d #5). The **primary** build is
Iris-for-A + a **tenant-ai form POST** for B; Zapier only ever sits between the trigger form and
the Send Broadcast action.

⟲ **Two different Google Forms — do not conflate:**
- **SURVEY form** = the rental application the *lead* fills out (the `survey_mode=google_form`
  link inside the broadcast message). One shared URL; applicants type their own phone.
- **TRIGGER form** = the automation signal *tenant-ai* POSTs to fire the Zap
  (`forms.gle/8TsC28c2HCQEnkt46`). No human ever sees it. Its field values are just logging; ANY
  valid response fires the broadcast.

---

## 2. The options matrix (pick one per half)

**Half A — populate the group:**
- **A1 (primary) — Iris uploads the CSV.** One bulk import per batch; no Zapier tasks; GUI-brittle.
- **A2 (fallback) — Zapier Create/Update Contact** per row (sheet/form → contact-in-group).
  Sanctioned + robust, but per-contact Zapier tasks + a way to write the sheet/form.

**Half B — fire the send:**
- **B1 — Manual.** Human clicks Create Broadcast → group → send. Simplest; best compliance gate.
- **B2 — Iris drives the broadcast.** Navigate clicks Create Broadcast → group → send. Unattended
  but a higher-stakes GUI action.
- **B3 (recommended) — tenant-ai POSTs the TRIGGER form → Send Broadcast Zap.** ⟲ The Zap's group
  AND message are **STATIC** (the Zap is bound to the fixed group; the message carries the static
  survey link). The form is only a **go-signal** — tenant-ai POSTs it *after* Iris confirms the
  upload, the instant Zap fires, and the broadcast goes to whatever Iris just put in the group.
  Free, instant, no credentials. tenant-ai — not Iris — submits it, so tenant-ai controls ordering
  and only then marks leads.
- **B4 — Google Sheets row → Send Broadcast Zap.** Same shape, but 15-min poll + service account.

---

## 2c. The end-to-end daily workflow (target)

```
 12:00 noon ─ Zillow automation imports the day's new leads (EXISTING, built)
   │
   ├─ build CSV of NEW · non-opted-out · deduped leads → fixed path
   │   └─ if ZERO new leads → SKIP the rest entirely (no delete, no upload, no broadcast) (§2d #11)
   │
   ├─ tenant-ai → Iris: delete old contacts from the fixed group → verify empty →
   │                    upload the CSV → verify count == N   (Iris returns ok/needs-login/failed)
   │
   ├─ ONLY IF Iris returned ok: tenant-ai POSTs the TRIGGER form → Zap → BROADCAST to that group
   │
   └─ ONLY IF the POST succeeded: mark those ZillowLeads "invited" (sentVia=textemall, batchId)
```

This is a **new, selectable send channel**, NOT a replacement. A dashboard **toggle** picks the
channel per the existing daily automation:

- `zillow.send_channel = relay`  (DEFAULT — the working personal-number Messages relay, unchanged)
- `zillow.send_channel = textemall` (this new CSV → Iris → form → broadcast path)

`runDailyAutomation()` branches on the channel; flipping the toggle switches cleanly and can
always go back to `relay`. Both paths flip lead status and record which channel sent.

### ⭐ Reversibility guarantee (non-negotiable requirement)

**The current personal-number relay path must remain fully intact and be restorable at any time
with one click.** Concretely, the build MUST satisfy all of:
1. **Default = `relay`.** Ship with the channel unset/`relay`; nothing about today's behavior
   changes unless the user explicitly flips the toggle.
2. **Relay code is UNTOUCHED.** The Text-Em-All path is a **new branch alongside** the existing
   `sendSurveyBatch` relay path — the relay code is not modified, refactored, or gated by
   Text-Em-All logic. Adding the feature cannot regress the relay.
3. **The toggle is a single reversible config flip** (`zillow.send_channel`), effective on the
   next run, flippable back to `relay` instantly — no migration, no teardown, no destructive step.
4. **No lost state on switch.** Flipping channels never deletes/alters existing leads, invites,
   ledgers, or opt-outs. `sentVia`/`sentBatchId` only ADD attribution; existing relay rows are
   unchanged.
5. **No double-contact across a switch.** A lead already `invited` (either channel) is never
   re-sent when the channel changes.
6. **Regression-proven.** A gate test re-runs the **relay** path after ALL Text-Em-All code is in
   and asserts it behaves exactly as before (the full suite's existing relay tests must stay green).
7. **Kill switch = the one selector.** Setting `zillow.send_channel` back to `relay` halts the
   entire Text-Em-All/Iris pipeline immediately; the daily run reverts to the relay with no other
   action needed. There is **no second `enabled` flag** to fall out of sync with it (§2d #17).

## 2d. Gaps the workflow exposes — and how this plan closes each  ⟲

These are real mismatches between a per-lead relay and a group broadcast. Each must be handled or
the feature silently misbehaves:

1. **A broadcast can't carry per-lead tokenized links.** The relay sends each lead a unique
   `/survey/<token>` (or a phone-prefilled form). A broadcast is ONE message to the whole group,
   so the link must be **shared**. → On the Text-Em-All channel, the survey link is the
   **Google-Form survey** (`survey_mode=google_form`, a single URL where the applicant types their
   phone) — configured **statically in the Zap's Send Broadcast message**. tenant-ai doesn't set
   the per-send message in the form-trigger model; the message + link live in the Zap.
2. **One property, one message.** A broadcast can't personalize the property per lead. Fine here —
   it's a single property (Ghem LLC 1); the Zap message names it statically.
3. **"Contacted" means SENT-triggered, not delivered.** Submitting the form triggers the Zap; we
   get no delivery receipt back. → Leads flip to `invited` **only after the form is submitted**,
   and the dashboard labels it "sent via Text-Em-All (queued at broadcast)" — never claims
   delivery. (Optional later: a Text-Em-All inbound Zap for real confirmations.)
4. **Clear vs accumulate (remove older contacts).** ⟲ DECIDED (2026-08-27): **the Send Broadcast
   Zap is permanently bound to ONE fixed group** (its Contacts Group is a static dropdown, not a
   mappable field), so we MUST reuse that same standing group. Therefore each day's old contacts
   are **deleted by Iris** before the new upload. Text-Em-All only offers per-contact removal
   (contact → three-dot menu → delete), so the Iris skill loops: **delete every existing contact →
   verify the group is empty → upload the new CSV → verify the new count → then the form**. This
   keeps the Zap untouched (its group never changes), which is the whole point.
   - **Cost:** O(N) deletes/day. Fine at steady state (~10 new leads/day = ~10 deletes). ⟲ The
     exception is a large one-off (e.g. the ~190-lead backlog) — do NOT route a big backlog through
     this path in one run; either keep the backlog on the relay channel or split it over days.
   - **Correctness hinge:** if a delete silently fails, a stale contact stays in the group and gets
     re-texted on the next broadcast → Iris MUST verify the group is empty (count 0) before
     uploading, and the batch fails loudly if it can't reach empty. ⟲ rev.3 D: re-check the count after a short settle so "empty" means COMMITTED-empty (deletes can lag like uploads).
5. **Ordering & partial failure.** Iris can fail at clear, upload, or form. → Strict order:
   clear → upload (verify count) → submit form → THEN mark leads. A failure before the form is
   submitted marks the batch `failed` and flips NO leads; needs-login stops and alerts. Never
   mark contacted on a step that didn't complete.
6. **Idempotency / double-run.** Hourly ticks or a retry must not upload+broadcast twice. →
   One `TextEmAllBatch` per local DAY (unique key on `localDay`, NOT the hourly `ZillowAutoRun` slot — rev. 2 #1); the form is
   submitted once per batch; the batch is stamped `sent` the instant the POST returns (BEFORE flipping leads — rev.3 C) so a failed flip never re-broadcasts; re-runs are no-ops.
7. **Cross-channel opt-out.** A relay STOP is in `SmsOptOut` (filtered out of the CSV, good). But a
   STOP replied to the **312 number** lives only in Text-Em-All. → Text-Em-All enforces its own
   opt-outs at send time, so those people won't get the broadcast even if they're in the CSV.
   Documented; optional later: a Text-Em-All inbound-reply Zap that syncs STOPs back to `SmsOptOut`.
8. **Iris unattended reliability.** Navigate is permission-gated and GUI-brittle. → The daily job
   invokes Iris headless with the right permission flag, treats non-success as a recorded
   `failed`/`needs_login` (never a throw), and the existing Iris/automation supervisor alerts on it.
9. **Status/attribution back in the dashboard.** Broadcast has no per-lead invite row. → Add
   `ZillowLead.sentVia` (`relay|textemall`) + `sentBatchId`; the batch's phone list is the join.
   The Zillow leads tab shows channel + batch date; the milestone "numbers messaged" counts both.
10. **Message compliance.** The broadcast must carry opt-out language. → Text-Em-All auto-handles
    STOP; the Zap message still includes the opt-out line, matching the relay copy.
11. **Empty batch (⟲ stress-test).** If a day has ZERO new leads, the pipeline must **skip
    entirely** — do NOT delete the group's contacts and do NOT POST the form (a broadcast to a
    stale/empty group is wasteful or re-texts yesterday's people). Delete happens only when there
    is a new batch to upload.
12. **Public trigger form = anyone can fire a broadcast (⟲ stress-test).** `forms.gle/...` is a
    public URL; any response fires the Zap → a broadcast to the current group. → Keep the URL
    private (never surface it in the app/UI/logs); add a **secret token field** to the trigger
    form and a **Filter by Zapier** step ("only continue if token == <secret>") so stray/abusive
    submissions don't send. (Confirm Filter is available on the free plan; if not, accept the
    obscure-URL risk and document it.)
13. **Upload-commit race (⟲ stress-test).** The Zap fires instantly on form POST; if Text-Em-All
    is still committing the uploaded contacts, the broadcast could miss some. → Iris's
    "verify count == N" must reflect **committed** contacts before it returns ok; tenant-ai POSTs
    the form only after that. Add a short settle/re-check if the count lags.
14. **Iris needs a GUI session (⟲ stress-test).** Navigate drives the real screen, so the process
    that invokes it must run in the user's logged-in GUI session (as the server does today —
    start.sh launches it in a Terminal, and the existing Zillow osascript Safari drive already
    works from it). If ever launched head-less/launchd without a session, Navigate fails →
    recorded as `failed`, supervisor alerts. Document the session requirement.
15. **Final Zap topology (⟲ stress-test).** Exactly ONE Zap is active for this path:
    **Trigger form → New Response → Send Broadcast (static group + message)**. The earlier
    experimental Zaps (Sheet→Send Broadcast, Sheet→Create/Update Contact) must be **turned OFF** —
    Iris does the contact upload, so the Create-Contact Zap is unused, and a second Send-Broadcast
    trigger would double-send.
16. **Approval hold ≠ delivered (⟲ stress-test).** Even after the first-broadcast clearance,
    Text-Em-All may hold a later broadcast for review; tenant-ai (which only POSTed the form)
    can't see that. → Same honesty rule as #3: "invited" means *submitted*, dashboard says
    "queued via Text-Em-All", never "delivered".
17. **One switch, not two (⟲ stress-test).** The kill switch is the single `zillow.send_channel`
    selector; `relay` = Text-Em-All fully off. Do NOT add a separate `textemall.enabled` that can
    disagree with the channel. The survey link in the Zap message must equal tenant-ai's configured
    `google_form` survey URL (maintained in both places — document the coupling).

---

## 3. Milestones

### M0 — Recon + spikes (before build)
- [x] **Group-rotation recon + decision (2026-08-27):** Zap is bound to ONE fixed group; delete is
      per-contact only. → **standing group, Iris deletes old contacts each day, then uploads**
      (gap #4). Still to confirm in M0: the exact per-contact delete click-path and how Iris reads
      the group's contact **count** (to verify empty-before-upload and full-after-upload).
- [ ] **Upload-flow recon:** click Text-Em-All **Upload File** once; capture the exact steps
      (file dialog → column-map/preview screen → group选择/confirm) so the Iris goal is precise.
      Note the exact column headers that auto-map cleanly.
- [ ] **Iris file-picker spike:** a throwaway Navigate goal that opens a native Open dialog and
      selects a known file via ⌘⇧G + path. Confirms the make-or-break capability. ⟲ Gates M2.
- [ ] **Google Form + entry IDs (if pursuing B3):** create the trigger form (fields: `group`,
      `message`, `token`), extract each field's `entry.<id>` (from the prefilled-link URL), and
      confirm a hand `curl` POST to `/formResponse` registers a response.
- **Gate:** upload steps written down; Iris selected a file in a spike; (if B3) a curl POST shows
      up as a form response.

### M1 — CSV generator in tenant-ai (foundation)
- [ ] Add `.textemall/` to `.gitignore` FIRST (PII, rev. 2 #3). `services/textemall-csv.ts` + endpoint/button: export **leads with `createdAt >= auto_baseline`, non-`SmsOptOut`, deduped** (same eligibility as the relay path, rev. 2 #2)
      leads (Zillow + SMS) as a CSV to a **fixed path** (`~/tenant-ai/.textemall/leads-<date>.csv`)
      AND offer a browser download. Columns: `First Name, Last Name, Phone` (auto-map friendly).
- [ ] `TextEmAllBatch` ledger (migration): batchId, group name (dated), phone list, status
      (built | uploaded | sent), counts, createdAt — the dedupe + "who was pushed" record.
- [ ] Tests: opt-out filter, dedupe vs ledger, phone formatting, empty-batch no-op, fixed-path write.
- **Gate:** unit + full suite green; a real CSV of current new leads is produced at the path.

### M2 — Iris upload skill (Half A1) — delete-then-upload into the FIXED group
- [ ] An Iris skill / Navigate goal against the **standing group the Zap is bound to**:
      1. open that group; **delete every existing contact** (contact → three-dot → delete), looping
         until the count is **0**;
      2. **verify empty** (count 0) — if it can't reach 0, stop + fail (never upload onto stale
         contacts, gap #4 correctness hinge);
      3. click **Upload File**, choose `<csv path>` (⌘⇧G), accept the column-map/preview, finish;
      4. **verify the new count == N**;
      5. if logged out at any step, stop and report **needs-login** (no credential attempts).
- [ ] Reuses Iris observe→act→verify + needs-login discipline (like the Zillow drive). Guard the
      delete loop with a max-iterations cap so a mis-read never loops forever.
- [ ] tenant-ai → Iris invocation (headless `iris -p "<goal>"`, permission-flagged) that passes
      the CSV path + group name and returns success/needs-login/failed.
- **Gate:** from a generated CSV, Iris **empties the standing group (count 0), then uploads** so
      it shows exactly the right contacts (count == N). (Live, with the operator's number as the
      only lead.)

### M3 — Send trigger (Half B — build the chosen one; wire B3 as the automation default)

> **Trigger form resolved 2026-08-27** (`https://forms.gle/8TsC28c2HCQEnkt46`):
> - formResponse endpoint: `https://docs.google.com/forms/d/e/1FAIpQLSf_zipLyMeJl0oZp3e1hq7XbTuPv-Zllqto9wKIqCo-XWqCeA/formResponse`
> - fields: `entry.599472758` = "batch ready?", `entry.1082952004` = "date of send" (⟲ DATE type →
>   needs `_year/_month/_day` sub-fields on POST, or change the question to short-answer text),
>   `entry.1156702036` = "numbers messaged".
> - Trigger form carries STATUS only (no group/message). The Send Broadcast Zap's Contacts Group +
>   Message are **STATIC** (bound group + the static survey link). The form is a **go-signal**; any
>   valid response fires it (see §2d #12 for locking it down).
> - NOT yet live-tested (a POST could fire a real broadcast if the Zap is active — confirm Zap state first).
- [ ] **Decision:** **B3 tenant-ai form POST**, gated on Iris upload success (recommended); **B1
      manual** always available as the compliance fallback.
- [ ] Configure the **Send Broadcast Zap**: Trigger = the **trigger form** New Response; Action =
      Send Broadcast with **static** Contacts Group (the bound group), **static** Message (naming
      Ghem LLC 1 + the `google_form` survey link + opt-out line), Caller ID = 312,
      **Start Date = `now`**. Add a **token field + Filter by Zapier** so only tenant-ai's POST
      proceeds (§2d #12).
- [ ] `services/textemall-trigger.ts`: POST to the trigger form's `/formResponse` with the
      `entry.*` values (incl. the secret token; handle the DATE field's `_year/_month/_day` or make
      it short-answer). Trigger URL + entry map + token in **encrypted config**. Never log the URL/token.
- [ ] Turn OFF the earlier experimental Zaps (Sheet→Broadcast, Sheet→Create Contact) (§2d #15).
- [ ] Tests: POST body builds the right `entry.*`; refuses to POST unless caller passes Iris-ok;
      never POSTs on empty batch.
- **Gate:** a batch uploaded in M2 gets a broadcast **sent to the operator's phone** via the form
      POST; a POST without the secret token does NOT send; opted-out numbers never appear.

### M4 — Dual-channel toggle + lead attribution (the "choose a path" milestone)
- [ ] Config `zillow.send_channel` = `relay` (default) | `textemall` (encrypted; dashboard-set).
      `runDailyAutomation()` branches on it: `relay` → existing `sendSurveyBatch` (unchanged);
      `textemall` → the new pipeline (§2c). Flipping back to `relay` is always safe.
- [ ] Migration: `ZillowLead.sentVia` (`relay|textemall`) + `sentBatchId`; on the Text-Em-All
      channel, leads flip to `invited` **only after the form is submitted** (gap #3/#5), keyed to
      the batch's phone list. Already-invited leads are never re-sent when the channel flips.
- [ ] Force the Text-Em-All channel onto `survey_mode=google_form` (gap #1) so the broadcast's
      single shared link is valid; guard against selecting `textemall` while survey_mode is hosted.
- [ ] Tests: channel branch (relay vs textemall), status flip only-after-send, no re-send on
      toggle flip, survey-mode guard, per-day batch idempotence.
- **Gate (reversibility, explicit):** (1) default channel `relay` → behavior identical to today;
      (2) flip to `textemall` → §2c pipeline runs; (3) flip BACK to `relay` mid-stream → the very
      next run uses the personal-number relay again, no double-contact, no residue; (4) the full
      suite's existing relay tests stay green with all Text-Em-All code present (proves no regression).

### M5 — Orchestration + dashboard control
- [ ] Wire the §2c pipeline to fire ONCE/DAY at `textemall_broadcast_hour` (default 12) via the per-day `TextEmAllBatch` claim — the hourly tick no-ops otherwise; do NOT retarget the shared 8–22 relay window (rev. 2 #1):
      import → build CSV (skip if 0 new, §2d #11) → Iris **delete+upload** the standing group →
      **tenant-ai POSTs the trigger form** (only after Iris ok) → flip leads → all logged in
      `TextEmAllBatch` (status: built|uploaded|sent|failed, counts, error). Strict ordering +
      needs-login/failed handling per gap #5/#8; supervisor alerts on failure.
- [ ] Dashboard: a **send-channel toggle** in the Zillow Automation panel
      (`Personal number (relay)` ⇄ `Text-Em-All`), a Text-Em-All batch history (built/uploaded/
      sent + counts, honest "queued not delivered" wording), a "run now" for the Text-Em-All
      pipeline, and a needs-login banner. Milestone "numbers messaged" counts both channels.
- [ ] (Optional) tenant-ai POSTs the batch count back into the form's `entry.1156702036`
      ("Numbers messaged") for the tracking sheet.
- **Gate:** end-to-end from the dashboard with channel=textemall: noon import → Iris clear+upload
      → form submit → broadcast delivered (operator phone as the only lead) → dashboard shows
      contacted; then toggle to relay and confirm the old path still works untouched.

### M6 — Stress + handoff
- [ ] Full suite + build; feature ships with channel defaulting to **relay** (existing path
      untouched); docs (`docs/textemall.md`): the toggle, the noon pipeline, group-clear rule,
      Start-Date=now, the 312 caller ID, google-form survey requirement, needs-login recovery,
      cross-channel opt-out caveat, and how to fall back to the relay.

---

## 4. Trigger appendix (the comprehensive comparison you asked for)

| Trigger (tenant-ai → Zapier) | Instant? | Free? | What tenant-ai does | Setup cost | Verdict |
|---|---|---|---|---|---|
| **Google Forms — New Response** | **Yes** | **Yes** | POST to `/formResponse` (`entry.*`), no auth | make a form, grab entry IDs | ⭐ **best** |
| Google Sheets — New Row | No (~15 min) | Yes | write a row via Sheets API | Google **service account** + share sheet | fallback |
| Webhooks by Zapier — Catch Hook | Yes | **No (premium)** | POST JSON | paid Zapier | excluded |
| Gmail — New Email | ~1–15 min | Yes | send an email from the app | email plumbing | clunky |
| Schedule by Zapier | n/a (time-based) | Yes | nothing (just time) | — | only for fixed cadence |

**Recommendation:** use **Google Forms POST** as the automation trigger (instant, free, no
credentials); keep **manual send** as the always-available compliance gate; treat **Google
Sheets** as the documented fallback if the Forms `entry.*` technique ever breaks. The Iris upload
(Half A1) needs **no trigger at all** — it's driven directly by tenant-ai calling Iris.

---

## 5. Risks
| Risk | Mitigation |
|---|---|
| Iris GUI upload brittle (Text-Em-All redesign) | observe→verify + contact-count check; needs-login stop; recon kept for re-mapping; manual upload always works |
| Native file picker hard to drive | ⌘⇧G + fixed CSV path (spiked in M0 before committing) |
| Column mapping mismatch | CSV uses auto-map-friendly headers; Iris confirms the preview |
| Broadcast can't do per-lead tokens | Text-Em-All channel forced to `survey_mode=google_form` (shared link); guard blocks hosted mode (gap #1) |
| "Contacted" claimed without delivery | leads flip only after form submit; UI says "queued at broadcast", never "delivered" (gap #3) |
| Iris partial failure marks leads wrongly | strict order clear→upload→verify→submit→THEN flip; failure flips no leads (gap #5) |
| Double upload/broadcast on retry | one `TextEmAllBatch` per day, claimed; form submitted once (gap #6) |
| STOP to the 312 number not in tenant-ai | Text-Em-All enforces its own opt-out at send; optional inbound-reply sync (gap #7) |
| Stale contact survives delete → re-texted | Iris verifies group count == 0 BEFORE upload; batch fails loudly if not empty (gap #4) |
| O(N) per-contact deletes slow/brittle | steady state ~10/day is fine; NEVER route a big backlog through this path in one run (keep backlog on relay or split over days) |
| Delete loop runs forever on a mis-read | max-iterations cap on the delete loop; fail if count won't reach 0 |
| Switching channels double-contacts a lead | `sentVia`/`sentBatchId` + already-invited leads never re-sent (gap #9) |
| Existing relay path regressed by the new path | channel defaults to `relay`; textemall is additive + behind the toggle; M4 gate re-verifies relay |
| Public trigger form fires stray broadcasts | secret token field + Filter by Zapier; URL never surfaced/logged (§2d #12) |
| Broadcast fires before contacts commit | Iris verifies committed count == N before returning ok; tenant-ai POSTs only then (§2d #13) |
| Empty-batch day wastes a send / re-texts | 0 new leads → whole pipeline skipped, no delete/POST (§2d #11) |
| Two Send-Broadcast triggers → double send | exactly one active Zap; old experimental Zaps turned off (§2d #15) |
| Iris invoked without a GUI session | server runs in the logged-in session (as today); failure recorded + alerted (§2d #14) |
| Trigger-form `entry.*` IDs change | rare; stored in config, re-grabbable in minutes |
| Sending to an opted-out number | `SmsOptOut` filter before the CSV is ever written |
| Text-Em-All holds a broadcast for approval | first send cleared; support releases new-account holds |
| Zapier task/Zap limits | Iris upload avoids per-contact tasks; only the send trigger costs 1 task |
| Auto-send stakes (B2 Iris clicking Send) | prefer B3 (form→Zap) or B1 manual for the actual send |

## 6. Out of scope
- Text-Em-All official API (50k/mo tier).
- Fully auto-uploading without Iris (JS can't touch the file picker).
- Cap-raising / opt-out bypass.
