# Zillow → Text-Em-All lead workflow — full description (for a Windows port)

This document describes the complete automated workflow so it can be replicated on
another machine (Windows tenant-ai + Windows Iris). It is written for the Claude
doing the port: it names the actual files/functions/config on the macOS original and
flags every platform-specific piece that must be re-implemented for Windows.

---

## 0. One-paragraph summary

Three times a day the server scrapes new rental leads from an open Zillow Rental
Manager browser tab, keeps only leads that are genuinely new (never-before-seen,
created after a go-live baseline), writes them to a CSV, drives the Text-Em-All web
app **through the Iris agent** to wipe a standing contact group and import that CSV,
then fires a Google Form whose "New Response" triggers a Zapier Zap that tells
Text-Em-All to broadcast a templated SMS (an application-link message) to that group.
Everything is idempotent per time-slot, capped to stay inside free tiers, and fully
reversible via config. The separate Twilio phone number (inbound calls/texts) is a
different code path and is untouched by this workflow.

---

## 1. End-to-end data flow

```
BullMQ cron "0 * * * *" (hourly tick)
   │
   ▼  runDailyAutomation()  [apps/server/src/services/zillow-auto.ts]
   ├─ gate: enabled? and is now.getHours() ∈ auto_run_hours (10,16,22)?   → else stop
   ├─ claim the per-hour slot "YYYY-MM-DDTHH" (ZillowAutoRun.slot @unique) → dedup double-ticks
   │
   ├─ STEP 1  SCRAPE .......... runZillowImport() → runZillowExtraction()   [Safari via osascript]  ★PLATFORM
   ├─ STEP 2  DEDUPE ......... ingestLeads(): new vs seen, baseline age gate  → set of NEW leads
   │
   └─ send channel == "textemall"?
         ├─ STEP 3  BUILD CSV ... buildTextEmAllCsv()  → ~/tenant-ai/textemall-uploads/leads-<date>.csv
         ├─ (guard) per-slot already sent? monthly cap hit? empty batch? → skip
         ├─ STEP 4  UPLOAD ...... irisUploadToGroup() under withGuiLock()   [Iris drives the browser]  ★PLATFORM
         │             clears the Text-Em-All group, imports the CSV, verifies count == N
         ├─ STEP 5  FIRE ........ fireTextEmAllTrigger()  → HTTP POST to a Google Form /formResponse
         │             Google Form "New Response" ─► Zapier Zap ─► Text-Em-All "Send Broadcast" to the group
         └─ STEP 6  RECORD ...... stamp TextEmAllBatch status "sent", flip leads sentVia="textemall"
```

★PLATFORM = macOS-specific, must be re-implemented for Windows (see §8).

The relay/Twilio path (when `send_channel` != "textemall") uses
`sendSurveyBatch()` to text via macOS Messages.app — **irrelevant to this port**;
Text-Em-All replaces it.

---

## 2. The scheduled tick & gating  (zillow-auto.ts)

- **Trigger:** a BullMQ job `zillow-daily` with cron `0 * * * *` — fires once an hour.
  The cron is in-process (BullMQ + Redis), so it is **cross-platform**; only the
  process-keepalive around it is OS-specific (macOS launchd → Windows service/Task
  Scheduler; see §8).
- **Run-hours gate:** config `zillow.auto_run_hours = "10,16,22"`. `parseRunHours()`
  parses/sorts/clamps it. A scheduled tick runs **only** when `now.getHours()` is in
  that set. If `auto_run_hours` is unset it falls back to a legacy hourly window
  `[auto_start_hour, auto_end_hour]` (default 8–22).
- **Enabled switch:** `zillow.auto_enabled = "true"` (the manual go-live master switch).
- **Per-slot idempotence:** each run claims a slot string `"YYYY-MM-DDTHH"` in table
  `ZillowAutoRun` (`slot @unique`). A second tick in the same hour loses the claim and
  exits — so at most one run per hour.
