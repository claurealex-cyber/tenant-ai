# Zillow Real-Time Broadcast (API mode) — Plan

## Goal
When the Zillow lane is toggled to **direct API**, stop waiting for the 3×/day
schedule (10/16/22) and broadcast NEW Zillow leads **right away** — within a
couple minutes of them appearing — the way inbound SMS/calls already do.

## Why this is possible ONLY in API mode
The 3×/day cadence exists solely to stay under Zapier's free-tier 100-task/month
cap. The direct-API path uses **no Zapier**, so that cap does not apply (already
exempt — M0/T5 of the toggle work). With no cap, we can broadcast as often as new
leads appear; the only cost is Text-Em-All credits.

## The one honest limitation
Twilio PUSHES inbound texts/calls to us, so those are event-driven and near-instant.
**Zillow does not push** — there is no webhook; we discover leads by scraping the
logged-in Safari tab. So "right away" for Zillow = **poll latency**, not true
instant: a lead goes out within ~one poll interval (target ~2 min) of appearing on
Zillow, bounded by scrape time. This is the best achievable without a Zillow feed.

## Current architecture (verified)
- Trigger: BullMQ cron `0 * * * *` (hourly) → runDailyAutomation({scheduled:true});
  a watchdog setInterval only REPORTS, never triggers.
- Gate: scheduled ticks proceed only when now.getHours() ∈ runHours (10/16/22).
- Idempotence: slot = "YYYY-MM-DDTHH" (hourly) via claimSlot; ≤1 run per hour-slot.
- Import = the Safari scrape (GUI-locked, rate-limit-sensitive). Send = channel
  branch → sendBroadcastViaApi in API mode.
- Lead dedup: buildTextEmAllCsv excludes phones already in a SENT batch and flips
  broadcast leads to "invited"/sent-batch — so re-runs only ever broadcast NEW
  leads. (This is what makes frequent polling SAFE: no double-texting.)

## Design principles
1. Fast-poll is active ONLY when zillow lane = api AND auto_enabled. Form/Zapier
   and relay modes keep the EXACT 3×/day (or window) schedule, unchanged.
2. Correctness rests on the existing lead-level dedup, not on the hourly slot —
   so polling more often can never double-broadcast a lead.
3. Inbound callers/texts must NEVER be starved: a poll YIELDS the GUI lock to
   real-time sends (non-blocking try-lock; skip this tick if a send is running).
4. Empty polls (no new leads — the common case) are cheap: scrape + zero DB writes,
   no ZillowAutoRun row, no broadcast.

## Milestones

### M0 — Mode + config
- autoConfig() gains `mode`: "realtime" when resolveBroadcastMethod("zillow")==="api"
  (reusing the M0 helper), else "scheduled".
- New config: `zillow.fast_poll_sec` (default 120, floor 60), `zillow.coalesce_sec`
  (default 60, 0 = immediate), `zillow.max_broadcasts_per_day` (default 50 safety
  ceiling; 0 = unlimited). All read per-tick so a dashboard change takes effect live.

### M1 — Non-blocking GUI lock (protect real-time sends)
- Add `tryWithGuiLock(label, fn)` to gui-lock.ts: acquire only if free, else return
  a `{skipped:true}` sentinel immediately. The poll uses this so a scrape never
  queues ahead of / delays a caller or SMS send. (withGuiLock unchanged for sends.)
- Test: caller send in flight → poll tick skips; next free tick runs.

### M2 — Fast-poll driver
- New setInterval (sibling of the watchdog; plain timer, not BullMQ — survives no-Redis)
  that every `fast_poll_sec`, when mode=realtime + enabled, runs one poll cycle:
  tryWithGuiLock → scrape (runZillowImport) → build CSV of NEW leads → if any,
  broadcast immediately via sendBroadcastViaApi; flip only sentPhones (existing
  logic). Minute-granular slot ("YYYY-MM-DDTHH:MM") for the audit row, created ONLY
  when a broadcast actually happens (no row for empty polls).
- Reuse runDailyAutomation's send branch; add a `poll:true` run mode that skips the
  hour-window gate and uses the finer slot. Jitter the interval slightly to avoid a
  fixed scrape rhythm.

### M3 — Coalesce + daily ceiling (cost control)
- When new leads are first seen, wait up to `coalesce_sec` (batching leads that
  arrive together) then one broadcast — still "right away" (≤1 min), fewer 1-lead
  broadcasts. 0 = fire immediately.
