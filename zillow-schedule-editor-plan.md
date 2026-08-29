# Dashboard-editable Zillow schedule (run times + runs/day) — Plan (rev. 4, stress-tested four times)

## Stress-test findings folded into rev. 2 (2026-08-28)

| # | Claim tested | Evidence | Change |
|---|---|---|---|
| 1 | "Today's 09:30 run was the supervisor" | Iris cron log `~/.iris/cron/runs/55c8cbe0.jsonl`: run `2026-08-28T14:30:05Z` (09:30:05 CDT), finished 14:30:24Z, result *"today's run failed — textemall upload failed"*; `ZillowAutoRun` slot `T09` started 09:30:07. **Confirmed.** It also re-triggers on `failed`/`needs_login`, not just on a missing row. | M0 unchanged in intent; notify-only must cover all three conditions in fixed mode. |
| 2 | "Dashboard can refresh the server cache instantly" | `proxyToServer` (`lib/zillow-admin.ts`) sends `x-relay-secret` from config to `http://127.0.0.1:${SERVER_PORT}`; `.env` sets 3005 and the launcher exports it. Existing `refresh-config` route already does this for SMS relay. **Holds.** | Adding the call to `auto-toggle` changes its test expectations (`admin-zillow-auto.test.ts` asserts fetch/upsert counts) — update them in M2. |
| 3 | "M3 gate = component tests" | Dashboard has **no** `.tsx` tests, no jsdom, no Testing Library. **Not runnable as written.** | M3 gate rewritten: pure-logic module with vitest tests + manual/browser gate. Adding jsdom+RTL is out of scope. |
| 4 | "M5 disarmed live gate spends no Zapier task and is side-effect-free" | `runDailyAutomation` still calls `setGroupViaApi` (clears the live Text-Em-All group, adds the batch phones) before `fireTextEmAllTrigger` refuses (not armed) → batch row `uploaded`. And an `uploaded` batch in a slot makes the `already` check **skip that slot's real broadcast**. | Gate rewritten: use a non-run hour, accept the group rewrite (identical to a normal run minus the fire), remove the hour afterwards. |
| 5 | Hourly-window mode + Text-Em-All | In hourly mode broadcasts happen **once/day at `textemall_broadcast_hour`** (default 12, CLI-only, no editor anywhere). An "hourly" editor that hides this would mislead. | M3 shows/edits the broadcast hour in hourly mode. |
| 6 | Unsetting `auto_run_hours` | `parseRunHours("")` → null, so writing a blank value is equivalent to deleting the row and keeps a single `upsert` path (the route-test mock only has `upsert`). | M2 writes `""` instead of deleting. |
| 7 | Single source for the cap default | `96` lives only in `zillow-auto.ts` (`clampCount(..., 96)`). | Shared `DEFAULT_MONTHLY_FIRE_CAP` in the new helper, imported by the engine. |
| 8 | Second cadence renderer | `admin/zillow/page.tsx` lines 403–406 build their own label from `runHours`/`startHour`. | Both render the server-computed `schedule.label`. |
| 9 | DST | Chicago transition nights: hour 2 is skipped (spring) or repeats (fall); the unique slot prevents a double run. | Fine print in M3; no code. |
| **10 (rev. 3)** | rev. 2's M0 kept the supervisor at a fixed 09:30 | A once-a-day check at 09:30 can never detect a **missed 10:00 (or 16:00, 22:00) run** — it runs before them. And any BullMQ-based watchdog is down exactly when the tick is down (Redis). | **M0 rewritten at the root:** an in-process `setInterval` watchdog (same pattern as the relay sweep, deliberately not BullMQ) checks each scheduled hour at HH:30 and notifies (never triggers); the Iris 09:30 cron becomes liveness + yesterday's digest only. |
| **11 (rev. 3)** | "batch already exists → skip broadcast" | `zillow-auto.ts:244` skips on **any** batch status. A `failed` (upload error) or `built` (crashed) batch blocks its key for good: in hourly-window mode a failed 12:00 broadcast is never retried that day; today's `T10` batch is exactly that state. Tests only depend on `uploaded`/`sent` blocking (default trigger mock is `not_armed` → `uploaded`). | M1: skip only when `already.status ∈ {sent, uploaded}`; rebuild on `built`/`failed`. Test added. |
| **12 (rev. 3)** | Single writer | `auto-toggle` also accepts `startHour`/`endHour` (the UI never sends them) → two routes can write the same keys. | M2: remove hour handling from `auto-toggle`; `schedule` is the only writer of `auto_run_hours`/`auto_start_hour`/`auto_end_hour`/`textemall_broadcast_hour`. |
| **14 (rev. 4)** | rev. 3's watchdog checked "HH:30, is there a row for HH?" | Two false-alarm paths: (a) the Mac wakes at 10:38 → BullMQ promotes the overdue 10:00 job → the run happens at 10:38, *after* the 10:30 check said "missed"; (b) a long sleep (09:55→11:40) means the 10:30 moment never occurs at all, so the miss is never reported. | Watchdog evaluates a slot only once its hour has **fully passed** (at HH+1:05), and on every tick evaluates **every** unevaluated scheduled slot since the last one it judged (bounded 24 h) — a sleep of any length still yields exactly one report per missed slot. |
| **15 (rev. 4)** | "Redis down" was folded into "Mac asleep" | Verified in `index.ts` 86–101: without Redis the server **stays up** (registration races a 10 s timeout, warns, continues) and the tick silently never fires — indefinitely, until a restart with Redis up. The scheduler's `registry` (module-private) records `lastRunAt` per job; the hourly tick updates it **every hour** even outside run hours (`not_in_window` still counts as a run). | Export `getJobState(name)` from `jobs/scheduler.ts`. Watchdog + `getAutoStatus().schedulerOnline` = job registered **and** `lastRunAt` within the last 65 min. Offline → a distinct message ("scheduler offline — no scheduled runs will fire until restart with Redis up") and a red banner in the panel. This is the root cause the schedule editor would otherwise hide behind a healthy-looking "next run 16:00". |
| **16 (rev. 4)** | Notification volume | Hourly-window mode can miss 15 slots/day on a sleeping Mac. | Consecutive misses collapse into one notification per streak; the streak closes on the next successful run. |
| **17 (rev. 4)** | Stale `running` rows | A crash mid-run leaves `running`; `claimSlot` treats it as reclaimable after `STALE_RUNNING_MS`, but nothing reports it. | Watchdog treats `running` older than `STALE_RUNNING_MS` as crashed → notify. |
| **18 (rev. 4)** | `index.ts` is contended | The `individual-relay-and-key-reveal` branch (committed, unmerged) also edits `index.ts`'s job list. | M0 adds one line (`startZillowWatchdog(...)`) next to `startRelaySweep` — outside the job array — to keep the merge trivial. |
| **13 (rev. 3)** | Early-morning hours | A run at 03:00 only happens if the Mac is awake; the UI note alone is easy to miss. | M3: soft hint on hours 00–06 ("this Mac is usually asleep — will be skipped"). |


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
  `describeSchedule(...)` → one `label` string, and `DEFAULT_MONTHLY_FIRE_CAP = 96` (moved out of
  `zillow-auto.ts`) — used by the dashboard route (validation), by `getAutoStatus` (labels), and by
  the engine (cap), so the panel and the engine can never disagree.
