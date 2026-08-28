# Plan: toggleable "Individual Text-Em-All relay" for inbound callers/texters

> **BUILD STATUS — M1–M5 built + green (76 tests), NOT toggled/deployed (2026-08-28).**
> Core done: individual-trigger, individual-iris (Add-Contact, not CSV), fire-ledger
> (shared atomic cap), individual-relay job (R1 truth table: fire OR guaranteed relay
> fallback; opt-out; cooldown; count==1 gate; idempotent), call-path + text-path wiring
> (inert when off), toggle API route. Ships **disarmed + channel OFF** — relay is the
> active default and the running server is UNCHANGED (new dist compiled, not restarted).
> Remaining: a dashboard toggle BUTTON (route exists; togglable via API/set-config) + M6
> live arming (user-initiated). Three stress passes; 24 findings; R1 (relay universal
> fallback) fixed the one structural defect.

## Goal
Add a **dashboard toggle** so that when someone **calls or texts** the Twilio number,
the application link is delivered to that individual by pushing **their phone number**
to a **new Google Form → Zapier → Text-Em-All** trigger, instead of the current
Messages.app relay. The existing relay stays the default and must keep working
untouched. **No live test** in this plan (protect the running relay) — build + unit-test
with the trigger in dry-run/disarmed state only.

## The new pieces the user is providing
- **New Google Form** "Leads Individual Call Message Trigger"
  `https://docs.google.com/forms/d/e/1FAIpQLSeTYGdVluEia7E9-nc9O8NxC3xI2q49WpF4_cbZm9EwaSmyyA/…`
  Fields (fetched):
  - `entry.766759466` — **the phone number** (short text)
  - `entry.2069978510` — "ready?" multiple-choice → must send exactly **"Yes"**
- **New Text-Em-All group** "2. leads 08-28-2026" — **dedicated to the individual
  caller/text relay** and distinct from the Zillow batch group "1. Leads 08/27/2026".
  (⟲ confirm the EXACT group name/casing in Text-Em-All, since Iris matches it literally.)
- **Design confirmed by user:** Iris edits "2. leads 08-28-2026" (remove the old number,
  add the new caller), then submits the form; the Zap **broadcasts to that group**. So the
  recipient IS the group Iris just set to the one caller — the clear+verify model (not the
  form-phone model). The form's phone field is sent for the Zap's reference/records.
- **New Zapier workflow** (user builds): New form response → message that phone.

**Per-call group editing (confirmed):** for each inbound call/text, tenant-ai updates the
Text-Em-All group **"2. leads 08-28-2026"** so it holds the caller's number, THEN fires the
trigger; the Zap broadcasts to that group. Because a group broadcast hits every contact in
the group, each call **sets the group to just that one number** (clear + add) via an Iris
GUI step — reusing the same `irisUploadToGroup` machinery (and the raised turn cap) as the
Zillow path, but with a **1-number** CSV. This step MUST be **async / queued** (never in
the inbound webhook response) and **GUI-locked** (serialized with the Zillow scrape and
other inbound edits). See §Concurrency.

## Current inbound flow (grounding)
- **Call** → `services/caller-link.ts:42` → `relaySendWithGuards(text, phone, {kind:"caller", inviteId})` (Messages.app).
- **Call, AI-triggered** → `handlers/call-handler.ts:131` `text_application_link` tool.
- **Text** → `handlers/sms-handler.ts` / `intake-qa.ts` / `survey-intake.ts` return a
  reply with `replyKind: "link" | "ai"`, delivered over the relay.
- Guards/caps/cooldown live in `services/relay-guards.ts`.

## Design
A new **delivery-channel toggle for the individual link**, parallel to the existing
`zillow.send_channel` pattern but for inbound callers/texters:

- **Config `sms_relay.individual_channel`** = `"relay"` (default) | `"textemall"`.
- **New `services/individual-trigger.ts`** — `fireIndividualTrigger(phone, {dryRun})`:
  POSTs `entry.766759466=<phone>` + `entry.2069978510=Yes` (+ `fvv=1&pageHistory=0&submit=Submit`)
  to the new form's `/formResponse`. Same **two-key safety** as the Zillow trigger: live
  POST only when `dryRun:false` AND config `textemall.individual_trigger_armed==="true"`.
  Endpoint + entry IDs are config-overridable with the fetched values as defaults.
