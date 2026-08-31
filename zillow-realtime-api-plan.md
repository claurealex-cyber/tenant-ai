# Zillow Real-Time Broadcast (API mode) — Plan rev.5

Rev.5, 2026-08-31: third adversarial pass, probing angles the first two never
touched — clock-time compliance, the manual-trigger paths that bypass the new
mutex, and cross-lane interference in the quarantine. One finding (U1) is a
compliance/annoyance bug every earlier revision shipped. Rev.1–rev.4 in git
history; carried findings below still bind.

## Goal
When the Zillow lane is in **direct API** mode, stop waiting for the 3×/day
schedule: a NEW Zillow lead (inquiry / tour request) gets the lead broadcast,
and a lead whose Zillow application completes gets the applicant follow-up,
within ~one poll interval (target 2–3 min) — **inside texting hours**.

## Shipped code this builds on (verified)
- `resolveBroadcastMethod("zillow")` / `resolveZillowDelivery()` — single source
  of truth; dashboard reads the same helper.
- `sendBroadcastViaApi({phones,message})` — draft → contacts → send by phone;
  name from `textemall.broadcast_name`; payload sets `CheckCallingWindow:false`
  (TEA will NOT stop an off-hours send for us); `sentPhones` = draft-stage adds.
- Lead dedupe: batch `sent`+`sentPhones` before the flip; `buildTextEmAllCsv`
  (leads) excludes phones in any SENT batch (unbounded scan — see U4); only
  `sentPhones` flipped. `leadCount` (excl. owner) exists; applicant branch gates
  on it, leads branch still gates on `csv.count`.
- Applicant segment: `applicationCompleted` scraped on create AND update;
  gated on `textemall.applicant_relay_enabled`; deduped via
  `applicantSentBatchId`; `excludeApplicants` only when the relay is on.
- `runDailyAutomation`: hour-slot claim at top; **does NOT catch** an import
  throw; `runZillowImport` THROWS when an import is already running and takes
  the GUI lock internally (not re-entrant). `isGuiBusy()` exists.
- Manual paths: `/internal/zillow/import` calls `runZillowImport()` directly
  (409 on busy); `/internal/zillow/auto-run` (dashboard "Run workflow now")
  calls `runDailyAutomation({force})` with NO try/catch.
- Watchdog: streak-collapsed `notifyOnMac` (Mac display notification, not a
  text). Config cache: 60 s per-process TTL. `TextEmAllBatch.status` free
  string; `csvPath`/`slot` nullable. Existing window config:
  `zillow.auto_start_hour=8`, `zillow.auto_end_hour=22`.

## Carried findings (rev.3 S-pass + rev.4 T-pass, condensed, still binding)
- **S1** poll must bypass the hour-slot claim (else 1 cycle/hour) →
  `runZillowCycle` extraction; poll writes a lazy minute-slot run row only on
  action.
- **S2** no whole-cycle GUI lock (nested acquire deadlocks) → separate cycle
  mutex + `isGuiBusy()` peek.
- **S3** cron uses wait-mode so 10/16/22 slots are always claimed.
- **S4/T3** ambiguous send outcome → quarantine batch; resolve at cycle start
  under the GUI lock; login-wall keeps quarantine forever + streak notify;
  CSV dedupe excludes `sent` AND `ambiguous`.
- **S5** poll cycles gate on `leadCount>0`; scheduled keep `csv.count` → owner's
  3×/day heartbeat preserved with zero new code.
- **S6** 60 s config lag stated in the UI. **S7** poll imports skip rawJson +
  14-day prune. **S8** ceiling blocks poll broadcasts only (worst case
  ceiling+3/day).
- **T1** leads and applicant segments must be fully INDEPENDENT (today the
  applicant block runs only after a successful leads send, and the empty-batch
  early-return precedes both) — otherwise the poll gate starves follow-ups.
- **T2** api mode uses `write:false` CSVs and drops the csvPath check.
- **T4** first poll ≥120 s after process start (crash-relaunch rebuilds the
  tree). **T5** DST minute-slot repeat = one-poll deferral, accepted.
  **T6** `sentPhones` = draft adds, not deliveries, accepted.

## STRESS TEST of rev.4 — new findings and fixes

### U1 — CRITICAL: rev.1–rev.4 all text leads at 3 AM
The poll runs 24/7 and `sendBroadcastViaApi` sets `CheckCallingWindow:false`,
so a lead who inquires at 02:00 gets a marketing text at ~02:03 — TCPA quiet
hours + guaranteed annoyance. The scheduled path never had this problem
(10/16/22 are daytime by construction), which is why no revision noticed.
**Fix (M3):** the poll due-check also requires
`now.getHours() ∈ [auto_start_hour, auto_end_hour]` (the EXISTING config,
default 8–22 — no new keys). Outside the window: no cycles at all (no scrape
either — anti-bot bonus); overnight leads accumulate as `new` and go out on the
first in-window poll (~08:00). Manual/forced runs stay exempt (operator intent).
**M7 drill:** clock-stub test proves no poll fires at 23:00–07:59 and the 08:00
poll drains the overnight backlog in one broadcast.

