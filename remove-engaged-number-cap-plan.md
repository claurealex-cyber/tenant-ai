# Remove the Per-Phone Q&A Cap for Engaged Numbers — Plan (rev. 3, stress-tested twice)

## Execution record (2026-08-28, 13:30–13:50)

| Milestone | Result |
|---|---|
| **M1** code + tests | Done. `intake-qa.test.ts` **11/11** (was 10; cap test → "never capped" + deep-history fallback). Mutation check: with the old cap code restored the two new tests **fail** (2/11) — the tests have teeth. `tsc` clean (shared + server). Zero references to `qa_daily_cap_per_phone` / the over-cap copy left in `apps` + `packages`; `.env` never carried the env var. |
| **M2a** guard + suite + build | Full suite first run: 1852 pass / **4 fail** — all `zillow-import.test.ts`, the pre-existing failures. **Root-fixed** (see below) → full suite **1864/1864 green, 133 files**. `npx turbo build --force` OK (34 s). Built artifacts verified cap-free. |
| **M2a** guard finding | The `find -newer` guard listed files that are **not mine**: `services/individual-relay.ts`, `individual-trigger.ts`, `fire-ledger.ts`, `individual-iris.ts`, `jobs/individual-relay.ts`, two tests, a schema change + migration `20260828160000_textemall_fire_ledger`, and `index.ts` now registering `individualRelayJob`. That is the *Individual Text-Em-All relay* feature being built **concurrently by another Claude session (pid 4634, started 12:22)** in this same tree — files still changing at 13:39. Its plan says "no live test — protect the running relay". |
| **M2b** restart | **NOT DONE — deliberately.** A restart would boot that session's unfinished job (its migration is already applied, 17/17). The running server (pid 88086, 11:04 build) still has the old cap in memory; all four endpoints 200 after the in-place build. Deploy when that work is finished/committed, using the M2b sequence unchanged. |
| **M2c** live gate | Done at the **handler level** instead (the Telnyx signature can't be forged, and a direct relay send from a shell risks a misleading TCC failure): `handleSurveyIntake` from the *built* `dist` against the live DB + real OpenAI, no send, no writes. Test phone had **9 prior assistant replies** (past the old cap) → `shouldRespond: true`, `replyKind: "ai"`, form link appended, 2.2 s, conversation length unchanged 19/19. What it does **not** prove: delivery through the running server — that is unchanged code and was exercised at 12:55 today (`kind = ai`, `status = sent`). Final end-to-end confirmation = one text from the test phone **after** the restart. |
| **M2d** commit | Done by explicit path (7 files); the other session's files untouched. |
| **M3** | No work, as decided. `relay-guards.ts` has no diff. |
| **M4** docs | Done. |

**Root fix found by the M2 stress test — `zillow-import.test.ts` (4 pre-existing failures):**
`ingestLeads` dedupes by phone **globally** and keeps a lead's original property; the test's fixed fixture
phones therefore survived across runs, the teardown (`deleteMany({ propertyId })` of *this* run's property)
deleted nothing, the run-delete hit `ZillowLead_importRunId_fkey`, teardown aborted, and every run orphaned
its user + property (**24 users / 22 properties** had accumulated since Aug 27). Fix: purge by exact fixture
phones + `test_zillow_` prefix in `beforeAll`, tear down child-first by run/property/phone. That exposed a
second, environment-dependent defect: the census-flap case disabled intake on its own property to force the
"single intake property" fallback to `null`, which only holds when the DB has no *real* intake property —
with Ghem LLC 1 present the fallback resolved to it and the code (correctly) created a new lead. Fix: simulate
the flap as it happened live — add a stray second intake property so the fallback is ambiguous. Result:
19/19 twice in a row, zero residue. No fixture phone was ever texted (relay ledger checked).

**Hazard to note (not caused by, and not fixable from, this plan):** the launchd launcher rebuilds the *live
tree* on any crash-relaunch (`start.sh` → `npm run build` → `migrate deploy`). While another session has
unfinished work wired into `index.ts`, any crash of the running server deploys that work automatically.


**Owner rule (2026-08-28):** caps exist to protect the personal sending number when we text
*new* numbers. A number that has already texted us is **engaged** — a two-way conversation —
and must never be capped or silenced.

**Settings stay:** Reply style = **Link + Q&A** (`sms_relay.intake_style = link_and_qa`),
Survey link = **Google Form**. Nothing about the greeting/Q&A flow changes except the cap.

**Decision (owner, 2026-08-28): keep every new-number / volume cap.** Only the per-phone cap on
engaged numbers is removed. These stay exactly as they are (`services/relay-guards.ts` → `checkCaps()`):

| Cap | Default | Guards | Effect when hit |
|---|---|---|---|
| `new_recipient_cap` | 10 first-contact sends/day | texting **new** numbers | row `deferred`, sweep retries |
| `hourly_cap` / `daily_cap` | 10 / 50 (live) | personal-number send volume (links, forwards, caller links) | row `deferred`, sweep retries |
| `qa_hourly_cap` / `qa_daily_cap` | 10 / 40 | AI-reply volume from the personal number | row `deferred`, **never retried** → the texter gets nothing (see Risks) |
| `cooldown_minutes` | 60 | repeat outbound `link` sends to one number | row `failed: cooldown` |

Removed: **`qa_daily_cap_per_phone`** (`handlers/intake-qa.ts`) — the only cap that silences a
number that already texted in.

## What the investigation found (2026-08-28)

- Relay healthy; every text today reached the server (`POST /telnyx/sms → 200`) and was processed.
- `intake-qa.ts:61-72` enforces `qa_daily_cap_per_phone` (default 8; no `SystemConfig` row exists —
  verified): at exactly 8 prior assistant replies in the texter's `SmsConversation` → one "the team
  will follow up with you directly" note; beyond 8 → `shouldRespond: false` — no reply, no ledger
  row, no log line. The test phone crossed 8 at 12:55 pm → silence. The conversation's 24 h expiry
  resets on every text, so a busy texter never clears it.
- **This cap only ever applies to numbers that texted in** (the Q&A path is reached only from an
  inbound message). Under the owner rule it has no legitimate purpose → remove it outright; there is
  no non-engaged case to special-case.
- Two other engaged-number silencers exist and are **kept** deliberately: the OpenAI-down canned
  fallback de-dupe (one "team will get back to you", then silent until the API answers again) and
  the mid-call rule (a text from a phone currently on an AI call is injected into the call, not
  answered by SMS — that is what swallowed the 12:55:28 text today: the call started at 12:55:39).

## Risks accepted under the owner rule (stated so they are decisions, not surprises)

- **Global Q&A cap = silence for the texter.** `ai` rows deferred by `qa_hourly_cap`/`qa_daily_cap`
  are excluded from the sweep (`kind: { not: "ai" }` — a 40-minute-late answer is worse than none).
  The dashboard "Q&A replies today" counter and the ledger's *deferred* rows are the only signal.
- **Bot ping-pong.** An auto-responder on the far end (out-of-office SMS bot, another business's
  auto-reply) now loops with our AI indefinitely. Relay ON: `qa_hourly_cap` (10) breaks the loop.
  Relay OFF (Telnyx-direct, post-10DLC): nothing does — unbounded OpenAI + Telnyx spend. The
  webhook rate limit (`lib/rate-limit.ts`, 30/min) is keyed by **Telnyx's IP**, not the texter, so
  it does not help. **Revisit before switching the relay off** (a loop breaker keyed on identical
  repeated inbound text would honour the rule; not built now).

## Pre-flight facts (verified 2026-08-28 13:30, before any change)

- **Baseline:** `npx vitest run apps/server/src/__tests__/intake-qa.test.ts` → **10/10 green, 1.45 s**.
  Run from the repo root with no exported `DATABASE_URL` — proves vitest loads `.env` (the shell
  does not export it). `timeout(1)` does not exist on macOS; rely on vitest's own timeout.
- **Migrations:** `npx prisma migrate status` → 16 found, "Database schema is up to date" — the
  restart's `prisma migrate deploy` (start.sh line 154) is a no-op.
- **Nothing unreviewed rides along on the rebuild:** the running build is from 11:04:56; every
  uncommitted edit in the tree (`admin/integrations/page.tsx` 09:27, reveal route 09:24,
  `textemall-upload.ts` 11:00, `textemall-iris.ts` 11:00) predates it, so the production build
  already contains them and a rebuild deploys identical code + our M1 change. Re-check at execution
  time (gate in M2a). Do **not** `git stash` — that would *remove* the reveal feature production is
  already running.
- **Process group:** caddy, ngrok, `node dist/index.js`, both `next-server`s all carry
  pgid 86681 = the launchd launcher → `kill 0` in `cleanup()` reaches every one of them.
- **Stale launchers:** five `start.sh` shells from Aug 26 (pids 31102, 37400, 75014, 14220, 21649)
  are still alive — no children, no listening ports, own process groups. Inert; killed in M2b so
  `ps`/pidfile checks stay unambiguous.
- **Zillow triggers:** the 11:05 `POST /internal/zillow/auto-run` in today's log came from the
  Iris supervisor / a manual call, **not** from startup — a restart does not itself run Zillow.
  Server job `zillow-daily` ticks hourly at :00 (acts only at 10/16/22); Iris supervisor
  `zillow-supervise.sh` runs daily at 09:30.

---

## Milestones

### M1 — Remove the cap (code)
**`apps/server/src/handlers/intake-qa.ts`**
- Delete the `perPhoneCap` block (lines 61-72): the `resolveConfig("sms_relay","qa_daily_cap_per_phone")`
  read, the `> cap → silent` return and the `=== cap → "team will follow up"` return.
- Keep `priorAssistant` — it still drives the STOP line (first answer only) and the fallback
  de-dupe. Update the doc comment: drop the "Per-phone daily cap" bullet, add "Engaged numbers are
  never capped (owner rule 2026-08-28); volume caps live in relay-guards".
- `resolveConfig` import becomes unused after the deletion (its only other use was the cap read) —
  remove it. Hygiene only: `noUnusedLocals` is not set, so `tsc` would not fail on it.

**`packages/shared/src/integrations.ts`** — remove the `qa_daily_cap_per_phone` field
(label "Q&A Replies/Day per Phone", env `SMS_RELAY_QA_DAILY_CAP_PER_PHONE`). No data migration
(no row exists); a stray row would be ignored. `integrations.test.ts` only checks id/key uniqueness
and placeholder shape — no field-count pin to update (verified).

**Tests — `apps/server/src/__tests__/intake-qa.test.ts`**
- Delete the "per-phone daily cap" case; drop `qa_daily_cap_per_phone` from the `cfg` mock and its
  `beforeEach` reset (leave the mock scaffold — other keys may use it).
- Add **"engaged numbers are never capped"**: `seedConv` with 20 prior assistant messages (+ users) →
  `handleIntakeQa` → `shouldRespond: true`, `replyKind: "ai"`, `mockChat` called exactly once,
  reply contains the apply link, reply does **not** contain "team will follow up", and (since
  `priorAssistant > 0`) does **not** contain the STOP line.
- **Keep** the existing "OpenAI failure → canned fallback once, then silence" case (it already
  exists) and add a deep-history variant: 20 prior assistant messages, OpenAI down → fallback sent
  once; second call → silent. Proves the de-dupe survived and is the only silent case left.

**Gate:** `npx vitest run apps/server/src/__tests__/intake-qa.test.ts` green (run from the repo
root; vitest loads `.env`, which is where `DATABASE_URL` comes from — the shell does not export it);
`grep -rn qa_daily_cap_per_phone apps packages --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next` → 0 hits;
`grep -rn "keep things easy" apps packages` (same excludes) → 0 hits.

### M2 — Build, restart, live gate, commit
**2a. Build first, in the terminal, while the old build keeps serving:**
Guard against an unreviewed deploy — list source files newer than the running server build:
```
find apps packages -type f \( -name '*.ts' -o -name '*.tsx' \) -newer apps/server/dist/index.js \
  -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/dist/*'
```
Expected: **only** the M1 files (`intake-qa.ts`, `integrations.ts`, `intake-qa.test.ts`). Anything
else listed is code production isn't running yet — stop and review it before continuing.
Then `npx turbo build --force` (shared changed → server, dashboard and tenant-site all rebuild).
Then `npx vitest run` from root — full suite green (known flake: `late-fees.test.ts` only in the
full run). Note: `next start` serves `apps/dashboard/.next` in place, so once the dashboard rebuild
lands the running dashboard may error until the restart — go straight to 2b.

**2b. Restart — the launcher is owned by launchd, NOT a terminal.**
`~/Library/LaunchAgents/com.tenantai.launcher.plist` runs `start.sh` with
`KeepAlive.SuccessfulExit=false` (relaunch only on non-zero exit), `ExitTimeOut 5`,
`ThrottleInterval 60`; `launchctl print` shows 41 runs and last exit code 1, so supervision is
real (it has been catching crashes) and must be kept. `start.sh` ends with
`cleanup(){ kill 0; }` which signals its **entire process group** — never run `./start.sh` from a
working shell (it would take over unsupervised, or kill the shell). Deterministic sequence:
```
# 0. retire the five inert Aug-26 launcher shells (no children, no ports — re-verify with
#    `pgrep -P <pid>` and `lsof -a -p <pid> -iTCP -sTCP:LISTEN` first; each is its own pgid)
kill -TERM 31102 37400 75014 14220 21649 2>/dev/null
# 1. graceful stop: trap → cleanup → kill 0 → exit 0 → launchd does NOT double-launch.
#    zsh runs the trap after the current `sleep 5` returns, so allow up to ~5 s.
kill -TERM "$(cat ~/tenant-ai/.launcher.pid)"
until ! lsof -nP -iTCP:3005 -sTCP:LISTEN >/dev/null && ! lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null \
   && ! lsof -nP -iTCP:3002 -sTCP:LISTEN >/dev/null; do sleep 1; done
# 2. fresh supervised instance (start.sh re-runs turbo build — cached, instant — and migrate deploy — no-op)
launchctl kickstart gui/$(id -u)/com.tenantai.launcher
# 3. if `launchctl print … | grep state` is not "running" within 15 s, ThrottleInterval (60 s since
#    the last exit) may be holding it: wait 60 s and kickstart once more. Do not fall back to ./start.sh.
```
Verify: `launchctl print gui/$(id -u)/com.tenantai.launcher | grep -E "state|pid"` → running, new
pid; `curl -s localhost:3005/health` → 200; `curl -s 127.0.0.1:4040/api/tunnels` shows the static
domain → `localhost:3010`; `~/Library/Logs/tenant-ai.log` shows `Registered job: zillow-daily` from
the new pid and no `✗`. (Alternative with the same outcome: the Dock "Tenant AI" shortcut or the
remote-control agent's `/restart` — both launch `start.sh` detached.)

**Timing:** phones are offline ~30–60 s while ngrok/Caddy come back (the single-session ngrok race
is handled by `start_ngrok`'s retry); start.sh also pops the dashboard in a browser (cosmetic).
Do NOT restart inside a Zillow window — the `zillow-daily` job acts at **10:00 / 16:00 / 22:00**
local and runs ~3 min (today's took 167 s), and the Iris supervisor runs at **09:30**. Avoid
09:30–09:40 and the first 5 min of 10/16/22; any other time is fine (the hourly :00 tick outside
those hours is a no-op).

**2c. Live gate from the test phone +1 312 975 2365** — 9 assistant replies deep as of 12:55 today,
the ideal fixture; do NOT reset its conversation. It is purged 24 h after its last text (currently
2026-08-29 12:55); if the gate runs after that, first confirm the count with
`select jsonb_array_length(messages::jsonb) from "SmsConversation" where "callerPhone"='+13129752365'`
— if it's gone, the live gate only proves delivery, and the unit test remains the proof of "never capped". **Do not be on a call with the number while texting** (a
mid-call text is swallowed into the call by design).
1. Text `Hi` → within ~10 s an AI reply arrives with the Google Form link
   (`OutboundRelayMessage`: `kind = ai`, `status = sent`).
2. Text `is parking included?` 30 s later → another AI answer with the link.
3. Neither reply contains "team will follow up"; no silent gap; server log has no `[intake-qa]`
   warning; dashboard "Q&A replies today" incremented by 2 (well under `qa_daily_cap` 40).

**2d. Commit only these files:** `apps/server/src/handlers/intake-qa.ts`,
`packages/shared/src/integrations.ts`, `apps/server/src/__tests__/intake-qa.test.ts`,
`INTAKE_QA_OPS.md`, `intake-qa-plan.md`, this plan. The tree already holds unrelated uncommitted
work (integrations key-reveal routes + test, `textemall-*.ts`, other plan files) and the build
churns `apps/dashboard/tsconfig.tsbuildinfo` — stage by explicit path, never `git add -A`.

**Gate:** live texts answered; `git show --stat HEAD` lists exactly the six files;
`git status` still shows the unrelated work uncommitted and intact; `relay-guards.ts` has no diff.

### M3 — New-number / volume caps: KEEP (decided 2026-08-28, no work)
Owner confirmed: caps for new numbers and personal-number volume stay untouched (table at the top).
No code or config change. If the "Q&A replies today" counter on Admin → SMS Relay approaches 40 on
a real day, raise `qa_daily_cap` there — a config edit, not part of this plan.

**Gate:** `relay-guards.ts` has no diff in the M2 commit; `sms-relay.test.ts` cap tests untouched and green.

### M4 — Docs (part of the M2 commit)
- `INTAKE_QA_OPS.md` → "Caps & the personal-number caveat": drop `qa_daily_cap_per_phone`; add
  the owner rule ("engaged numbers are never capped; caps apply to new numbers and
  personal-number volume — those all stay"); state the two remaining silent cases (global Q&A
  volume cap → deferred, not retried; OpenAI-down fallback de-dupe) and the bot-loop caveat for
  when the relay is switched off.
- `intake-qa-plan.md` → one-line **rev. 4** note: per-phone cap removed 2026-08-28 by owner
  request, rationale, pointer to this plan.

## Rollback
`git revert <M2 commit>` → `npx turbo build --force` → the M2b restart sequence. (Setting
`qa_daily_cap_per_phone` in config does nothing once the code is gone — intended.)

## Files touched
| File | Change |
|---|---|
| `apps/server/src/handlers/intake-qa.ts` | delete per-phone cap block + unused import + comment |
| `packages/shared/src/integrations.ts` | delete `qa_daily_cap_per_phone` field |
| `apps/server/src/__tests__/intake-qa.test.ts` | replace cap test with never-capped + deep-history fallback tests |
| `INTAKE_QA_OPS.md`, `intake-qa-plan.md` | owner rule, remaining silent cases, rev. 4 note |
