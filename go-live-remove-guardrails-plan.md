# Plan: Go-live — enable real messaging (loosen the send guardrails)

## Goal (clarified by owner)
Make the **real workflows actually send**: the Zillow broadcast workflow and the caller/text
Text-Em-All workflow should message the **real new leads / callers** they're meant to. The
**dev-safety gates added after the earlier relay-leak** (generated test numbers) are now the
thing blocking those real sends — remove them.

**Owner's explicit tradeoff:** *"I'd rather it message fake numbers that may be real in stress
testing than have the guardrails restrict the Zillow broadcast workflow and the caller/text
Text-Em-All workflow."* → We prioritize the workflows working. The dev/dry-run/arming/whitelist
gates come off so real leads get messaged; the accepted risk is that a synthetic test number
that happens to be real could receive a message during a stress run.

**Still kept (these are NOT the blockers, and the owner wants them):** the **only-new dedupe**
(only never-messaged leads are eligible), the **3×/day cadence** (10/16/22), the relay
**`new_recipient_cap`**, and **opt-out/STOP**. Loosening the relay's *throughput* caps
(hourly/daily/cooldown/qa) is secondary — the primary ask is un-blocking the Text-Em-All
workflows.

## ⚠️ Read first — the real risk (and a prior instruction)
- The relay sends from your **personal iMessage/SMS number**. The `hourly/daily/
  new_recipient` caps are the ONLY thing between that number and a **carrier spam flag or
  an iMessage-account disable** — which is slow/hard to reverse. The code comment says as
  much ("these caps are what stand between the personal number and a [block]").
- **You earlier said to KEEP the carrier guard** ("…not get flagged by my carrier… keep a
  guard"). This plan removes/raises it per this new request, but that reverses that call —
  flagged here so it's a conscious change, not an accident.
- **Compliance:** messaging real numbers at scale is TCPA territory. **Opt-out/STOP stays
  ON, always** — it is not a "guardrail" to remove; it's the law.
- Recommendation: **raise the caps high rather than delete them, and ramp** (canary → full)
  so a mistake can't blast everyone at once. Removing them entirely is offered, but flagged.

## The three guard classes (know which is which)
1. **Arming / dev-safety gates — THIS is what's being REMOVED (they block the real
   workflows).** These are the post-relay-leak gates that keep the workflows in dry-run /
   restricted mode: `textemall.individual_trigger_armed` (→ true),
   `sms_relay.individual_channel` (→ textemall), `textemall.individual_test_numbers`
   (whitelist → cleared to go live for all), and the Zillow path (`trigger_armed` already on;
   the real blocker is the un-deployed Iris fix — M1). Removing these lets the Zillow batch
   and caller/text workflows actually message real new leads. Owner accepts the stress-test
   risk (§Goal).
2. **Volume caps** — throughput throttles. The subject of this request; raise or remove:
   `sms_relay.hourly_cap`, `daily_cap`, `cooldown_minutes`, `qa_hourly_cap`,
   `qa_daily_cap`, `textemall.monthly_fire_cap`.
3. **Compliance + "only-new" guards — NEVER removed:**
   - opt-out/STOP suppression (both channels) + the "known tenant / blocked-caller /
     no-phone" skips.
   - **The ONLY-NEW workflow dedupe (owner: keep this).** The Zillow workflow only adds
     **genuinely-new** numbers to the list and only broadcasts to those — it never
     re-contacts a number already messaged. This is the `zillow.auto_baseline` +
     set-once `createdAt` + the "exclude any phone already in a *sent* batch/ledger"
     filter (`buildTextEmAllCsv` / `sendSurveyBatch`). Both channels inherit it. **STAYS.**
   - **`sms_relay.new_recipient_cap`** — the relay's per-day cap on how many NEW numbers it
     broadcasts to (carrier-flag protection). STAYS on (tune the value, don't remove).
   - **The 3×/day Text-Em-All broadcast cadence (owner: keep).** `zillow.auto_run_hours` stays
     `"10,16,22"` — Zillow broadcasts fire at most three times a day (10am / 4pm / 10pm), each
     carrying only that window's new leads. Do NOT widen it back to hourly. (This also keeps
     Zapier tasks ≤ ~93/mo, under the 100 free-tier cap — so `monthly_fire_cap` can stay too.)
   These "new numbers" guards are DIFFERENT and all kept: the dedupe decides *who is eligible*
   (only never-messaged leads); `new_recipient_cap` limits *how many new ones per day* on the
   relay; the 3×/day cadence limits *when/how often* Text-Em-All broadcasts.