- Enforce `max_broadcasts_per_day` (count SENT batches today); on hit, log + owner
  heartbeat once, hold further sends to the next scheduled fallback. Prevents a
  scrape/loop bug from burning credits.

### M4 — Coordinate with the hourly cron (no double scrape)
- In realtime mode the fast-poll is the sole driver; the hourly cron's Zillow run
  becomes a low-frequency SAFETY NET (still runs, but lead-dedup makes it a no-op
  when the poll kept up). Guard so cron + poll can't scrape simultaneously (shared
  tryWithGuiLock + slot dedup). Form/Zapier mode: cron keeps the 3×/day schedule.

### M5 — Toggle + status wiring
- Flipping the Zillow lane to API on /admin/zillow activates realtime automatically
  (the poll reads mode each tick — no restart). Flipping to Zapier/iMessage reverts
  to schedule.
- routing-status/DeliveryMethodPanel shows the Zillow lane as
  "Real-time (polling ~every N min)" vs "Scheduled 10:00/16:00/22:00", plus last
  poll time + broadcasts-sent-today.
- Watchdog adapts: in realtime mode it reports "poll stalled > X min" instead of
  "missed slot".

### M6 — Stress tests (root)
- Rapid polls never double-broadcast a lead (lead + sent-batch dedup).
- Poll YIELDS to an in-flight caller/SMS send (tryWithGuiLock skip).
- Empty poll = no row, no broadcast, cheap.
- Live mode-flip: api→realtime starts polling; api→zapier stops it and restores 3×/day.
- Cap-exempt in api mode; max_broadcasts_per_day ceiling enforced.
- needs-login during a poll → no broadcast, surfaced (owner notify), retried next poll.

## Non-goals
- No change to the SMS/call real-time paths (already instant/event-driven).
- No change to form/Zapier scheduling (stays 3×/day, cap-bound).
- Not truly "instant" — bounded by poll interval + scrape time (Zillow has no push).
- Do not remove the GUI lock or let polls preempt real-time caller/SMS sends.

## Open decisions for the user
1. Poll interval floor — 2 min is a safe default vs Zillow anti-bot; go tighter (60s)?
2. Coalesce window — 60s (fewer broadcasts) vs 0 (each lead immediately)?
3. Daily safety ceiling — 50/day default ok, or unlimited?

---

## STRESS TEST (2026-08-29) — findings + root fixes to the plan

Verified against the code. Seven issues; three would have caused real harm.

### R1 — CRITICAL: owner heartbeat fires EVERY poll → ~720 owner texts/day
buildTextEmAllCsv ALWAYS appends the owner (always_include_phone), so csv.count is
never 0 when the owner is set. The "empty batch → skip" guard (zillow-auto.ts:282)
therefore NEVER fires in practice — a 0-new-lead run still broadcasts the owner.
That is the INTENDED 3×/day heartbeat today; at a 2-min poll it becomes ~720 texts
to the owner per day. Catastrophic.
ROOT FIX: the poll must decide "broadcast?" on the count of GENUINE NEW LEADS
(excluding the always-include owner). buildTextEmAllCsv returns a new `leadCount`
(rows minus the owner row). Poll broadcasts ONLY when leadCount ≥ 1 — the owner is
still INCLUDED in that broadcast as the delivery check, but an owner-only situation
does NOT trigger a poll broadcast. The owner heartbeat stays on a SEPARATE
low-frequency schedule (keep the existing 3×/day, or a once/day "still alive" ping),
independent of the poll. M3's coalesce is replaced by this gate.

### R2 — CRITICAL: TOCTOU double-broadcast race
withGuiLock wraps ONLY sendBroadcastViaApi (the osascript) — NOT the lead flip,
which runs after, outside the lock. The hourly slot-claim currently prevents two
runs overlapping in an hour; the plan's minute-slots + (poll + cron) REMOVE that
serialization, so two overlapping cycles could each build the same "new" CSV and
broadcast the same leads twice.
ROOT FIX: serialize the ENTIRE Zillow workflow (scrape → broadcast → mark-batch-
sent → flip) under ONE mutex/claim so only one cycle runs at a time, ever (extend
the existing in-process `importRunning` guard to a whole-cycle guard). Correctness
then rests on the SENT-batch dedup, which is committed IMMEDIATELY after the
broadcast (batch.status="sent" with phones, before the flip) — so even a crash
before the flip cannot re-broadcast. Drop the minute-slot idempotence as the
primary guard; keep a run row only for audit.

