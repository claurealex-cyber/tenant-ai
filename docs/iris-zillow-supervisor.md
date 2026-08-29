# Iris Zillow-Automation Supervisor

A **zero-token** daily Iris cron job that watches the Zillow daily automation and raises a
macOS notification only when a human is needed. On a healthy day it stays silent and costs
nothing.

## How it works

- Installed via `~/.iris/scripts/iris-cron.py` (which generates a launchd agent
  `dev.iris.cron.<id>` + a logging wrapper in `~/.iris/cron/`). The `--script` job type was
  added for this: the wrapper runs a shell script directly — no `iris -p`, no API keys copied
  into the wrapper.
- The job runs `scripts/zillow-supervise.sh` daily at **09:30**. The wrapper's convention: stdout
  `all clear…` → silent; any other output → `osascript display notification` with that text.
- `zillow-supervise.sh` finds the live API port (3005/3001/3006…), then runs
  `apps/server/scripts/zillow-auto-supervise.ts`, which is **liveness + digest only** (rev. 2026-08-29):
  1. reads `/internal/zillow/auto-status` (secret resolved in-process, direct HTTP — works even
     when Redis/BullMQ is down); unreachable → notify;
  2. automation off → prints `all clear (automation off)`;
  3. summarises **yesterday per scheduled slot** (fixed run hours, or every hour of the hourly
     window): missed / failed / needs_login, plus "scheduler OFFLINE" if the hourly tick is dead,
     today's `needs_login`/`failed`, and queued survey texts older than 3 days;
  4. **never triggers a run.** The old `POST /internal/zillow/auto-run` bypassed the run-hours
     gate and produced an unscheduled 09:30 run on 2026-08-28 (a 203-contact batch that only
     failed at upload). Missed slots are accepted — no catch-up (decided 2026-08-27).
- In-hour reporting is done by the **in-process watchdog** (`src/services/zillow-watchdog.ts`,
  a plain `setInterval` like the relay sweep — deliberately not BullMQ, so it still reports when
  Redis is down): after each scheduled hour has fully passed (+5 min) it notifies on the Mac about
  a run that did not happen / failed / crashed / needs login, collapses consecutive misses into one
  notification, and reports the scheduler going offline/online. Decision logic is pure and tested
  (`zillow-watchdog.test.ts`, `zillow-supervisor-report.test.ts`).

## Install (reproduce)

```bash
python3 ~/.iris/scripts/iris-cron.py add \
  --name zillow-auto-supervisor \
  --script /Users/alejandroclaure/tenant-ai/scripts/zillow-supervise.sh \
  --cron "30 9 * * *" \
  --workdir /Users/alejandroclaure/tenant-ai
```

Manage: `iris-cron.py list | run <id> | logs <id> | disable <id> | rm <id>`.
Run history: `~/.iris/cron/runs/<id>.jsonl`.

## Drills performed at install (2026-08-26, all observed)

| Condition | Result |
|---|---|
| Automation off | `all clear (automation off)` — silent |
| Server unreachable (bad port) | unreachable message → would notify |
| Today's run missing, automation on | supervisor triggered the run via HTTP; day row recreated `done` |
| `needs_login` outside the window | needs-login message with the Safari fix instructions |
| Deferred queue older than 3 days (seeded row) | starvation message with queue depth |

The notification transport itself (osascript from the cron wrapper) was proven during the
M0 spike ("Notable output — notification sent" in the wrapper log).