## Milestones (each = a reversible config flip + a verify; no code unless noted)

### M0 — Decisions + baseline snapshot (no change)
- Snapshot current config (done: hourly 10 / daily 50 / new_recipient 10 / cooldown 60;
  Zillow armed; individual off).
- **Decide per cap:** RAISE (recommended, e.g. ×10) vs REMOVE (set to a huge number).
- **Zillow baseline — DECIDED: keep only-new.** Leave `zillow.auto_baseline` where it is so
  the ~212 existing leads stay excluded; the workflow only ever messages genuinely-new leads
  that appear going forward. Do NOT move the baseline back (that would blast the 212 — R3).
- **Decide ramp:** canary (your own numbers) → small batch → full, or all-at-once.

### M1 — DISARM first, THEN deploy (G1 — the critical trap)
Zillow is ALREADY armed (`trigger_armed=true`, `auto_enabled=true`, `send_channel=textemall`).
The Iris fix is what was blocking it — so **the moment we deploy that fix, the next 10/16/22
run fires REAL broadcasts to whatever new leads exist.** Deploy is NOT a safe "prove the path"
step; it is the Zillow go-live unless we disarm first.
- **Before deploy:** set `zillow.auto_enabled=false` (or `textemall.trigger_armed=false`) so
  the deploy loads the fixed code **without** auto-firing.
- **Then** rebuild + restart. Verify `migrate deploy` is clean first (the fire-ledger migration
  `20260828160000` is recorded applied — G11).
