# Dashboard-editable Zillow schedule (run times + runs/day) — Plan

**Goal (owner, 2026-08-28):** edit, on the dashboard, *when* the automatic Zillow scrape + broadcast
runs happen and *how many times a day* — without the CLI, live within a click, safely inside the
Zapier free tier.

## 1. How it works today (verified in code + live DB, 2026-08-28)

**Engine** — `apps/server/src/jobs/zillow-daily.ts` is a BullMQ cron `0 * * * *` (hourly tick at :00,
server-local = **America/Chicago**). Each tick calls `runDailyAutomation({ scheduled: true })` in
`services/zillow-auto.ts`, which gates on:
- **`zillow.auto_run_hours`** (CSV, live value **`10,16,22`**) → fixed-hours mode: run only when
  `now.getHours()` ∈ set. `parseRunHours()` dedupes/sorts/clamps 0–23; unset/garbage → **null**;
- otherwise the **legacy hourly window** `[auto_start_hour, auto_end_hour]` (live 8 / 22; legacy
  `auto_hour = 9` still stored, unused except as a default).
One run = **scrape** (Safari extraction under the GUI lock → `ingestLeads`) **then send** on the
configured channel (`zillow.send_channel = textemall` live; `relay` is the default). Idempotence is
**per hour slot** (`ZillowAutoRun.slot` and `TextEmAllBatch.slot` = `YYYY-MM-DDTHH`, both unique),
so editing hours mid-day can never double-broadcast an hour. Manual "Run now" passes `force: true`
and skips the gate. Missed slots (Mac asleep at :00) are **skipped, no catch-up** (decided 2026-08-27).

**Where the schedule is stored** — encrypted `SystemConfig` rows under `zillow.*`. Writers today:
- dashboard `POST /api/admin/zillow/auto-toggle` (on/off, baseline, and — accepted but never sent by
  the UI — `startHour`/`endHour`); encrypt + `AuditLog` + `clearConfigCache()` **dashboard-side only**
  → the server sees changes after its 60 s config-cache TTL;
- dashboard `POST /api/admin/zillow/send-channel`;
- CLI `apps/server/src/scripts/set-config.ts` — **the only way `auto_run_hours` has ever been set.**
The `zillow` keys are **not** in `INTEGRATION_REGISTRY`, so Admin → Integrations cannot edit them.

**What the dashboard shows** — `admin/zillow/AutomationPanel.tsx`: on/off, Run now, and a
**read-only** cadence label (`3×/day at 10:00, 16:00, 22:00` / `hourly from 8:00 to 22:00`) plus
`nextRunLabel`, all from `GET /api/admin/zillow/auto-status` → server `getAutoStatus()` (already
returns `runHours`, `startHour`, `endHour`, `nextRunLabel`, and `autoHour = startHour` for back-compat).

**Free-tier accounting** (`zillow-3x-daily-plan.md`) — one Text-Em-All broadcast = **1 Zapier task**;
Zapier free tier = **100 tasks/month**; 3×/day × 31 = 93. Guard: `textemall.monthly_fire_cap`
(default **96**, unset live) counts SENT batches this calendar month and refuses to fire past it.
Empty batches (no new leads) fire nothing. So **4×/day (124/month) would silently stop broadcasting
around the 24th**; the schedule editor must make this visible.

**Supervisor** — Iris cron `zillow-auto-supervisor` at **09:30** runs `scripts/zillow-supervise.sh` →
`apps/server/scripts/zillow-auto-supervise.ts`.