- **New job `jobs/individual-relay.ts`** — enqueued per inbound (phone + inviteId). The
  worker, under `withGuiLock`: (1) writes a 1-row CSV of the caller's number, (2)
  `irisUploadToGroup` to set "2. leads 08-28-2026" to just that number (clear + add), (3) on
  `ok`, `fireIndividualTrigger(phone)`. Strict order = group updated → verified → fire, so
  a failed edit never fires. BullMQ concurrency=1 already serializes these; the GUI lock
  also guards against the Zillow scrape running concurrently.
- **Wiring:** at each inbound link-delivery point, branch on `individual_channel`:
  - `"relay"` → existing `relaySendWithGuards` (unchanged).
  - `"textemall"` → **enqueue** the individual-relay job with the caller's number and skip
    the relay link-send. The webhook returns immediately; the Iris edit + fire happen in
    the background (link arrives a couple minutes later).
- **What the toggle does NOT change:** the AI **Q&A conversation** (intake `link_and_qa`)
  still runs over the relay — Text-Em-All can't hold a back-and-forth. Only the **link
  delivery** switches channel. (Decision A confirms this.)
- **De-dupe:** reuse the per-phone link cooldown concept so repeat callers don't re-fire
  the form every time (config `textemall.individual_cooldown_min`, default = the relay's).

## Milestones (each ends with a green gate; NO live send)

### M0 — Confirm scope + investigate the Text-Em-All Zapier action (no code)
- Decisions are LOCKED (below).
- **R2 investigation:** determine which Text-Em-All Zapier action the Zap will use —
  **send-to-phone-number** (from the form field → race-free, recommended) vs
  **broadcast-to-group** (needs the confirm-before-reuse gate). Lock the send mechanism and
  whether the settle is a floor (send-to-number) or a confirmation gate (group-broadcast).
- Confirm `2. leads 08-28-2026` exists in Text-Em-All and Safari is logged in (R7).

### M1 — Trigger service + single-number Iris goal + config
- `services/individual-trigger.ts`: `buildIndividualBody`, `fireIndividualTrigger`,
  `loadIndividualTriggerConfig` (endpoint/entry defaults from the fetched form).
- `services/individual-iris.ts`: `irisSetGroupToNumber(group, phone)` (R3) — the lighter
  **Add-Contact** goal (open group → clear → Add Contact → type number → verify count==1),
  reusing `withGuiLock` + the raised turn cap + the resilient `RESULT:` parser; NO file
  picker. Injectable `run` for tests.
- Config keys: `sms_relay.individual_channel`, `textemall.individual_trigger_armed`,
  `textemall.individual_trigger_endpoint`, `…entry_phone`, `…entry_ready`,
  `textemall.individual_group` ("2. leads 08-28-2026"), `textemall.individual_cooldown_min`,
  `textemall.individual_settle_sec`, `textemall.individual_test_numbers` (whitelist, R1),
  and the **shared** `textemall.monthly_fire_cap` ledger (R5).
- **Gate (unit tests):** body has phone + "Yes" + submit params; live POST only when
  dryRun:false AND armed; disarmed → `{fired:false, reason}`, no network; phone normalized;
  `parseIrisResult` count==1 handling for the Add-Contact goal.

### M2a — Shared monthly fire ledger (R5)
- One atomic check-and-increment used by BOTH the Zillow batch and the individual path;
  folds in Zillow's existing `monthly_fire_cap`. At/over 100 → callers relay-fallback (R1),
  Zillow skips (as today).
- **Gate:** concurrent fires can't exceed the cap (transactional); month rollover resets.

### M2 — Per-call group-update job (Iris) + fire, with guaranteed relay fallback
- `jobs/individual-relay.ts`: enqueue({phone, inviteId, eventId}) with `jobId=eventId` (R6).
  Worker under `withGuiLock`:
  1. Pre-checks (no Iris yet): opted-out (F12) / not-armed / not-whitelisted (R1) / cooldown
     (R6) / **shared cap** at limit (R5) → **do NOT fire; deliver via RELAY** (R1) and return.
  2. `irisSetGroupToNumber("2. leads 08-28-2026", phone)` (R3 — Add-Contact, NOT CSV import):
     open group → clear → Add Contact → type number → **verify count==1**. On
     needs_login/failed/count≠1 → **relay fallback** (R1), NOT fired.
  3. On verified count==1: **atomically check+increment the shared fire ledger** (R5), then
     `fireIndividualTrigger(phone)`, write **fired-at BEFORE ack** (R6 idempotency,
     `maxRetries:0`), mark SMS-leads "sent (unconfirmed)" (R4). Then release after the
     settle **gate** (R2: confirmation if group-broadcast, else the `individual_settle_sec`
     floor, default ~30).
- **The relay is the universal backstop:** every non-fire path delivers the link via relay,
  so the caller always gets exactly one link (R1 truth table).
- **Gate (mocked Iris/trigger/relay, NO live send):** each truth-table row routes correctly
  (fire vs relay-fallback); fire only on verified count==1; retry with same jobId does not
  re-fire; call-then-text de-duped; cap-at-limit → relay; opted-out → neither fires nor
  relays a marketing link (respect STOP).

### M3 — Wire the CALL path (relay is the fallback, not skipped blindly)
- In `caller-link.ts`, when `individual_channel==="textemall"`: **enqueue** the individual-
  relay job (which itself decides fire-vs-relay per the R1 truth table) and DON'T also
  relay-send here — the job owns delivery (fire OR relay-fallback), guaranteeing exactly one
  link. Preserve inviteId/"called" origin. `channel==="relay"` path byte-identical.
- **Gate:** channel=relay → relaySendWithGuards here, no enqueue; channel=textemall → job
  enqueued (no double send); webhook returns promptly (no synchronous Iris); a job that
  can't fire results in exactly one relay send.

### M4 — Wire the TEXT path + strip the link from the relay reply (F4)
- At the text link-delivery point(s) (`sms-handler`/`survey-intake`), same enqueue. **The AI
  greeting/Q&A reply over the relay must OMIT the application link** when
  `individual_channel==="textemall"` (F4) — the link comes only from the job (Text-Em-All or
  its relay fallback), never twice. AI Q&A conversation still flows over the relay.
- **Gate:** channel=textemall → relay reply has NO link, job enqueued; Q&A replies still
  relay; channel=relay → reply includes the link as today (unchanged).

### M5 — Dashboard toggle + arming + test-whitelist
- One-click toggle "Deliver caller/texter link via Text-Em-All" ↔ relay
  (`sms_relay.individual_channel`), plus **Arm** control (`individual_trigger_armed`) and a
  **test-numbers** field (`individual_test_numbers`, R1/F17). Refuse enabling "textemall"
  unless endpoint+group configured. Show the effective state ("armed; testing to N numbers;
  others → relay").
- **Gate:** toggling flips config; UI shows the R1 state; refuses enable if unconfigured;
  arming without a whitelist warns "goes live for ALL callers".

### M6 — Stress test + safety (still NO live send)
- Reversibility: toggle back to relay → the current system is byte-identical.
- Safety: `individual_trigger_armed` ships **false** → even with channel=textemall, every
  fire is a dry-run until the user arms it AND has verified the Zap. Log a clear
  "would-fire (dry-run)" line so the path is observable without sending.
- Opt-out + cooldown honored on the textemall path too.
- Full suite green, `tsc` clean. Live arming + a real 1-number test is a SEPARATE,
  user-initiated step (out of this plan).

## Decisions — ALL LOCKED (2026-08-28)
- **A. Channel semantics — YES:** the toggle **replaces** the relay link-send with the
  queued group-edit + trigger (not both).
- **B. Group handling — YES, per-call editing:** each inbound sets "2. leads 08-28-2026" to
  the caller's number (clear old + add new, verify count==1) via Iris, then fires; the Zap
  broadcasts to that group.
- **C. Q&A scope — YES:** in `link_and_qa`, only the **link** switches to Text-Em-All; the
  AI Q&A stays on the relay.
- **D. Dedupe — YES:** per-phone cooldown on the textemall path (default = relay's).
- **1. Zap trigger — INSTANT:** the user will use an instant trigger (Apps Script on-submit
  → Catch Hook / instant Google-Forms trigger), NOT polling. **This resolves F9 and F10** —
  each response is processed immediately, the group is correct at broadcast time, and
  `individual_settle_min` shrinks to a small safety gap (default **~30s**, just enough for
  the instant Zap to consume the response before the next caller re-points the group).
  Throughput is no longer 15-min-paced.
- **2. Group name:** exactly **`2. leads 08-28-2026`** (Iris matches literally).
- **3. Compliance:** user OK routing caller replies through Text-Em-All; message copy
  includes "Ghem Properties" + purpose; opt-outs honored (F12).
- **4. Zapier budget:** stay on the **free 100-task/month tier** with a **combined cap**
  across Zillow + individual paths → **relay fallback** when near the cap (no paid tier).

## Concurrency & latency (from per-call group editing)
- **Serialized:** the Iris group-edit is GUI-locked and the BullMQ queue is concurrency=1,
  so simultaneous callers are handled **one at a time** — correct (the group must hold
  exactly one number at fire time), but bursts queue up.
- **Latency:** each edit is an Iris GUI drive (~1–2 min). The caller/texter receives the
  link a couple minutes after contact, not instantly. Acceptable for an application link;
  documented, not "fixed."
- **Throughput ceiling:** at ~2 min/call this path handles ~20–30 calls/hour. If inbound
  volume ever exceeds that the queue backs up — flag for the user; the relay path has no
  such limit, so high-volume periods may warrant staying on relay.
- **Contention with Zillow:** the 3×/day Zillow scrape/upload shares the GUI lock, so an
  inbound edit may wait behind a Zillow run (and vice-versa). Bounded by the lock; noted.

## Stress points / risks
1. **Double-delivery** if both relay and the job fire — the branch must be exclusive (M3/M4).
2. **Unarmed safety:** ships disarmed; channel can be on while every fire is a dry-run, so
   the path is testable without messaging anyone. Matches the relay-leak safety rule.
3. **Group-edit failure:** if Iris fails to set the group (needs_login/turns), the job does
   NOT fire — the caller simply doesn't get the Text-Em-All link that round (no wrong-number
   broadcast). Consider a fallback to relay on repeated failure (M6 decision).
4. **Wrong-number broadcast:** the group MUST end holding only the caller's number before
   firing (clear + add + verify count==1). A stale contact left in the group would get the
   broadcast — the verify-count gate prevents firing on a bad edit.
5. **Public form endpoint** (like the Zillow one) — guard with the armed flag + optionally a
   Zapier Filter token later.
6. **SMS-leads tab origin:** keep the inviteId/"called" wiring so the dashboard still shows
   who called/texted and got the link, regardless of channel.
7. **Relay stays default & untouched** — verified in M6 reversibility.

## Stress test — pass 1: findings & root fixes

### 🔴 F1 (CRITICAL, ACCEPTED w/ mitigation) — group-broadcast is order-sensitive.
Design is confirmed group-broadcast: Iris sets "2. leads 08-28-2026" to just the caller,
fires the form, the Zap broadcasts to that group. The risk: the form-fire and the Zap's
broadcast are **decoupled in time** (the Zap reads group contents when IT runs, up to ~15
min later — see F2). If Job B clears+sets the group to {B} **before** the Zap has
broadcast Job A's {A}, the Zap broadcasts {B}: **A misses the link, B gets it twice.**
- **Root fix (serialize + settle-hold):** the job must NOT release the group for the next
  caller until Job A's broadcast has actually gone out. Since there's no broadcast-done
  signal from Text-Em-All, hold the queue after each fire for a **`individual_settle_min`**
  window (default = the Zap's poll interval, ~15 min) before the next job edits the group.
  BullMQ concurrency=1 + this hold guarantees one caller is fully broadcast before the group
  is re-pointed. **Cost:** throughput ≈ 1 caller / settle-window (≈ 4/hour at 15 min). For
  low inbound volume this is fine; for bursts, callers queue (and beyond a backlog cap, F3's
  relay fallback kicks in).
- **Contained blast radius:** the individual group is **separate** from the Zillow group, so
  this race only ever involves individual-relay calls, never the Zillow batch.
- **Alternative to eliminate the race entirely (offer, not required):** if your Zap instead
  sent to the **form's phone field** rather than the group, the settle-hold + clear + count
  gate could all be dropped and throughput would be unbounded. Left as your call; the plan
  builds the group-broadcast version you specified.

### 🔴 F2 (CRITICAL) — Zapier free-tier polling latency ≈ up to 15 min.
"New form response" polls on a schedule (up to 15 min on free tiers). So the link reaches
the caller **many minutes** after they call — and F1's race window is that entire interval.
- **Root fix:** (a) F1's form-phone-recipient model removes the race regardless of latency;
  (b) set expectations — this path is **not** near-instant; if you need prompt delivery,
  the relay stays the better channel. Document the latency; don't pretend it's ~2 min.

### 🔴 F3 (CRITICAL) — Shared Zapier task budget with the Zillow path.
The Zillow 3×/day path already consumes ~90 of the 100 free-tier tasks/month. **Every
inbound call/text on this path spends another task** on the same Zapier account → the
combined total blows past 100 almost immediately.
- **Root fix:** track a **combined monthly Zapier-task budget** across both paths (extend
  the existing `monthly_fire_cap` to count individual fires too, or a shared counter);
  when near the cap, this path **auto-falls-back to relay** and logs it. ⟲ **Decision:**
  raise Zapier to a paid tier, or accept that heavy call volume forces relay fallback.

### 🟠 F4 — Link double-delivery via the relay AI reply.
Today the intake/greeting reply (`intake-qa.ts`) **appends the application link** to the
relay SMS. If the link is now supposed to come from Text-Em-All, the relay reply would
**also** send it → the caller gets it twice (and the toggle's intent is defeated).
- **Root fix:** when `individual_channel==="textemall"`, the relay AI/greeting reply MUST
  **omit the link** (deliver conversation only); the link comes solely via the queued
  Text-Em-All path. Add to M4 with an explicit test.

### 🟠 F5 — Job retry / restart double-fire.
A BullMQ retry (or a server restart mid-job — frequent during ops) could re-run the edit +
**re-fire** → duplicate broadcast/task.
- **Root fix:** the job is **idempotent** — record a per-phone "fired at" (or a job-level
  fired flag) BEFORE the fire is considered done; on retry, if already fired within the
  cooldown, skip. `maxRetries: 0` for the fire step (mirror the Zillow job's no-retry).

### 🟠 F6 — Dedupe must cover queued jobs and call+text.
Cooldown keyed only on *last fire* misses a number that has a job **still queued** (not yet
fired), and misses the **call-then-text** (or text-then-call) double from the same person.
- **Root fix:** on enqueue, skip if a job for that phone is already **pending/running** OR
  fired within the cooldown. One delivery per phone per cooldown window across both triggers.

### 🟠 F7 — GUI-lock contention with the Zillow run.
The per-call Iris edit (~2 min) and the 3×/day Zillow scrape/upload share one GUI lock, so
they take turns. Two clarifications that keep this bounded:
- The **settle-hold (F1) MUST release the GUI lock** while it waits — it's a per-individual-
  group queue delay, NOT a lock hold. Holding the lock 15 min would freeze Zillow. So during
  a settle window the lock is free for a Zillow run.
- Zillow edits a **different group** ("1. Leads 08/27/2026"), so a Zillow run overlapping an
  individual settle window is harmless (it never touches "2. leads 08-28-2026").
- **Root fix:** only the ~2-min Iris edit holds the lock; give the scheduled Zillow run
  priority when both are waiting (inbound edits yield), and bound the lock wait. Document the
  shared-GUI ceiling.

### 🟡 F8 — No-caller-ID / unroutable number.
Blocked/unknown caller ID or an un-normalizable number → can't fire.
- **Root fix:** skip the textemall path and **fall back to relay** (or no-op) for that
  contact; never fire with an empty/garbage phone.

### Net effect on the plan (confirmed group-broadcast design)
M2's job = **GUI-locked**: write 1-row CSV of the caller → `irisUploadToGroup("2. leads
08-28-2026", 1)` clearing old + adding the new number, **verify count==1** → fire the form
→ **hold the queue for `individual_settle_min`** (F1) before the next caller's job runs.
The **count==1 verify gate** (F1/risk-4) means a bad edit never fires. The **separate group**
keeps this fully isolated from Zillow. Reuses the raised Iris turn cap. Throughput is
deliberately low (F1/F2) — this path trades speed for the group-broadcast model; the relay
stays the fast/high-volume channel and the default.

## Stress test — pass 2: findings & root fixes

### 🔴 F9 (CRITICAL) — the settle-hold is best-effort, not a correctness guarantee.
The hold assumes the Zap polls **once** and broadcasts the current group between one fire
and the next. But tenant-ai can't see Zapier's poll clock or know if a poll **batches
multiple new responses** — if two responses land in one poll while the group only holds the
last edit, both broadcasts go to the last number. The settle-hold *reduces* this; it can't
*guarantee* it, because the recipient (mutable group) is decoupled from the response.
- **Root fix (honest):** set `individual_settle_min` **≥ 2× the Zap poll interval** so a
  fire and its broadcast never share a poll with the next fire; AND recommend the user put
  the Zap on an **instant trigger** (Google Apps Script "on form submit" → Zap Catch Hook,
  or a paid instant Google-Forms trigger) — then each response is processed immediately and
  the group is correct at broadcast time, and settle can shrink to seconds. The only *fully*
  race-free design remains the form-phone recipient (F1 alternative). ⟲ **Decision:** instant
  Zap trigger (recommended) vs. long conservative settle on polling.

### 🔴 F10 (CRITICAL) — every DIFFERENT caller is paced ≥ settle apart, not just bursts.
The settle-hold is global, so caller B (a different person) waits the full settle window
behind caller A even at low volume. At a 15-min poll that's **up to 15 min before B's link
goes out**. This is a real UX degradation the relay doesn't have.
- **Root fix:** make this a conscious, documented ceiling; surface a dashboard note ("Text-
  Em-All individual delivery is paced ~1/`settle` — high call volume should stay on relay");
  keep the near-cap/backlog **relay fallback (F3)** so waiting callers spill to the instant
  relay instead of sitting in a 15-min queue.

### 🔴 F11 (COMPLIANCE) — automated broadcast to a caller ≠ person-to-person relay.
The relay sends person-to-person iMessage/SMS; Text-Em-All is an **automated A2P broadcast**
platform with its own consent/opt-in rules, and automated texts carry TCPA implications a
manual reply doesn't. Routing individual inbound replies through it changes the legal/comms
posture.
- **Root fix:** ⟲ **user confirms** this is acceptable for their use; honor opt-outs on this
  path (F12); include identifying context in the message ("Ghem Properties — your application
  link: …") so it doesn't read as spam; keep it opt-in + disarmed by default.

### 🟠 F12 — opt-out (STOP) must be honored on the Text-Em-All path.
The relay checks `SmsOptOut`; the individual path must too — a caller who texted STOP must
not be re-contacted via Text-Em-All.
- **Root fix:** the job checks `SmsOptOut` (and skips) before editing/firing, exactly like
  `buildTextEmAllCsv`. Add to M2 gate.

### 🟠 F13 — multi-number UX: the link arrives from a THIRD number.
Caller dials the Twilio number, gets the AI greeting from the relay (iMessage number), then
the link from **Text-Em-All's** sending number — three identities in one interaction; the
link-from-unknown-number may be ignored/flagged.
- **Root fix:** message copy includes the business name + purpose; document the tradeoff.
  (The relay keeps a single consistent number — another reason it stays the default.)

### 🟠 F14 — settle must be a persisted scheduling delay, not a worker sleep.
A worker sleeping 15 min ties up the queue worker/connection and dies on restart.
- **Root fix:** persist a **last-fired-at** timestamp (Redis/DB); each job, before editing,
  checks "has `settle_min` elapsed since the last fire?" and if not, **re-delays itself**
  (BullMQ delayed job) — no blocking sleep, survives restarts, resumes correctly (F5/F13).

### 🟠 F15 — separate the two timers cleanly.
`individual_settle_min` (global queue pacing between *different* callers, for F1/F9) and
`individual_cooldown_min` (per-*phone* re-fire suppression, F6) are different axes and must
not be conflated. Cooldown suppresses the *same* number; settle paces *distinct* numbers.
- **Root fix:** implement + test them independently; document both.

### 🟡 F16 — per-call cost.
Each inbound now costs an **Iris LLM run (~$0.30) + a Zapier task**, vs. the free relay.
- **Root fix:** note the per-call cost; the combined-cap/fallback (F3) also bounds spend;
  low-volume only.

### 🟡 F17 — arming goes live for EVERYONE at once; no canary.
Flipping `individual_trigger_armed` routes every caller/texter through the new path
instantly.
- **Root fix:** add a **test-whitelist** (`textemall.individual_test_numbers`) — when set,
  only those numbers fire live; everyone else stays dry-run/relay. Prove the end-to-end path
  on your own number before arming for all. Add to M5/M6.

### Net effect of pass 2
The core tension stands: **group-broadcast makes the mutable group the recipient, which is
fundamentally at odds with async/polled broadcasting.** The plan mitigates it (settle ≥ 2×
poll, instant-trigger recommendation, count==1 gate, relay fallback, dedupe, opt-out), and
those make it *safe enough for low volume with an instant Zap trigger* — but the throughput
ceiling (F10), best-effort race bound (F9), and compliance posture (F11) are inherent to the
model. If any of those is unacceptable, the **form-phone recipient model (F1 alternative)
removes F9/F10 entirely** and is the cleaner target. Everything ships **disarmed** with a
**test-whitelist** (F17), so none of this sends until you've wired the Zap and armed it.

## Stress test — pass 3: root fixes (no corners)

### 🔴🔴 R1 (STRUCTURAL, was a corner-cut) — relay is the GUARANTEED fallback; the link is never black-holed.
The prior plan skipped the relay whenever `channel=textemall`, then made the fire a no-op
when disarmed / not-whitelisted / cap-hit / edit-failed → **the caller would get NO link.**
Root fix — **the delivery decision is "use Text-Em-All only when it will actually deliver
live; in every other case deliver via the relay."** The relay is the universal backstop, so
a caller ALWAYS gets exactly one link. Truth table (per inbound, channel=textemall):

| armed | number whitelisted?* | Iris edit result | Zapier cap | → delivery |
|---|---|---|---|---|
| false | — | (not attempted) | — | **relay** (link via relay; nothing fired) |
| true | no | (not attempted) | — | **relay** |
| true | yes | ok (count==1) | under cap | **Text-Em-All** (fire) |
| true | yes | needs_login/failed/count≠1 | — | **relay** (fallback; NOT fired) |
| true | yes | ok | at/over cap | **relay** (fallback) |

*whitelist (`individual_test_numbers`): when empty → all numbers eligible; when set → only
listed numbers use Text-Em-All, everyone else uses relay. So during testing, real callers
still get the link via relay — never dropped.
- **Rule:** relay is skipped **only** on the row that actually fires Text-Em-All live. Fire
  exactly once, on a verified count==1, and fall back to relay on ANY other outcome. This
  makes "disarmed" mean "safe (relay)", not "silent".

### 🔴 R2 — the settle is still a timing GUESS; pick the mechanism by the actual Text-Em-All Zapier action.
Even with an instant trigger, a ~30s settle is a guess at Zapier's processing latency —
the mutable group read asynchronously can never be *provably* correct by timing alone.
- **Root fix — M0 must determine which Text-Em-All Zapier action exists and design to it:**
  - If Text-Em-All Zapier can **send to a phone number** (from the form field) → use that;
    the group stops being the recipient, and F1/F9/F10/R-settle **all vanish** (recommended).
  - If Text-Em-All Zapier can **only broadcast to a group** → correctness requires confirming
    each broadcast **actually sent** before re-pointing the group. Since the instant Zap
    processes on submit, the safe primitive is: **one in-flight broadcast at a time**, and
    the next job's edit waits on a **broadcast-sent confirmation** (Iris reads the group's
    "last broadcast" state / sent log), NOT a fixed timer. The ~30s settle is the *floor*,
    the confirmation is the *gate*. Document that a pure timer is best-effort.
  ⟲ **M0 investigates the Text-Em-All Zapier action list and locks the mechanism.**

### 🟠 R3 — single-number edit should use "Add Contact", not the CSV file-import.
Reusing `irisUploadToGroup` (Upload File → ⌘⇧G → CSV) for ONE number drags in the fragile
file-picker for no reason.
- **Root fix:** a dedicated lighter Iris goal for this path — "open group → clear it → **Add
  Contact → type `<number>`** → verify count==1" — no file dialog, fewer turns, far more
  reliable. Build a `irisSetGroupToNumber(group, phone)` distinct from the batch importer.

### 🟠 R4 — no delivery confirmation on the Text-Em-All path.
Unlike the relay (which has a send/deferred/failed status), a fired form gives no proof the
caller actually received the text (they may be suppressed at Text-Em-All, or the Zap errs).
- **Root fix:** mark these sends **"sent (unconfirmed)"** in the SMS-leads tab, distinct from
  relay's confirmed status; the R1 relay-fallback covers the *pre-fire* failures, but a
  post-fire Text-Em-All failure is invisible — accept + label it, don't imply confirmation.

### 🟠 R5 — combined Zapier cap needs a SHARED, ATOMIC ledger.
Two separate caps can't enforce a single 100/month across both paths, and two near-cap fires
could both pass a non-atomic check.
- **Root fix:** one shared monthly-fire ledger (a row/counter both paths increment inside a
  transaction, or a `TextEmAllFire` table counted per calendar month); check-and-increment
  atomically before firing; at/over 100 → relay fallback (R1). Zillow's existing
  `monthly_fire_cap` folds into this shared counter.

### 🟠 R6 — precise idempotency vs. business dedupe (two different keys).
- **Retry idempotency (F5):** BullMQ `jobId = inbound-event id`; a retried job that already
  fired must NOT fire again (check the fired-flag written *before* the job is acked).
- **Business dedupe (F6/D):** per-phone cooldown suppresses a *new legitimate* call/text from
  re-firing within the window (covers call-then-text).
- **Fallback only if not fired:** relay fallback (R1) triggers only when the job did NOT fire
  Text-Em-All — never both (prevents double-delivery on a partial failure).

### 🟠 R7 — the group must exist and stay logged in (shared with Zillow).
`2. leads 08-28-2026` must already exist in Text-Em-All, and the session must be logged in
(shared dependency with the Zillow path).
- **Root fix:** M2 gate handles "group not found" and "needs-login" → NO fire, **relay
  fallback** (R1); document group-creation + logged-in Safari as prerequisites.

### 🟡 R8 — greeting copy + ordering.
The relay greeting ("we're texting you a link") stays truthful, but the link now arrives from
Text-Em-All's number seconds–minutes later. Copy includes "Ghem Properties"; the greeting no
longer *contains* the link (F4). Acceptable; documented (F13).

### Net effect of pass 3
The one structural defect (R1: silent black-holing) is fixed by making **relay the
guaranteed universal fallback** — Text-Em-All is a best-effort upgrade layered on top, never
a replacement that can drop the link. R2 refuses the timer corner-cut: the mechanism is
chosen from the *actual* Text-Em-All Zapier action in M0 (send-to-number preferred; else
confirm-before-reuse). With R1+R2+R3 the design is non-lossy, race-correct (or documented
best-effort), and reliable per-number. All still disarmed + whitelisted; nothing sends until
the Zap is wired and armed.

## Out of scope
The Zillow batch → Text-Em-All path (separate, already built); arming + live sending;
the user's Zapier workflow construction; any change to relay/Twilio runtime behavior.