### U2 — HIGH: manual triggers bypass the new mutex and can crash/starve cycles
`/internal/zillow/auto-run` (the dashboard button) and `/internal/zillow/import`
run OUTSIDE any cycle serialization. With a poll active every ~3 min:
(a) a manual import makes the poll's `runZillowImport()` THROW ("already
running") — and `runDailyAutomation` does not catch it, so the poll driver
would blow up (and the auto-run route, which also has no try/catch, would 500);
(b) a manual auto-run and a poll cycle can interleave their send phases.
**Fix (M1):** `/internal/zillow/auto-run` goes through
`runExclusiveCycle("wait")` like the cron; the poll driver treats an
import-busy throw as outcome `skipped:"import_busy"` (never propagates);
`/internal/zillow/import` keeps its 409-on-busy contract (import-only, no send
— the inner `importRunning` guard already serializes it against cycles); the
auto-run route gains a try/catch.

### U3 — the daily ceiling ignores ambiguous batches
`max_broadcasts_per_day` counted SENT batches; a systematic-ambiguity failure
mode (each send possibly real) would never hit the ceiling while spending
credits.
**Fix (M3):** the ceiling counts today's `sent` + `ambiguous` batches.

### U4 — the dedupe scan is unbounded and polling multiplies its cost
`buildTextEmAllCsv` loads EVERY sent batch ever (no date filter) each cycle to
build the already-sent phone set — at ~300–480 cycles/day that's a growing
full-table scan per poll. Pruning is safe: the set only protects flip-failures,
and any lead from an old batch was flipped long ago (or resolved by M3b).
**Fix (M2/M6):** the dedupe query filters `createdAt ≥ now − 90 days`; M6's
daily prune also deletes `sent` TextEmAllBatch rows older than 90 days
(config `zillow.batch_retention_days`).