- One new dashboard route `POST /api/admin/zillow/schedule` (admin-only, encrypt + `AuditLog`
  `zillow_schedule` + cache clear **in both processes** via `proxyToServer("/internal/config/refresh")`).
- `getAutoStatus()` gains a `schedule` block the panel renders; `autoHour` becomes the **first run
  hour** in fixed mode (what "the day's first run" means now) — this is also what the supervisor needs.

---

## 3. Milestones

### M0 — Schedule-aware supervision, in-process (root fix; ship before anything else)
**Why in-process:** the thing that most often stops a scheduled run is Redis/BullMQ being down or
the Mac asleep at :00 — so the check must not run on BullMQ, and it must run *after every scheduled
hour*, not once at 09:30.

- New `apps/server/src/services/zillow-watchdog.ts`, started from `index.ts` with one line next to
  `startRelaySweep` (a plain `setInterval`, 60 s, `unref` — deliberately not BullMQ, exactly like the
  relay sweep). Each tick:
  1. **Scheduler liveness:** `getJobState("zillow-daily")` (new export from `jobs/scheduler.ts`:
     `{ registered, lastRunAt, lastError }`). Online = registered **and** `lastRunAt` within 65 min
     (the hourly tick updates it every hour, run hour or not). Offline → notify once per outage
     *"Zillow scheduler offline (Redis) — no scheduled runs will fire until the server restarts with
     Redis up"*; back online → one "recovered" note.
  2. **Slot evaluation, only for hours that have fully passed:** at or after HH+1:05, evaluate every
     scheduled slot (fixed hours, or the hourly window) between the last evaluated slot and HH,
     bounded to the last 24 h — so a sleep of any length yields exactly one verdict per slot, and a
     late-but-in-hour run (Mac woke at 10:38, BullMQ promoted the overdue 10:00 job) is never
     reported as missed. Verdicts: no row → *missed (Mac asleep at :00, or scheduler offline)*;
     `failed` → the error; `needs_login` → the Safari sign-in message; `running` older than
     `STALE_RUNNING_MS` → crashed; hourly-window + Text-Em-All → also the broadcast hour's batch.
  3. **Notification discipline:** consecutive misses collapse into one notification per streak
     (closed by the next successful run); one notification per failed/needs_login slot; the
     in-memory "last evaluated slot" resets on restart, so at most one duplicate report after a
     restart (accepted — persisting it buys nothing). `notifyOnMac(text, title = "Tenant AI relay")`
     gains the optional title so these read "Tenant AI Zillow".
  It **never** calls `runDailyAutomation` (missed slots are accepted — decided 2026-08-27). Pure
  `decideWatchdog(input)` exported for tests; the interval only feeds it.