- **Gate:** server up, no scheduled Zillow fire (it's disarmed), individual path still off.

### M2 — Optional one-shot verify to your number (skip if you want it live now)
Quick confidence check that the deployed Text-Em-All path completes before opening to all —
takes 5 min, entirely optional per the owner's "stop restricting the workflow" stance:
- Briefly set `individual_test_numbers=<your number>`, `individual_channel=textemall`,
  `individual_trigger_armed=true`; text/call the Twilio number; confirm the link lands.
- Then **clear the whitelist** to go live for everyone.
- (Skip this and go straight to M3 if you'd rather not gate on it.)

### M3 — GO LIVE — real leads/callers get messaged
- **Pre-flight:**
  - **Check the pending eligible new-lead count** before enabling Zillow (H5) — if a large
    backlog accumulated since the baseline, the first run is one big blast; send it eyes-open.
  - **Confirm the copy** carries "Ghem Properties" (identity in the one-shot link message).
  - (Opt-out/consent resolved — single requested message, no follow-ups; see H1/H2.)
- **Zillow batch:** confirm `auto_enabled=true` (re-enable after the M1 deploy) — the next
  10/16/22 run scrapes → new leads → Iris sets the group → real broadcast. **Only-new dedupe
  + 3×/day cadence + `monthly_fire_cap` stay** (owner-kept; these are NOT the blocker).
- **Individual caller/text:** `individual_channel=textemall`, `individual_trigger_armed=true`,
  **whitelist cleared** → every real caller/texter gets the link via Text-Em-All (relay is
  still the guaranteed fallback on any failure).
- **Accepted risk (owner):** a synthetic/test number that happens to be real could get a
  message during a stress run — accepted in exchange for the workflow not being blocked.
  Opt-out/STOP still suppresses anyone who replies STOP.
- **Gate:** real new leads and real callers/texters receive the link; opt-out honored.

### M4 — Open the relay caps GRADUALLY (not all at once)
- Raise (recommended) or remove `sms_relay.hourly_cap`, `daily_cap`, `cooldown_minutes`,
  `qa_hourly_cap`, `qa_daily_cap` — **step them up over days**, not to infinity in one move.
- **`new_recipient_cap` STAYS** (owner decision) — the relay keeps its cap on new numbers/day
  so the personal number can't over-broadcast to new recipients and trip a carrier flag. Tune
  the value up if you want more new numbers/day, but the guard remains ON.
- **KEEP** opt-out/STOP + the tenant/blocked/no-phone skips (never removed).
- ⚠️ `cooldown_minutes=0` lets one person be re-texted repeatedly (G6); qa-cap removal drops a
  runaway-Q&A-loop guard (G4) — raise these, don't zero them, unless you mean it.
- **Gate:** a previously cap-deferred batch now sends; opt-out still blocks; no carrier errors.

### M5 — Full volume + monitor + KILL-SWITCH always ready
- Go to full only after a clean day at each ramp step.
- **Monitor (G7):** relay send failures / "not delivered" in Messages, opt-out (STOP) spikes,
  the shared Zapier task count vs 100 (G9), any iMessage "unable to send" errors on the Mac.
- **KILL-SWITCH (G8) — one move to instantly halt ALL real sends and revert to safe:**
  `individual_channel=relay`, `individual_trigger_armed=false`, `zillow.auto_enabled=false`,
  and set the relay caps back low (`hourly_cap=5`, `daily_cap=25`, `new_recipient_cap=10`).
  Everything is config, so this is instant and reversible; opt-out never needed touching.

## Risks
- **R1 (carrier flag / iMessage disable):** removing the relay new-recipient/hourly caps is
  the top trigger for the personal number being flagged or having iMessage disabled. Hard to
  reverse. → Prefer high caps + ramp; keep at least `new_recipient_cap` at a sane value.
- **R2 (TCPA/compliance):** automated texts to real numbers at scale. Opt-out stays; include
  business identity in the copy; only text people who contacted you or are legit leads.
- **R3 (baseline re-include) — avoided by decision.** Only-new stays, so we do NOT move the
  baseline back. The risk is now purely accidental: don't let a config edit reset
  `zillow.auto_baseline` earlier, or it would re-include (blast) the ~212 existing leads.
- **R4 (Zapier overage):** removing `monthly_fire_cap` past 100 on the free tier = the Zap
  stops or Zapier charges. Keep the cap or move to a paid tier first.
- **R5 (no undo on delivered):** every message that goes out is irreversible. The ramp is the
  safety net.

## Stress test — findings & root fixes
- **G1 (CRITICAL) — deploy = accidental Zillow go-live.** Zillow is already armed, so the
  deploy of the Iris fix auto-fires the next run. **Fix: disarm before deploy, re-arm
  deliberately (M1/M3).**
- **G2 — Text-Em-All has no per-message ramp.** A broadcast hits the WHOLE group at once, so
  "ramp" for Text-Em-All is at the **batch/group-size** level, not per message (M3).
- **G3 — no cross-channel dedupe.** A lead in the Zillow batch (Text-Em-All) who ALSO
  texts/calls (relay or individual) can get **multiple** messages. **Fix:** honor opt-out
  everywhere (already), and — if this matters — add a cross-channel per-phone "already
  linked recently" check before building either send. Decision: accept overlap, or add the
  cross-channel guard.
- **G4 — removing qa caps removes a runaway-loop guard.** `qa_hourly/qa_daily` also stop a
  misbehaving AI Q&A from texting one person in a loop. **Raise, don't zero.**
- **G6 — cooldown=0 lets one person be re-texted repeatedly.** Keep a small cooldown unless
  you truly want unlimited resends.
- **G9 — the two Text-Em-All paths SHARE the 100/mo Zapier cap.** Going live on Zillow batch
  AND per-call individual consumes the same 100; at the cap, Zillow skips and individual
  falls back to relay. **Removing the cap = Zapier overage/stop (R4).** Decision: keep the
  cap (fallback covers it) or move to paid Zapier before removing.
- **G10 — consent asymmetry.** Inbound callers/texters contacted YOU (stronger implied
  consent); **scraped Zillow leads did not** — automated broadcasts to them carry higher
  TCPA risk. Prefer opening the **individual** path first; treat the Zillow blast as the
  higher-risk move (identity in copy, opt-out prominent, legit leads only).
- **G11 — verify `migrate deploy` clean before the go-live restart** (fire-ledger migration
  recorded applied) so the restart doesn't crash-loop.
- **G13 — the ramp is the spine, not a trailing step.** Reordered: disarm → deploy → canary
  (your number, individual whitelist) → small real batch → gradual cap opening → full, with
  the kill-switch ready throughout.

## Stress test — go-live pass: findings & root fixes
- **H1 (opt-out) — RESOLVED by the one-message design (owner).** This is a **single one-shot
  transactional message** — the application link — with **no follow-ups** unless the lead
  re-initiates (texts/calls us again). There is no ongoing campaign to opt out of; a lead who
  doesn't reply is simply never contacted again. So the opt-out burden is minimal. (If someone
  does reply STOP to the broadcast, Text-Em-All's own A2P opt-out handling suppresses them at
  its level; tenant-ai's `SmsOptOut` still guards the relay + relay-fallback. The two
  registries are separate but the one-message design makes this a non-issue.)
- **H2 (consent) — RESOLVED (owner).** The Zillow leads **opted in**: they requested info and
  asked to be contacted through Zillow. So this is a requested, single application-link
  message to prospects who asked to hear from us — not cold outreach. Copy still carries the
  business identity ("Ghem Properties"). Owner's judgment; recorded.
- **H3 (Zapier cap) — DECIDED: accept ~100/mo (owner).** Stay on the free tier; the shared
  100 tasks cover Zillow (3×/day) + individual per-call. When the cap is reached, Zillow
  skips and the individual path falls back to relay for the rest of the month — nothing is
  lost, it just isn't via Text-Em-All. No paid Zapier.
- **H4 (throughput) — the individual Text-Em-All path is inherently low-throughput.** Each
  caller = a ~2-min GUI-locked Iris edit, serialized (concurrency=1) and sharing the GUI lock
  with the Zillow 10/16/22 runs. At real call volume, callers queue (and wait behind a Zillow
  run); many may actually receive the **relay fallback** rather than Text-Em-All. Not a bug —
  by design — but "every caller via Text-Em-All" is really "as many as the GUI can serialize;
  the rest relay." Document the ceiling (~a handful per busy period).
- **H5 — check the accumulated new-lead count before the FIRST live Zillow run.** The first
  10/16/22 run after go-live broadcasts to ALL new leads since the baseline; if leads piled up,
  that's one large first blast. **Fix:** query the pending eligible count before enabling; if
  large, send it as a deliberate first batch, eyes open.
- **H6 — the kill-switch stops FUTURE fires, not in-flight ones.** A broadcast already fired
  (form submitted) can't be recalled. The kill-switch prevents the next ones. Accept +
  document.
- **H7 — deploy (M1) also registers the individual-relay job and the reveal/export routes.**
  The job stays idle while `individual_channel=relay` (M3 turns it on), and reveal/export are
  admin-gated — both safe on deploy. Verify `migrate deploy` clean (fire-ledger migration
  recorded) so the restart doesn't crash-loop.

## What this plan does NOT touch
Opt-out/STOP suppression; the "known tenant / blocked caller / no textable phone" skips; the
two-key arming *code* (we flip the config, not delete the safety mechanism, so it can be
re-armed off instantly); the relay vs Twilio/Telnyx delivery mechanics.
