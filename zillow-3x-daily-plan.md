# Zillow automation → 3×/day (10am, 4pm, 10pm) — free-tier plan

> **BUILD STATUS — COMPLETE (2026-08-27).** M1–M5 built + green (67 tests across 6
> suites, server `tsc -p .` clean, migration applied). `zillow.auto_run_hours="10,16,22"`
> is LIVE; `runHours=[10,16,22]` confirmed via getAutoStatus. Soft cap on (default 96),
> missed slots accepted (no catch-up). **Gates still OPEN for unattended go-live:**
> (a) `auto_enabled` is still false (your manual switch); (b) the Iris `RESULT: ok`
> false-negative / one-by-one delete hardening (risk 2) must land first, else 3×/day
> can double-fire.

## Goal
Switch the Zillow lead automation from an **hourly** cadence (8am–10pm, up to 15
runs/day) to **exactly three fixed runs a day at 10:00, 16:00, 22:00** (server-local).
Each run does the full cycle: extract → dedupe to *new* leads → Iris upload →
broadcast (only when new leads exist). This caps Text-Em-All broadcasts at **3/day →
≤93 Zapier tasks/month**, inside the **100-task/month free tier**.

Relay (Twilio number texting/calling — `ai`/`caller`/`intake`/`link` kinds) is
**out of scope and unchanged**. This only touches the Zillow batch send cadence.

## What exists today (grounding)
- `jobs/zillow-daily.ts`: BullMQ cron `0 * * * *` (hourly tick, maxRetries 0). Cheap
  to keep — the **service** decides whether a tick does anything.
- `services/zillow-auto.ts`:
  - Window gate: scheduled ticks run only when `startHour ≤ hour ≤ endHour`
    (default **8–22**), else `not_in_window`.
  - Per-hour idempotence: `localSlot(now)="YYYY-MM-DDTHH"`, claimed via
    `ZillowAutoRun.slot @unique` (fresh-hour create = the claim).
  - Text-Em-All branch: broadcast is **once per day** — gated by
    `TextEmAllBatch.day @unique` **and** first in-window tick `≥ textemall_broadcast_hour`
    (default 12).
- `services/textemall-csv.ts`: batch = status `new`, phone≠null, `createdAt ≥ baseline`,
  minus opt-outs, minus phones already in any **sent** `TextEmAllBatch`. So each run's
  CSV is only the newly-appeared, not-yet-sent leads.

## Design
Keep the hourly BullMQ tick; change only the **service gates** + the broadcast claim.

- **New config `zillow.auto_run_hours`** = CSV of hours, default `"10,16,22"`.
  When set, it is the source of truth for *both* the run-window gate and (implicitly)
  the broadcast slots. When **unset**, everything falls back to today's
  `[startHour,endHour]` hourly behavior (full reversibility — the toggle back).
- **Run gate**: scheduled path runs iff `now.getHours()` ∈ the hour-set.
- **Broadcast claim moves from per-DAY to per-SLOT**: add `slot @unique` to
  `TextEmAllBatch` ("YYYY-MM-DDTHH"), so each of the 3 daily runs can broadcast once,
  and a duplicate tick in the same hour still claims only once. A run with **no new
  leads fires nothing** (no Zap task spent).

## Milestones (each ends with a green gate before moving on)

### M0 — Confirm the task math (no code)
- Verify the Zap is **single-action** ("New Response" trigger → 1 "Send Broadcast"
  action) so 1 fire = **1 task**, and the Iris CSV upload path spends **0** Zapier tasks.
- Confirm 3 fires/day × 31 = **93** worst-case, and that fires only happen when new
  leads exist (usually < 93). **Gate:** documented headroom + the thin-buffer note (below).

### M1 — Config plumbing: `auto_run_hours`
- Add to the integration registry + a parser `parseRunHours(csv): number[]|null`
  (dedupe, sort, clamp 0–23, reject empties → null).
- `autoConfig()` returns `runHours: number[] | null`.
- **Gate:** unit tests — `"10,16,22"`→[10,16,22]; `""`/garbage→null; out-of-range dropped.