- `apps/server/scripts/zillow-auto-supervise.ts` (Iris cron 09:30) is demoted to **liveness +
  digest**: server unreachable → notify; otherwise summarise yesterday (runs per scheduled hour,
  failures, `needs_login`, deferred-queue age). It **never POSTs `/internal/zillow/auto-run`** again
  (that POST bypassed the run-hours gate and caused today's 09:30 run). `getAutoStatus().autoHour`
  = first scheduled hour (fixed) / `startHour` (hourly), kept for back-compat only.
- Copy fixes everywhere ("retries hourly" → "retries at the next scheduled run"); update
  `docs/iris-zillow-supervisor.md` (no 09:00 window, no triggering).

**Gate:** unit tests for `decideWatchdog` (scheduled hour with no row → one report, only after
HH+1:05; long gap → one report per missed slot, none for unscheduled hours; late-in-hour run → no
report; failed/needs_login/stale-running messages; streak collapse; scheduler offline/recovered once
each; `lastRunAt` 64 min = online, 66 min = offline) and for the supervisor digest (never fetches
`auto-run`). Live: (a) at the first HH+1:05 after an unscheduled hour the log shows the watchdog
tick and no notification; (b) **sleep test** — put the Mac to sleep across a scheduled :00 with the
trigger disarmed, wake it inside the hour → the run happens late and the watchdog stays silent;
wake it after the hour → exactly one "missed" notification; (c) stop Redis for 70 min on a non-run
stretch → one "scheduler offline" notification, panel banner red, one "recovered" after restart;
(d) tomorrow 09:30 → **no `T09` row**.

### M1 — Server: schedule model + status
- `packages/shared/src/zillow-schedule.ts` (helpers above) + tests (parse/normalize, estimates,
  labels incl. wrap-to-tomorrow and DST-agnostic hour math).
- `zillow-auto.ts`: `getAutoStatus()` returns
  `schedule: { mode: "fixed"|"hourly", hours, startHour, endHour, runsPerDay, timezone:
  "America/Chicago", nextRunLabel, monthlyEstimate, monthlyCap, channel, capWarning: boolean }` and
  `schedulerOnline: boolean` (from `getJobState`, same rule as the watchdog).
  Existing fields stay (panel back-compat). `autoConfig()` unchanged (parseRunHours stays).
- `runDailyAutomation`: the broadcast idempotence check skips only when the existing batch is
  `sent` or `uploaded`; `built`/`failed` batches are rebuilt (a crashed or upload-failed broadcast is
  retried by the next in-window tick in hourly mode, and by a same-slot reclaim in fixed mode).
  Existing idempotence tests are unaffected (they produce `uploaded`/`sent`); add "failed batch →
  rebuilt on the next tick" and "sent batch → still skipped".

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
- Writes: fixed → `zillow.auto_run_hours = "h,h,h"`; hourly → write `auto_run_hours = ""` (blank
  parses to null = hourly mode; one `upsert` path, no delete) plus `auto_start_hour`/`auto_end_hour`
  and, when the channel is Text-Em-All, `zillow.textemall_broadcast_hour`. Encrypt via the `auto-toggle` pattern; `AuditLog`
  `zillow_schedule` with before/after; `clearConfigCache()` + `proxyToServer("/internal/config/refresh")`
  so the engine picks it up **immediately** (also add that proxy call to `auto-toggle`, which today
  waits up to 60 s — and update `admin-zillow-auto.test.ts`, which asserts exact `fetch`/`upsert`
  call counts on the toggle route).
- Single writer: remove the `startHour`/`endHour` handling from `auto-toggle` (the UI never sent
  them); `schedule` is the only route that writes `auto_run_hours`, `auto_start_hour`,
  `auto_end_hour`, `textemall_broadcast_hour`.
- `GET` variant not needed — `auto-status` already carries the schedule.

**Gate:** `apps/dashboard/src/__tests__/admin-zillow-schedule.test.ts` (mock pattern of
`admin-zillow-auto.test.ts`): non-admin 403; bad hours 400; fixed write encrypts the CSV + audits +
refreshes both caches; hourly mode clears `auto_run_hours`; cap guard 400 → ack → 200; idempotent
re-save. Suite green.

### M3 — Dashboard UI: schedule editor in `AutomationPanel`
Inside the existing "Daily automation" card, a **Schedule** section (edit-in-place, Save/Cancel):
- Red banner when `schedulerOnline` is false: "Scheduled runs are NOT firing (scheduler offline —
  Redis). Restart Tenant AI with Redis up." — shown above the schedule so a saved schedule is never
  mistaken for a working one.