- **Missed slot = accepted:** if the machine is asleep exactly at 10/16/22, that run is
  simply skipped (no catch-up). This is deliberate.

---

## 3. STEP 1 — Scrape  ★PLATFORM  (zillow-import.ts → zillow-extract.ts)

- `runZillowImport()` calls `runZillowExtraction()`, wrapped in `withGuiLock()` so the
  scrape and the later Iris upload never drive the GUI at the same time.
- **macOS mechanism:** it shells out to **`osascript`** (AppleScript). The script walks
  Safari's open windows/tabs, finds a tab whose URL contains
  `zillow.com/rental-manager`, and runs injected JavaScript in that tab
  (`do JavaScript ... in t`) to read the leads out of the page DOM.
- **Hard requirement:** a Safari tab must already be **open and logged in** to Zillow
  Rental Manager. The scrape does **not** log in; it drives the human's live session.
  If no such tab is open → the run fails (osascript error). If logged out → the page has
  no data → treated as `needs_login`.
- Also requires Safari ▸ Develop ▸ **"Allow JavaScript from Apple Events"** enabled.

  ► **Windows port:** there is no osascript/Safari-AppleScript. Re-implement the scrape
  to read the same Rental Manager page in a Windows browser. Options, roughly in order
  of robustness: (a) have **Iris drive the browser** and return the extracted leads
  (same pattern as the upload step — Iris opens/activates the logged-in Rental Manager
  tab and reads the leads); (b) a Playwright/Puppeteer script attached to a logged-in
  Edge/Chrome profile that injects the same reader JS; (c) the CDP protocol against a
  browser started with a debugging port. Keep the same contract: **return an array of
  `{name, phone, propertyText, ...}`** and keep the "must already be logged in" model
  (don't store Zillow credentials).

---

## 4. STEP 2 — Dedupe to genuinely-new leads  (zillow-import.ts `ingestLeads`)

- Each scraped lead is matched against the DB. Dedupe key: phone (E.164) when present,
  else a lowercased-name key. Address/property is stored as raw text.
- **`createdAt` is set once and never touched again** — this is the linchpin of the
  "only new" guarantee. Re-importing the same lead never bumps its `createdAt`.
- **Go-live baseline:** config `zillow.auto_baseline` (an ISO date). The batch only
  considers leads with `createdAt >= baseline`. This is how the ~200 pre-existing leads
  are permanently excluded — they were created before the baseline.
- **Sticky statuses:** {invited, applied, opted_out} are never reset by a re-import.
- Result: a set of leads with `status = "new"` and `createdAt >= baseline` that have not
  yet been sent.

  ► **Windows port:** identical (pure DB logic, cross-platform). Give the Windows
  instance its **own** baseline for its own go-live moment.

---

## 5. STEP 3 — Build the CSV  (textemall-csv.ts `buildTextEmAllCsv`)

- Selects: `status="new"`, `phone` not null, `createdAt >= baseline`, minus anyone on
  the SMS opt-out list, minus any phone already present in a **sent** `TextEmAllBatch`
  (so a later run never re-sends the same person).
- Writes `Name,Phone` rows to **`~/tenant-ai/textemall-uploads/leads-<date>.csv`**.
- **Must be a NON-hidden folder.** (Originally it was `~/tenant-ai/.textemall/`; the
  macOS Open dialog cannot see dot-folders, which stalled the Iris import. Root fix:
  visible folder.)
- Empty batch (0 rows) → returns count 0 and the workflow skips everything downstream
  (no group wipe, no upload, no broadcast).

  ► **Windows port:** write to a visible path, e.g.
  `C:\Users\<you>\tenant-ai\textemall-uploads\leads-<date>.csv`. Same non-hidden rule.

---

## 6. STEP 4 — Iris drives Text-Em-All to load the CSV  ★PLATFORM  (textemall-iris.ts)

The server does **not** call a Text-Em-All API (there isn't a usable one for this). It
launches the **Iris agent** to operate the Text-Em-All web app like a human. Runs inside
`withGuiLock()` (mutex shared with the scrape).

- `irisUploadToGroup({csvPath, group, expectedCount})` shells out to the Iris CLI:
  `iris -p "<goal>" --permission-mode dangerFullAccess --max-turns 140`
  (binary from env `IRIS_BIN` or `iris` on PATH).
- `buildIrisUploadGoal()` produces a natural-language goal telling Iris to:
  1. Ensure the browser is on `app.text-em-all.com`; a login screen → print `RESULT: needs-login` and stop.
  2. Open the group named exactly `<group>` (config `zillow.textemall_group`, e.g. "1. Leads 08/27/2026"). **Do not** open any other group (e.g. "Everyone").
  3. If already empty, skip the clear. Otherwise **remove contacts one by one**
     (contact → More Actions → Remove From Group → confirm) until 0. (Text-Em-All's group
     view has no select-all, so bulk clear is not attempted — the group only ever holds
     the previous small batch, so this is cheap.)
  4. Import the CSV into that same group: **Upload File** → in the OS file dialog press
     **⌘⇧G**, type the exact CSV path, Enter, open. Map columns to Name/Phone → Import.
  5. Read the post-import contact count and **immediately** print `RESULT: count=<N>`.
  6. If `N == expectedCount` print `RESULT: ok`, else `RESULT: failed`.
- `parseIrisResult(output, expectedCount)` is **resilient**: `needs-login` anywhere →
  needs_login; a final `RESULT: ok` → ok; **a `RESULT: count=<N>` equal to expected → ok
  even if Iris ran out of turns before the final marker** (this fixes a real
  false-negative where a completed upload looked failed); count mismatch or no marker →
  failed. `irisUploadToGroup` never throws — it returns a status.
- Strict ordering: upload → verify ok → fire trigger → **stamp batch "sent" before
  flipping leads**, so a failure anywhere before the trigger sends nothing and flips no
  leads.

  ► **Windows port — the biggest change:**
  - **⌘⇧G is macOS-only.** In the Windows file-open dialog, paste the path into the
    "File name" box (or press the address-bar/`Ctrl+L` where applicable) and Enter.
    Update the goal text accordingly.
  - **Iris must run on Windows** and be able to drive the interactive desktop
    (logged-in session, browser open, screen not locked). Same "logged into Text-Em-All"
    requirement as the scrape.
  - Keep the `RESULT: needs-login | count=<N> | ok | failed` protocol **verbatim** —
    the parser depends on those exact tokens.
  - Verify Text-Em-All's group-view UI verbs on Windows match the goal ("More Actions",
    "Remove From Group", "Upload File", "Import", the count badge). Adjust wording if the
    web UI differs, but the flow is the same.

---

## 7. STEP 5 — Fire the broadcast trigger  (textemall-trigger.ts)

- Text-Em-All is told to send via a **Google Form → Zapier** bridge (no direct API):
  `fireTextEmAllTrigger({count})` builds a URL-encoded body and **POSTs to the Google
  Form's `/formResponse` endpoint**. A "New Response" on that form is the trigger for a
  Zapier Zap whose action is Text-Em-All **"Send Broadcast"** to the fixed group with a
  fixed message (the application-link SMS) and Start Date = now.
- Form fields (Google Form entry IDs): a "ready?" multiple-choice that **must be the
  exact value `"Yes"`** (Google returns HTTP 400 on a case/value mismatch — a real bug we
  hit with lowercase "yes"); a DATE field sent as `entry.<id>_year/_month/_day`; and a
  count short-answer. Body also needs `fvv=1&pageHistory=0&submit=Submit`.
- **Two-key safety:** the live POST happens **only** when BOTH the caller passes
  `dryRun:false` AND config `textemall.trigger_armed = "true"`. Any other state returns a
  dry-run object and touches no network. This is what keeps test/dev runs from sending.
- The form endpoint + entry IDs live in `textemall-trigger.ts` as defaults, overridable
  by config (`textemall.trigger_endpoint`, `entry_ready`, `entry_date`, `entry_count`,
  optional `entry_token`/`trigger_token` for a Zapier Filter guard).

  ► **Windows port:** this step is **pure HTTP** and cloud-side — fully cross-platform,
  no code change. **BUT the Google Form + the Zap + the Text-Em-All group are shared
  cloud infrastructure.** See §9 — the Windows instance must use its **own** form + Zap +
  group, or the two machines will collide.
  ► **Security:** the form URL/entry IDs are effectively a public trigger. Anyone who has
  them can fire your broadcast. Protect with a secret token + a Zapier Filter step
  (`entry_token`+`trigger_token`), and don't commit the real IDs to a public repo.

---

## 8. STEP 6 — Record & flip  (zillow-auto.ts)

- Broadcast fired → stamp the `TextEmAllBatch` row (keyed by the per-slot key
  `"YYYY-MM-DDTHH"`, `slot @unique`) status **"sent"** *before* flipping leads.
- Then flip the batch's leads: `status → "invited"`, `sentVia = "textemall"`,
  `sentBatchId = <batch>`. Because Step 5 excludes already-sent phones, the next run's
  CSV automatically omits them.
- **Monthly soft cap:** config `textemall.monthly_fire_cap` (default 96). Before doing
  the Iris work, it counts `TextEmAllBatch` rows with status "sent" this calendar month;
  at/over the cap it refuses to fire (keeps you under Zapier's 100-task/month free tier;
  3 runs/day × 31 ≈ 93).

---

## 9. Config keys (all stored encrypted in the `SystemConfig` table, read via `resolveConfig(ns, key)`)

| Namespace | Key | Value / meaning |
|---|---|---|
| zillow | auto_enabled | "true" master switch |
| zillow | auto_run_hours | "10,16,22" (unset → legacy hourly window) |
| zillow | auto_start_hour / auto_end_hour | legacy window bounds (default 8 / 22) |
| zillow | auto_baseline | ISO date; only leads created on/after this are eligible |
| zillow | send_channel | "textemall" (else "relay" = the old Messages.app path) |
| zillow | textemall_group | exact Text-Em-All group name, e.g. "1. Leads 08/27/2026" |
| zillow | default_property_id | property leads are attributed to |
| textemall | trigger_armed | "true" required (with dryRun:false) to actually POST the form |
| textemall | monthly_fire_cap | default 96 |
| textemall | trigger_endpoint / entry_ready / entry_date / entry_count | override the Google Form defaults |
| textemall | entry_token / trigger_token | optional secret for a Zapier Filter guard |
| sms_relay | survey_mode | "google_form" (governs which link the text sends; must be google_form for the textemall channel) |

Helper to set one (macOS): `node --import tsx apps/server/src/scripts/set-config.ts <ns> <key> <value>` (encrypted upsert). The resolver only works after the server calls `initConfigResolver(prismaConfigStore)` at boot.

---

## 10. Shared cloud infrastructure — DO NOT let two machines collide

The Mac and the Windows box each have their **own** tenant-ai Postgres DB (independent
leads, baseline, batch history) — that part is safely isolated. But three things are
**cloud-shared singletons**:

1. **The Text-Em-All contact group** — both would clear+repopulate the same group.
2. **The Google trigger form** — both fire the same "New Response".
3. **The Zapier Zap** — one Zap, one bound group + message.

If both machines point at the same three, they will clobber each other's group and
double-broadcast. **The Windows replica must create its own:** a new Text-Em-All group,
a new Google trigger form, and a new Zap wiring that form→that group. Then set the
Windows `zillow.textemall_group` + `textemall.trigger_endpoint`/entry IDs to the new
ones. (Alternatively, if the two machines cover **different properties/Zillow accounts**
and you want them in one list, you'd need a shared-lock design — not currently built;
separate infra is far simpler.)

---

## 11. Windows porting checklist (the deltas)

- [ ] **Scrape (§3):** replace osascript/Safari with a Windows browser reader (Iris-driven
      or Playwright/CDP against a logged-in Edge/Chrome). Same output contract; keep
      "already logged in, don't store creds."
- [ ] **Iris upload (§6):** Iris runs on Windows and can drive the interactive desktop;
      change **⌘⇧G** to the Windows file-dialog path entry; keep the RESULT token protocol.
- [ ] **Paths:** CSV to a **visible** Windows folder (`C:\Users\<you>\tenant-ai\textemall-uploads\`).
- [ ] **Iris binary:** `IRIS_BIN` → `iris.exe` / the Windows launch command.
- [ ] **Keep-alive/scheduler:** macOS launchd → a Windows Service or Task Scheduler entry
      that keeps the tenant-ai server (and Redis/Postgres) running; the BullMQ cron itself
      is unchanged.
- [ ] **Own cloud infra (§10):** new Text-Em-All group + new Google form + new Zap; point
      Windows config at them.
- [ ] **Prereqs at run time (10/16/22):** the Windows session is unlocked and awake, a
      logged-in Zillow Rental Manager tab is open, and Text-Em-All is logged in.
- [ ] **Config:** set `auto_enabled`, `auto_run_hours`, `auto_baseline` (its own go-live
      date), `send_channel=textemall`, `textemall_group`, `trigger_armed`, and the form
      overrides.

---

## 12. Safety invariants to preserve (do not drop these in the port)

- A **real broadcast is irreversible** — only fire after the group is confirmed to hold
  exactly the intended numbers. The two-key guard (`dryRun:false` + `trigger_armed`) must
  stay.
- **Idempotent per slot** (one broadcast per 10/16/22) + **monthly cap** to protect the
  free tier.
- **Only-new guarantee** rests on `createdAt` being set-once + the baseline filter +
  excluding already-sent phones. Keep all three.
- **Relay/Twilio path is separate** and must remain untouched by the channel switch.
- The Google form trigger is a public-ish endpoint — guard it with a token/Filter and
  don't publish the real IDs.

## Editing the schedule (run times + runs/day) — added 2026-08-29

Admin → Zillow → **Daily automation → Schedule**. Two modes, saved via `POST /api/admin/zillow/schedule`
(the *only* writer of `zillow.auto_run_hours` / `auto_start_hour` / `auto_end_hour` /
`textemall_broadcast_hour`; encrypted, audit-logged as `zillow_schedule`, live in both processes at once):

- **Fixed times** (default): pick hours on the 24-chip row or a preset — 1×/day (10), 2×/day (10, 16),
  **3×/day (10, 16, 22) = Zapier-free-tier safe**, 4×/day (9, 12, 16, 20). *Runs per day is the number of
  chips selected.* Each run = scrape + broadcast (per-hour idempotent).
- **Hourly window**: scrape every hour from … to …; on the Text-Em-All channel the broadcast goes out
  **once a day at "Broadcast at"** (`textemall_broadcast_hour`, default 12:00).
- The summary shows `N×/day at …`, the next run, and **≈ N×31 broadcasts/month of cap 96**. On the
  Text-Em-All channel a schedule over the cap is refused until you click **Save anyway** — the monthly
  cap (`textemall.monthly_fire_cap`) remains the hard stop in the engine.
- Fine print: :00 only · Chicago time · runs fire only while the Mac is awake · a change takes effect at
  the next :00 · missed runs are not caught up · 00–06 chips are hinted as "usually asleep".

**Watchdog + supervisor (no more unscheduled runs).** An in-process watchdog (`zillow-watchdog.ts`,
plain `setInterval`, not BullMQ) judges each scheduled hour after it has fully passed and notifies on the
Mac ("Tenant AI Zillow") about runs that did not happen / failed / crashed / need a Safari login, and about
the scheduler going offline (Redis) — the dashboard shows a red **"Scheduled runs are NOT firing"** banner
in that case. The Iris 09:30 supervisor is liveness + yesterday's digest only and **never triggers a run**
(its old auto-run POST bypassed the schedule and caused the unscheduled 09:30 run on 2026-08-28).
