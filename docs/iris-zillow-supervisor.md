# Iris Zillow-Automation Supervisor

A **zero-token** daily Iris cron job that watches the Zillow daily automation and raises a
macOS notification only when a human is needed. On a healthy day it stays silent and costs
nothing.

## How it works

- Installed via `~/.iris/scripts/iris-cron.py` (which generates a launchd agent
  `dev.iris.cron.<id>` + a logging wrapper in `~/.iris/cron/`). The `--script` job type was
  added for this: the wrapper runs a shell script directly — no `iris -p`, no API keys copied
  into the wrapper.
- The job runs `scripts/zillow-supervise.sh` daily at **09:30** (after the server engine's
  09:00 window opens). The wrapper's convention: stdout `all clear` → silent; any other
  output → `osascript display notification` with that text.
- `zillow-supervise.sh` finds the live API port (3005/3001/3006…), then runs
  `apps/server/scripts/zillow-auto-supervise.ts`, which:
  1. reads `/internal/zillow/auto-status` (secret resolved in-process, direct HTTP — works
     even when Redis/BullMQ is down);
  2. automation off → prints `all clear (automation off)`;
  3. today's run missing or unhealed after the window → POSTs `/internal/zillow/auto-run`
     (no force — race-safe against the hourly engine via the day-claim) and re-checks;
  4. notifies on: `needs_login` (Safari session expired), `failed`, missing run that could
     not be triggered, server unreachable, or queued survey texts older than 3 days.

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