- Mode switch: **Fixed times** (default) · **Hourly window**.
- Fixed: a 24-chip hour picker (00–23, Chicago time, ":00"), presets **1×/day (10)**, **2×/day (10, 16)**,
  **3×/day (10, 16, 22) — recommended for Zapier free**, **4×/day (9, 12, 16, 20)**; live summary
  "**N×/day** at …", "next run …", and "≈ N×31 = **X broadcasts/month** of cap 96" turning amber when
  over (Save asks for the acknowledgement M2 requires). Runs-per-day is **derived** from the chips.
- Chips 00–06 carry a soft hint ("this Mac is usually asleep — a run here will be skipped");
  selecting one is allowed.
- Hourly: two selects (start/end) + summary "scrapes every hour from … to …" and, when the
  channel is Text-Em-All, a **Broadcast at** hour select (`textemall_broadcast_hour`, default 12)
  with the summary "texts new leads once a day at HH:00" — without this the word "hourly" would
  misdescribe when texts go out.
- Fine print: ":00 only · Chicago time · runs only fire while this Mac is awake · a change takes
  effect at the next :00 · missed runs are not caught up · on DST nights the 02:00 slot may be
  skipped".
- Both the panel and the page header (`page.tsx` 403–406) render the server's `schedule.label` —
  delete the two hand-built label expressions.
- Fix stale copy: "it retries hourly" → "it retries at the next scheduled run" in fixed mode.
- Saves → banner "Schedule: 3×/day at 10:00, 16:00, 22:00 (live now)" and re-fetch status.

**Gate (no component-test harness exists — none is added):** all editor logic lives in a pure
module `admin/zillow/schedule-ui.ts` (`applyPreset`, `toggleHour`, `summaryFor`, `estimateFor`,
`bodyFor`) with vitest unit tests (presets, toggling, 4× → warning, body shape); the `.tsx` is a thin
renderer. `next build` clean. Manual browser gate: change 10,16,22 → 10,16,22 (no-op save) and →
9,15,21 and back, watching `auto-status`, the header label, and the `AuditLog` row.

### M4 (optional, owner decision) — Scrape-only extra hours
`zillow.auto_scrape_hours` (CSV): hours that **import only** (no batch, no Zapier task, no texts).
`runDailyAutomation`: scheduled tick with hour ∈ scrapeHours ∖ runHours → import → finish `done`,
skip send. UI: second chip row "Also refresh the leads list (no texting) at …". Tests: scrape-only
hour creates a `ZillowAutoRun` row with `queuedSends 0` and no `TextEmAllBatch`; overlap with a run
hour = normal run. Skip if not wanted — nothing else depends on it.

### M5 — Live gate, docs, memory, commit
1. **Live gate without spending a Zapier task** — with its side effects stated: set
   `textemall.trigger_armed=false`, add the **next :00 hour that is NOT a real run hour** to the
   schedule via the editor, watch the tick create the slot row and "next run" roll forward, then
   remove that hour and re-arm. What the gate still does for real: a Safari scrape, and (if there are
   new leads) `setGroupViaApi` **clears and rewrites the live Text-Em-All group** to the current new
   leads and leaves a `TextEmAllBatch` row `uploaded` — exactly a normal run minus the fire; the leads
   stay `new` and go out at the next armed run. Never gate on a real run hour: an `uploaded` batch in
   that slot makes the engine **skip that slot's real broadcast**. Verify `auto-status` in the panel
   matches `getAutoStatus` and the `AuditLog` row.