### R3 — the scrape, not the broadcast, is the cost; "empty polls are cheap" is wrong
Every poll runs a FULL Safari scrape (runZillowImport): loads the Zillow page,
parses, creates a zillowImportRun row, writes a rawJson file. At 2-min cadence
that is ~720 scrapes/day → 720 ImportRun rows + 720 raw files/day, constant Safari/
CPU load, and real Zillow anti-bot exposure. The DB-write savings on empty polls
are negligible next to the scrape.
ROOT FIX: (a) interval floor ≥ 120s, with jitter; (b) prune ImportRun rows + raw
files (retain N days, or skip rawJson persistence for poll imports); (c) optional
cheap change-detector — read just the lead-list count/first-row signature from the
open tab and full-parse only when it changed — to skip most full parses. Be honest
in the UI: "real-time = a Zillow scrape every ~N min".

### R4 — real-time sends can still be delayed by an in-flight scrape (starvation overstated)
tryWithGuiLock lets the POLL yield, but a caller/SMS send that arrives WHILE a poll
scrape holds the lock still blocks (withGuiLock is blocking) for up to one scrape
(~10-30s). "Callers never starved" is too strong.
ROOT FIX: (a) time-box the scrape and keep it as short as possible; (b) a caller/SMS
send takes PRIORITY — the poll defers if a send is queued, and the scrape is the
only unavoidable wait; (c) state the honest bound: a caller send may wait up to one
scrape. Consider a longer poll interval to shrink the collision probability.

### R5 — coalesce_sec is redundant with the poll interval
The poll interval already batches leads that arrive between polls, so a separate
coalesce timer adds cross-tick state and lock-holding risk for little gain.
ROOT FIX: DROP coalesce_sec. The poll interval IS the batch window; the R1 new-lead
gate decides whether to send. Removes M3 as a separate mechanism.

### R6 — needs-login / failure notification spam
A logged-out tab makes every poll fail; notifying per failure = a notification every
2 min.
ROOT FIX: coalesce failure/needs-login notifications to once per streak (reuse the
watchdog's streak pattern); one "resolved" note when polls succeed again.

### R7 — ImportRun / rawJson accumulation (follows from R3)
720 rows + files/day is unbounded growth.
ROOT FIX: a prune step (daily) trimming ImportRun rows + raw files beyond a
retention window; do not persist rawJson for poll-mode imports (keep it for the
scheduled/audited runs).

### Net revisions to the milestones
- M0: add `leadCount` (excl. owner) to buildTextEmAllCsv; config now just
  `fast_poll_sec` (default 180, floor 120) + `max_broadcasts_per_day`. DROP
  coalesce_sec (R5).
- M1: keep tryWithGuiLock, but re-scope — poll DEFERS to queued sends; document the
  one-scrape worst-case wait (R4). Time-box the scrape.
- M2 (NEW primary correctness): whole-cycle Zillow mutex spanning scrape→broadcast→
  mark-sent→flip (R2); broadcast gated on leadCount ≥ 1 (R1); no owner-only sends.
- M3 → REPLACED: was coalesce; now "owner heartbeat stays on its own low-frequency
  schedule, decoupled from the poll" (R1) + daily broadcast ceiling.
- M4: cron stays a safety net but shares the M2 whole-cycle mutex (no concurrent
  scrape); optional change-detector to skip redundant full parses (R3).
- M5: status shows "Real-time — Zillow scrape every ~N min" + last poll + sent-today;
  failure/needs-login notifications coalesced (R6).
- M6 (NEW): retention prune for ImportRun rows + raw files (R3/R7).
- M7 (tests): owner-only poll does NOT broadcast (R1); overlapping cycles never
  double-broadcast (R2); poll defers to a caller send (R4); needs-login notifies
  once per streak (R6); ceiling enforced; live mode-flip.

### Corrected honest summary
Real-time Zillow = "broadcast new leads within ~one poll interval (target 2-3 min),
via a full Zillow scrape each interval, owner-heartbeat decoupled, one cycle at a
time, caller/SMS sends taking priority." Not instant, but minutes not hours — and
safe against double-sends and owner-spam once R1/R2 are built.