### Defect found (must be fixed first — it is the root of today's unscheduled 09:30 run)
`zillow-auto-supervise.ts` triggers `POST /internal/zillow/auto-run` when
`hour >= status.autoHour && !status.today`. `autoHour` is the **legacy** `startHour` (8), and the
POST is neither `scheduled` nor `force`, so it **bypasses the run-hours gate entirely**. Result, live:
a `2026-08-28T09` run at **09:30:07** (7 new leads) that built a **203-contact Text-Em-All batch**
outside the 10/16/22 schedule — it did not send only because the group-set step failed
("textemall upload failed"). This will recur **every morning** the first scheduled hour is later than
08:00. `docs/iris-zillow-supervisor.md` still describes a "09:00 window" — stale since the 3×/day
change. (Today's 11:05 / 14:26 / 15:12 runs were forced manual runs, not the supervisor.)

### Constraints that shape the design
- **Hour granularity only** (:00). Half-hours would need the tick changed to `*/30` and a new slot
  format — out of scope; the UI says ":00, Chicago time".
- Runs fire only if the Mac is awake at :00 (accepted; the UI says so).
- Scrape and broadcast are one unit per run hour today. Extra *scrape-only* hours (refresh the leads
  list without texting) are cheap (0 Zapier tasks) and a natural add-on — offered as optional M4.

---

## 2. Design (one source of truth, no new tables)

- `zillow.auto_run_hours` stays the source of truth for **fixed mode**; **unset = hourly-window mode**
  (`auto_start_hour`/`auto_end_hour`). "How many times a day" = the number of selected hours — never
  a separate number that can disagree with the hours.
- New shared helper `packages/shared/src/zillow-schedule.ts`: `normalizeRunHours(input: unknown):
  { hours: number[]; errors: string[] }`, `runsPerDay`, `monthlyFireEstimate(hours, daysInMonth)`,
  `describeSchedule(...)` — used by the dashboard route (validation) and by `getAutoStatus` (labels),
  so the panel and the engine can never disagree.
- One new dashboard route `POST /api/admin/zillow/schedule` (admin-only, encrypt + `AuditLog`
  `zillow_schedule` + cache clear **in both processes** via `proxyToServer("/internal/config/refresh")`).
- `getAutoStatus()` gains a `schedule` block the panel renders; `autoHour` becomes the **first run
  hour** in fixed mode (what "the day's first run" means now) — this is also what the supervisor needs.

---

## 3. Milestones

### M0 — Make the supervisor schedule-aware (root fix; ship before anything else)
**`apps/server/scripts/zillow-auto-supervise.ts`**: extract the decision into a pure, testable
`decideSupervision(status, nowHour)` (new `apps/server/src/services/zillow-supervise-logic.ts`):
- fixed mode (`runHours` present): **never trigger a run** (missed slots are accepted by decision);
  only notify — `needs_login`, `failed`, server unreachable, or "first run hour has passed and there
  is no row for that slot".
- hourly-window mode: keep today's behaviour but trigger with `{ scheduled: true }` semantics via a
  new body flag on `/internal/zillow/auto-run` (`respectWindow: true`) so it can never run outside
  the window.
`getAutoStatus().autoHour` = `runHours ? runHours[0] : startHour`. Update
`docs/iris-zillow-supervisor.md` (09:00 → "first scheduled hour", no triggering in fixed mode).

**Gate:** unit tests for `decideSupervision` (fixed mode at 09:30 → no trigger; missed 10:00 slot →
notify only; hourly mode before window → nothing; after window with no row → trigger respecting
window). Run `scripts/zillow-supervise.sh` by hand at a non-run hour → prints a status line, **no**
`ZillowAutoRun` row created. Tomorrow 09:30: no `T09` row.

### M1 — Server: schedule model + status
- `packages/shared/src/zillow-schedule.ts` (helpers above) + tests (parse/normalize, estimates,
  labels incl. wrap-to-tomorrow and DST-agnostic hour math).
- `zillow-auto.ts`: `getAutoStatus()` returns
  `schedule: { mode: "fixed"|"hourly", hours, startHour, endHour, runsPerDay, timezone:
  "America/Chicago", nextRunLabel, monthlyEstimate, monthlyCap, channel, capWarning: boolean }`.
  Existing fields stay (panel back-compat). `autoConfig()` unchanged (parseRunHours stays).
- Fix the stale copy path: `runDailyAutomation` unchanged.

**Gate:** `zillow-auto.test.ts` extended: status block correct for fixed and hourly; `capWarning`
true for 4×/day with textemall + cap 96, false for relay channel; `tsc` clean.

### M2 — Dashboard API: `POST /api/admin/zillow/schedule`
Body: `{ mode: "fixed", hours: number[] }` or `{ mode: "hourly", startHour, endHour }`, optional
`acknowledgeCap: true`.
- Admin-only (same guard as `auto-toggle`). Validate with `normalizeRunHours`: 1–24 distinct integer
  hours 0–23 (fixed), `0 ≤ start ≤ end ≤ 23` (hourly). 400 with the specific error otherwise.
- Free-tier guard: channel `textemall` and `runsPerDay × 31 > monthly_fire_cap` → 400
  `{ error, needsAck: true, estimate, cap }` unless `acknowledgeCap` — the owner can still choose it,
  knowingly (the monthly cap remains the hard stop).
- Writes: fixed → `zillow.auto_run_hours = "h,h,h"`; hourly → delete/blank `auto_run_hours` and write
  `auto_start_hour`/`auto_end_hour`. Encrypt via the `auto-toggle` pattern; `AuditLog`
  `zillow_schedule` with before/after; `clearConfigCache()` + `proxyToServer("/internal/config/refresh")`
  so the engine picks it up **immediately** (also add that proxy call to `auto-toggle`, which today
  waits up to 60 s).
- `GET` variant not needed — `auto-status` already carries the schedule.

**Gate:** `apps/dashboard/src/__tests__/admin-zillow-schedule.test.ts` (mock pattern of
`admin-zillow-auto.test.ts`): non-admin 403; bad hours 400; fixed write encrypts the CSV + audits +
refreshes both caches; hourly mode clears `auto_run_hours`; cap guard 400 → ack → 200; idempotent
re-save. Suite green.

### M3 — Dashboard UI: schedule editor in `AutomationPanel`
Inside the existing "Daily automation" card, a **Schedule** section (edit-in-place, Save/Cancel):
- Mode switch: **Fixed times** (default) · **Hourly window**.
- Fixed: a 24-chip hour picker (00–23, Chicago time, ":00"), presets **1×/day (10)**, **2×/day (10, 16)**,
  **3×/day (10, 16, 22) — recommended for Zapier free**, **4×/day (9, 12, 16, 20)**; live summary
  "**N×/day** at …", "next run …", and "≈ N×31 = **X broadcasts/month** of cap 96" turning amber when
  over (Save asks for the acknowledgement M2 requires). Runs-per-day is **derived** from the chips.
- Hourly: two selects (start/end) + summary "every hour from … to …".
- Fine print: ":00 only · Chicago time · runs only fire while this Mac is awake · a change takes
  effect at the next :00 · missed runs are not caught up".
- Fix stale copy: "it retries hourly" → "it retries at the next scheduled run" in fixed mode.
- Saves → banner "Schedule: 3×/day at 10:00, 16:00, 22:00 (live now)" and re-fetch status.

**Gate:** component renders from `schedule` (test with the panel's fetch mocked: chips reflect
status, preset click updates summary/estimate, Save posts the exact body, cap warning shows for 4×);
`next build` clean; manual: change 10,16,22 → 10,16,22 (no-op save) and → 9,15,21 and back, watching
`auto-status` and the audit log.

### M4 (optional, owner decision) — Scrape-only extra hours
`zillow.auto_scrape_hours` (CSV): hours that **import only** (no batch, no Zapier task, no texts).
`runDailyAutomation`: scheduled tick with hour ∈ scrapeHours ∖ runHours → import → finish `done`,
skip send. UI: second chip row "Also refresh the leads list (no texting) at …". Tests: scrape-only
hour creates a `ZillowAutoRun` row with `queuedSends 0` and no `TextEmAllBatch`; overlap with a run
hour = normal run. Skip if not wanted — nothing else depends on it.

### M5 — Live gate, docs, memory, commit
1. **Live gate without spending a Zapier task:** set `textemall.trigger_armed=false` (batch ends
   `uploaded`, not fired), set the schedule to include the **next :00 hour**, watch the tick create the
   slot row and the panel's "next run" roll forward; then restore the schedule and re-arm. Verify
   `auto-status` in the panel matches `getAutoStatus` and the `AuditLog` row.
2. Docs: `zillow-textemall-workflow.md` (schedule editor + free-tier math), `docs/iris-zillow-supervisor.md`
   (M0), `INTAKE_QA_OPS.md` untouched.
3. Commit per milestone by explicit path (the tree is shared with other sessions — never `git add -A`);
   deploy with the launchd restart sequence in `remove-engaged-number-cap-plan.md` M2b, outside
   09:30–09:40 and the first 5 min of any scheduled hour.

## 4. Risks / decisions to confirm
- **Zapier budget:** anything above 3×/day exceeds 96/month at full utilisation; the editor warns and
  requires acknowledgement rather than forbidding — confirm you want it soft, not hard.
- **Supervisor no longer heals a missed run in fixed mode** (it only notifies) — consistent with the
  "accept skips" decision; confirm.
- **Hour granularity** is a product limit of this plan (:00 only).
- **Two schedules (M4)** add a second thing to reason about; default is off.

## 5. Files touched
| File | Milestone |
|---|---|
| `apps/server/scripts/zillow-auto-supervise.ts`, new `services/zillow-supervise-logic.ts` (+test), `docs/iris-zillow-supervisor.md` | M0 |
| `packages/shared/src/zillow-schedule.ts` (+test), `apps/server/src/services/zillow-auto.ts` (+test) | M1 |
| `apps/dashboard/src/app/api/admin/zillow/schedule/route.ts` (+test), `auto-toggle/route.ts` (refresh) | M2 |
| `apps/dashboard/src/app/admin/zillow/AutomationPanel.tsx` (+test) | M3 |
| `zillow-auto.ts`, panel, tests | M4 (optional) |
| `zillow-textemall-workflow.md`, memory | M5 |