2. Docs: `zillow-textemall-workflow.md` (schedule editor + free-tier math), `docs/iris-zillow-supervisor.md`
   (M0), `INTAKE_QA_OPS.md` untouched.
3. Commit per milestone by explicit path (the tree is shared with other sessions — never `git add -A`);
   deploy with the launchd restart sequence in `remove-engaged-number-cap-plan.md` M2b, outside
   09:30–09:40 and the first 5 min of any scheduled hour.

## 4. Risks / decisions to confirm
- **Zapier budget:** anything above 3×/day exceeds 96/month at full utilisation; the editor warns and
  requires acknowledgement rather than forbidding — confirm you want it soft, not hard.
- **Nothing heals a missed run any more** (watchdog + supervisor only notify) — consistent with the
  "accept skips" decision; confirm. If you later want catch-up, it is one flag in the watchdog.
- **Hour granularity** is a product limit of this plan (:00 only).
- **Two schedules (M4)** add a second thing to reason about; default is off.

## 5. Files touched
| File | Milestone |
|---|---|
| new `apps/server/src/services/zillow-watchdog.ts` (+test), `jobs/scheduler.ts` (`getJobState`), `services/messages-relay.ts` (`notifyOnMac` title), `index.ts` (one line), `scripts/zillow-auto-supervise.ts` (digest only, +test), `docs/iris-zillow-supervisor.md` | M0 |
| `packages/shared/src/zillow-schedule.ts` (+test), `apps/server/src/services/zillow-auto.ts` (+test) | M1 |
| `apps/dashboard/src/app/api/admin/zillow/schedule/route.ts` (+test), `auto-toggle/route.ts` (refresh) | M2 |
| `apps/dashboard/src/app/admin/zillow/AutomationPanel.tsx` (+test) | M3 |
| `zillow-auto.ts`, panel, tests | M4 (optional) |
| `zillow-textemall-workflow.md`, memory | M5 |

## Execution record (2026-08-29, worktree `~/tenant-ai-wt/zillow-schedule`, branch `zillow-schedule-editor` off `main` 2199898)

Built in an isolated git worktree because another session was building in `~/tenant-ai`; per-milestone
commits by explicit path; stress-tested at each milestone.

| Milestone | Commit | Result / stress test |
|---|---|---|
| Worktree setup | — | `npm ci` 13 s; **Prisma client had to be generated** (`prisma generate`) and `apps/server/.env` + `apps/dashboard/.env` copied — the generated client records the env path at generate time, so generate AFTER copying. Baseline 59/59 on the three Zillow suites. |
| **M0** watchdog + supervisor | `9d147fe` | 14 + 7 tests; tsc clean. Live dry-runs against the real DB/server with notifications stubbed: watchdog judged one settled slot and (correctly, out-of-process) reported "scheduler OFFLINE"; supervisor script → `all clear (yesterday 4 run(s) ok)`. **Root fix found by the dry-run:** the live (old) server's status has no `slot` field → the per-slot digest would have false-alarmed at 09:30 before the restart → day-level fallback added + test. |
| **M1** shared model + status + batch fix | `0ea360c` | 68/68 across M0/M1 suites. **Mutation check:** restoring the any-status skip makes the new "failed batch is rebuilt" test fail (×). Full suite 1904 pass; the 5 `textemall-csv` failures are **pre-existing on main** (the other session's "owner check number" commit changed `buildTextEmAllCsv` without updating its tests — left alone, their area); `billing-cycle` is a parallel-run flake (passes alone in both trees). |
| **M2** schedule route | `4f58eec` | 8 route tests + toggle suite (18/18). |
| **M3** editor | `21f1d62` | 7 pure-logic tests; dashboard Zillow suites 35/35; `next build` clean; smoke-served on :3100 (login 200, `/admin/zillow` 307→login). **Bug caught in self-review:** `load`'s stale `useCallback` closure would have wiped unsaved edits on every reload → ref mirror. |
| **M4** scrape-only hours | — | Not built (optional; owner has not asked). |
| **M5** docs / deploy | this commit | `zillow-textemall-workflow.md` section; deploy via fast-forward merge into `main` + launchd restart (see below). |