### M2 — Run gate honors the hour-set
- In `runDailyAutomation` scheduled path: if `runHours` present, run iff
  `now.getHours()` ∈ `runHours`; else keep the legacy `[startHour,endHour]` range.
- **Gate:** tests — fires at 10/16/22, skips 9/11/15/23; legacy path unchanged when
  `auto_run_hours` unset.

### M3 — Per-slot Text-Em-All broadcast claim
- Migration: `TextEmAllBatch.slot String? @unique` (nullable-unique; backfill existing
  rows `slot = day+"T22"` so old once/day rows keep a stable key).
- Broadcast branch: claim/idempotence keyed on **slot**, not day. Each run-hour slot
  allows exactly one broadcast; `buildTextEmAllCsv` still excludes already-sent phones,
  so the 16:00 run only carries leads that appeared after the 10:00 send.
- **Gate:** tests — three distinct slots each allow one broadcast; same slot twice =
  one; no-new-leads slot = no fire, no Zap.

### M4 — Status + dashboard copy
- `getAutoStatus.nextRunLabel` → the next of `runHours` (wrapping to tomorrow's first
  after the last run); dashboard shows **"Runs 3×/day: 10am, 4pm, 10pm"** and the
  monthly-task estimate.
- **Gate:** status returns correct next-run at 09:59, 10:01, 16:30, 22:30, 23:00.

### M5 — Stress test + guardrails (root fixes, not patches)
Fold in the risks below; **gate = live dry-run** (channel logic exercised, **no real
Zap fire**), full suite green, `tsc` clean.

## Stress test / risks (address in M5 unless noted)

1. **Thin task buffer (93 vs 100).** A 31-day month at full 3×/day = 93; add a couple
   of manual test fires and you can graze 100. *Guardrail:* a per-calendar-month fire
   counter with a soft cap (default 96) that refuses to fire beyond it and logs a
   warning — cheap insurance for the free tier. **DECIDED: yes** — soft cap on, default 96.

2. **Iris false-negative ↔ double-fire (cross-dependency).** Known gap: Iris can
   *complete* the upload but run out of turns before printing `RESULT: ok`, so the
   orchestration reads "failed" → leads don't flip → the **next run re-uploads the same
   leads and fires again** = double-text + double task. With 3 runs/day this now costs
   real budget. *Fix ordering:* M3's per-slot claim must mark the slot **consumed on a
   confirmed upload**, and the Iris-marker hardening (reliable RESULT + higher
   `--max-turns` + bulk-delete) should land **before** `auto_enabled` is flipped on.

3. **Missed slot when the Mac is asleep/crashed at :00.** The hourly cron only ticks at
   :00; if 16:00 is missed, 17:00 isn't in {10,16,22} → that broadcast is skipped until
   22:00. *Options:* (a) accept the skip (simplest, safe); (b) ±grace — allow a run if
   the current hour is past a scheduled hour whose slot has no batch **and** new leads
   exist (risks a late extra fire). **DECIDED: accept skips** — no catch-up; simplest and safest.

4. **Overnight gap.** 22:00 → 10:00 is a 12h window with no send; leads appearing
   overnight wait until 10am. Acceptable for the cost goal — documented, not fixed.

5. **Delete-all is O(previous batch size), one-by-one.** Independent of this change but
   amplified by more runs; tied to the Iris hardening in risk 2. Note only.

6. **Server timezone.** `getHours()` is server-local; 10/16/22 = the Mac's local clock.
   Fine while server TZ = your TZ; DST shifts wall-clock by the OS automatically. Note.

7. **Reversibility.** Unset `zillow.auto_run_hours` → instant return to hourly 8–22.
   Flip `send_channel` back to `relay` → Text-Em-All path fully bypassed. Both verified
   in M5.

## Out of scope
Relay/Twilio SMS+voice behavior; the Iris-marker/bulk-delete hardening (tracked
separately but sequenced **before go-live** per risk 2); enabling `auto_enabled`
(that stays your manual go-live switch).