### U5 — cross-lane quarantine false-promote (exactness is free)
The individual lane calls the same `sendBroadcastViaApi` with the SAME
`textemall.broadcast_name`. T3's recipients-⊇ match could promote a zillow
ambiguous batch on the strength of an INDIVIDUAL broadcast to the same person
(single-new-lead batch where that lead also texted in). Severity is low (both
sends carry the same `broadcast_message`), but exactness costs nothing.
**Fix (M3b):** match on recipients as an EXACT set (batch phones ==
broadcast recipients, 10-digit-normalized), and set
`textemall.individual_broadcast_name` (default "Individual Messaged") so the
lanes are distinguishable in TEA and in resolution. (One-line change in
`individual-relay.ts`'s api call — the only cross-lane touch in this plan.)

### U6 — cosmetic: config keys named fully
The applicant toggle is `textemall.applicant_relay_enabled`; new keys are
`zillow.fast_poll_sec`, `zillow.max_broadcasts_per_day`,
`zillow.import_retention_days`, `zillow.batch_retention_days`,
`textemall.individual_broadcast_name`. No other namespace additions.

## Milestones

### M1 — Cycle extraction + mutex + manual-path wiring (S1, S2, S3, U2)
- `runZillowCycle(opts:{trigger:"scheduled"|"manual"|"poll", now?})` extracted;
  scheduled/manual keep claimSlot + hour-slot exactly as today.
- `runExclusiveCycle(mode:"wait"|"try")` in-process mutex; poll peeks
  `isGuiBusy()`; import-busy throw → `skipped:"import_busy"` (U2).
- `/internal/zillow/auto-run` → wait-mode + try/catch; `/internal/zillow/import`
  contract unchanged (U2).
- **Gate:** existing suite green unchanged; try skips while busy; wait queues;
  poll survives a concurrent manual import (skip, no throw); auto-run during a
  poll waits and completes.

### M2 — Independent segments + poll gates (S5, T1, T2, U4)
- Api branch → two INDEPENDENT segment sends (own gate/batch/error handling):
  leads `poll ? leadCount>0 : count>0`; applicants
  `applicant_relay_enabled && leadCount>0`, on every trigger, regardless of the
  leads outcome. `write:false` + no csvPath check in api mode (T2). Dedupe scan
  bounded to 90 days (U4). Form branch byte-identical.
- **Gate:** poll + 0 leads + 1 applicant → follow-up only; leads failure ↛
  applicants (and vice versa); poll + nothing → no rows, no files; scheduled +
  0 leads → owner heartbeat exactly as today; api mode writes no CSV files.

### M3 — Fast-poll driver (S1, S6, S8, T4, U1, U3)
- 30 s `setInterval` in `index.ts` (not BullMQ): due when mode=api ∧
  `zillow.auto_enabled` ∧ `fast_poll_sec>0` ∧ **hour ∈ [auto_start_hour,
  auto_end_hour] (U1)** ∧ last-cycle-end ≥ `fast_poll_sec` (+ jitter 0–20 s) ∧
  uptime ≥ 120 s ∧ ceiling (sent+ambiguous, U3) not hit ∧ `!isGuiBusy()` →
  `runExclusiveCycle("try")` → `runZillowCycle({trigger:"poll"})`.
- Config per evaluation (≤60 s lag): `fast_poll_sec` (default 180, floor 120,
  0=off), `max_broadcasts_per_day` (default 50, poll-only).
- **Gate:** fake-timer tests — cadence+jitter; window edges (23:00 silent,
  08:00 drains backlog); 0 stops ≤1 evaluation; api→form stops / form→api
  resumes; ceiling counts ambiguous; busy → skip; no poll in first 120 s.

### M3b — Ambiguous-send quarantine (S4, T3, U3, U5)
- Stage-classified failures (`draft`/`type`/`no recipients` retry freely;
  exception/timeout/`send N` → `status:"ambiguous"`).
- Resolution at cycle start under `withGuiLock("textemall-api")`: TEA broadcast
  matches when name == the LANE's broadcast name ∧ CreatedDate ≥
  batch.createdAt−60 s ∧ recipients == batch phones EXACTLY (U5). Found →
  promote to `sent`, flip/mark; not found → demote to `failed`. Login wall →
  quarantine persists + one streak notification. Set
  `textemall.individual_broadcast_name` in the individual lane's api call (U5).
- **Gate:** fixtures — draft failure retries; timeout+match → promoted, no
  re-text; timeout+none → demoted, retried; an individual broadcast to the same
  person does NOT promote a zillow batch; unresolved quarantine excludes phones
  + notifies once per streak.

### M4 — Cron coexistence (S3)
- Poll broadcast 15:58 → cron 16:00 (wait-mode): 0 new leads → owner heartbeat
  only. Form mode: no polling, nothing changes.
- **Gate:** that test; form-mode suite untouched.

### M5 — Status + notifications (S6)
- Panels via `resolveZillowDelivery()`: api → "Real-time — Zillow scrape every
  ~N min, 8:00–22:00 · last poll HH:MM · sent today X/50 (changes apply within
  a minute)"; form → "Scheduled 10:00/16:00/22:00". Ambiguous badge.
- Failure/needs-login streak notifications; watchdog realtime mode reports
  "poll stalled > 3× interval" **only inside the window** (form mode keeps
  slot reporting).
- **Gate:** route/component tests + dashboard screenshot.

### M6 — Retention (S7, U4)
- `runZillowImport({persistRaw:false})` for polls; daily prune: ImportRun rows
  + raw files (`zillow.import_retention_days`, 14) and sent TextEmAllBatch rows
  (`zillow.batch_retention_days`, 90; never prunes `ambiguous`).
- **Gate:** poll import writes no raw file; prune windows respected; ambiguous
  rows survive pruning.

### M7 — Live gate (owner present)
1. Deploy via launchd sequence (kill launcher pid → ports free → kickstart;
   avoid 09:30–09:40 and first 5 min of 10/16/22).
2. `fast_poll_sec=180`; two empty polls → log lines only, nothing written.
3. Test inquiry → broadcast incl. owner within ~3 min; lead `invited`.
4. Applicant transition with NO new leads → follow-up within one poll
   (proves T1); `applicantSentBatchId` set; owner copy received.
5. Drills: `fast_poll_sec=0` stops ≤1 min; lane→form full revert; 16:00/22:00
   heartbeat still arrives; osascript killed mid-send → ambiguous → resolved
   next cycle without re-text; dashboard "Run workflow now" during an active
   poll completes cleanly (U2); confirm zero cycles after 22:00 (U1).

## Non-goals
- No tour-request detection on already-messaged leads (`lastMessage` change).
- No per-recipient delivery tracking (T6).
- No change to form/Zapier mode, relay transport, inbound SMS/call paths, or
  the individual lane beyond the one-line broadcast-name split (U5).
- Not instant — poll interval + one scrape; an inbound send can wait out ONE
  in-flight scrape.

## BUILD RECORD (2026-08-31) — M1–M6 BUILT, each stress-gated

- **M1** `zillow-cycle.ts` mutex (wait/try) + `runZillowCycle` extraction with the
  `RunRecorder` abstraction; import-busy caught at the root; auto-run route
  hardened. Gate: concurrency tests (loser sees `already_done`, not
  `claim_lost`), import-busy → recorded failed outcome, no throw.
- **M2** API branch restructured into two independent segments; poll gate
  `leadCount>0`, scheduled keeps `count>0` (heartbeat preserved); `write:false`
  + no csvPath in api mode; poll trigger forces minute-granular batch keys;
  CSV dedupe scan bounded to 90 days. Gate: 7 tests incl. "poll + 0 leads +
  1 applicant → follow-up only" and cross-segment failure isolation.
- **M3** `zillow-poll.ts` driver (30 s evaluations; gates: mode, enabled,
  interval>0 floor 120, **U1 hours window**, uptime≥120 s, ceiling
  sent+ambiguous, gui-busy, cycle try-mode; jitter 0–20 s; lazy minute-slot
  recorder — empty polls write nothing). Wired in `index.ts`. Gate: 12 tests
  (gate priority, window edges inclusive, floor, jitter, live api↔form flip,
  busy-skip, throw-safety, lazy-recorder row rules).
- **M3b** stage-classified failures → `ambiguous` batch state;
  `resolveAmbiguousBatches` at cycle start (exact-set match via
  `probeRecentBroadcasts`, promote/demote, login-wall persists + streak
  notify); CSV dedupe excludes ambiguous; per-lane broadcast name
  (`textemall.individual_broadcast_name`) in the individual lane. Gate: 13
  tests incl. U5 cross-lane no-false-promote and no-double-claim.
- **M4** coexistence proven with the REAL CSV dedupe (only Safari modules
  mocked): poll 15:58 → cron 16:00 no re-text / heartbeat-only; between-lead
  rides the cron; poll never claims the cron's hour slot.
- **M5** `getPollStatus` merged into `/internal/zillow/auto-status`; stall
  streak (blocked > 3× gap → one notify + one recovery note); dashboard
  AutomationPanel realtime banner (interval, window, last poll, sent X/50,
  ambiguous on-hold badge, 60 s-lag note); DeliveryMethodPanel hint.
- **M6** `persistRaw:false` for poll imports; once-daily prune from the
  watchdog timer callback (import runs FK-safe, raw files by mtime, sent
  batches ≥90 d; ambiguous NEVER pruned).
- **Verification:** the 8 zillow/textemall suites green twice under parallel
  run (122 tests, three real parallel-DB interference bugs root-fixed along
  the way); full repo suite **2034/2034**; `npx turbo build --force` 4/4.
- **Deviations from rev.5 (documented):** stall detection lives in the poll
  driver (same streak semantics, no watchdog surgery — cron still claims
  10/16/22 in realtime mode, so missed-slot reporting stays valid as-is);
  quarantine resolution runs only on textemall-channel cycles (a lane flipped
  to relay holds quarantine until flipped back — surfaced by the M5 badge);
  prune runs from the watchdog's timer callback, not `watchdogTick` (tests
  invoke the tick against shared-DB fixtures).

### M7 — LIVE GATE: DEPLOYED + ARMED 2026-08-31 ~14:21 CDT; core drills observed on real traffic
- Deployed via the launchd sequence (ports freed in 2 s, cached rebuild, healthy
  in seconds, pid 17640); `zillow.fast_poll_sec=180` set + config refresh —
  status flipped `poll_off → warming_up` live (no restart).
- **Observed live:** 120 s boot guard held; `gui_busy` politeness skip; failed
  cycles paced at full gap (no hammering); lazy minute-slot rows written only on
  action; **cycle 3 `ran` → TEA broadcast 35981185, 7 recipients (6 new leads +
  owner check), 6 leads flipped, 90 min before the 16:00 slot** — the poll
  drained the backlog stranded by the morning's failure.
- **Root-caused a pre-existing env failure the poll surfaced:** today's 10:00
  scheduled slot had already failed `load-timeout (about:blank)` — a Safari
  session-restore ZOMBIE TAB (URL property + cached title present, page never
  materialized; `do JavaScript` sees about:blank). Healed live by re-setting the
  tab URL; **root-fixed in `zillow-extract.ts`** (one-shot NUDGE_TAB after 5 s of
  about:blank in the load wait). The fix rides the next restart (start.sh
  rebuilds on every launch — exactly when zombie tabs are born).
- **Remaining drills for the owner:** applicant follow-up with no new leads
  (needs `textemall.applicant_relay_enabled=true` — decision 3 below); confirm
  zero cycles after 22:00 tonight (clock-stubbed in tests; log check:
  `grep zillow-poll ~/Library/Logs/tenant-ai.log`); kill-mid-send quarantine
  drill (covered by fixtures; live occurrence will self-resolve).

## Open decisions (owner)
1. `fast_poll_sec` default 180 ok? (floor 120 = anti-bot caution)
2. `max_broadcasts_per_day` = 50 ok?
3. Texting window = existing 8–22 ok, or narrower (e.g. 9–20)?
4. Flip `textemall.applicant_relay_enabled=true` at M7 go-live, or keep manual?
