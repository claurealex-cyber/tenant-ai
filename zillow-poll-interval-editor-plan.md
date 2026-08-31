# Plan: dashboard editor for the real-time Zillow scrape interval

Date: 2026-08-31. Builds on the LIVE realtime system (`zillow-realtime-api-plan.md`
rev.5, deployed + armed at 180 s) and mirrors the proven schedule-editor pattern
(`/api/admin/zillow/schedule` + `schedule-ui.ts`).

## Goal
On the Zillow admin page (`/admin/zillow`), let the owner change how often the
real-time scraper polls — presets like every 2 / 3 / 5 / 10 minutes, a custom
value, and Off — with the change applying to the running server within seconds,
no restart, no terminal.

## Grounding (verified in code)
- The interval is ONE config key: `zillow.fast_poll_sec` (0 = off). The driver
  reads it per evaluation; `decidePoll` clamps with
  `Math.max(fastPollSec, POLL_FLOOR_SEC=120)` — the floor is enforced
  server-side no matter what the UI sends (defense in depth).
- `getPollStatus` (already merged into `/internal/zillow/auto-status`) returns
  `active / fastPollSec (effective) / window / lastPollAt / sentToday /
  maxPerDay / ambiguousCount` — the UI needs no new read path.
- The schedule route shows the full write pattern: admin session gate →
  encrypted `systemConfig` upsert → `auditLog` row → `clearConfigCache()`
  (dashboard process) → `proxyToServer("/internal/config/refresh")` (server
  process) → change is live in seconds, not the 60 s TTL.
- AutomationPanel already renders the green "Real-time mode" banner from
  `status.realtime` — the editor slots into it.

## The "every minute" question (owner decision D1)
The 120 s floor exists deliberately (rev.5 R3/anti-bot: each poll is a full
Safari scrape of Zillow's lead API; ~720 scrapes/day at 60 s meaningfully
raises anti-bot exposure and keeps Safari busy ~10–30 s of every minute,
delaying inbound caller/text sends). Recommendation: keep the floor at 120 s
and show a greyed-out "1 min" preset with that explanation. If the owner
explicitly wants 60 s anyway, M5 adds `zillow.fast_poll_floor_override` gated
behind its own confirmation — NOT part of the default build.

## Milestones

### M1 — Shared validation helper + server contract
- `normalizePollIntervalSec(raw)` in `@tenant-ai/shared`: `0` → 0 (off);
  otherwise clamp to `[120, 3600]`; garbage → null (reject). Minutes↔seconds
  conversion helpers for the UI.
- `getPollStatus` gains `floorSec: POLL_FLOOR_SEC` so the UI never hardcodes it.
- **Gate (unit):** clamp table (0, 30→120, 59→120, 120, 180, 3600, 5000→3600,
  "x"→null); status shape includes `floorSec`.

### M2 — Dashboard API route `/api/admin/zillow/realtime`
- `GET` → `{ fastPollSec, effectiveSec, floorSec, active, laneIsApi,
  maxPerDay }` (reads via `resolveConfig` + `resolveZillowDelivery`).
- `POST { minutes?: number, seconds?: number, off?: boolean }` → normalize via
  M1; refuse invalid with 400 + reason; write encrypted
  `zillow.fast_poll_sec`; `auditLog` row (`zillow_poll_interval_update`, old →
  new); `clearConfigCache()`; `proxyToServer("/internal/config/refresh")`
  (best-effort — on failure return `serverRefreshed:false` so the UI says
  "applies within a minute" instead of "now", exactly like the schedule
  editor).
- Setting an interval while the lane is NOT textemall+api is ACCEPTED (it arms
  the future) but the response flags `laneIsApi:false` so the UI explains
  polling stays dormant until the delivery method is switched.
- **Gate (route tests, schedule-route style):** 403 non-admin; 400 garbage;
  writes + audit row verified; off→0; refresh-failure path returns
  `serverRefreshed:false`.

### M3 — UI: interval editor inside the Real-time banner
- AutomationPanel's realtime banner grows a compact control row:
  `Off · 1 min (locked) · 2 min · 3 min · 5 min · 10 min · [custom min]` —
  active preset highlighted from `effectiveSec`; the 1-min chip disabled with
  tooltip "floor is 2 min — each poll is a full Zillow scrape (anti-bot)".
- Save → POST → optimistic re-`load()` of auto-status; note copy:
  "Polling every N min (live now)" or "…applies within a minute" per
  `serverRefreshed`; when `laneIsApi:false` the banner is grey with "Real-time
  is dormant — switch Zillow delivery to Text-Em-All · Direct API to activate"
  (links the DeliveryMethodPanel section).
- Off state renders the banner amber: "Real-time polling OFF — leads ride the
  scheduled runs (10/16/22)".
- **Gate:** component states (active/dormant/off/locked-preset/custom-clamp)
  + a dashboard screenshot; `npx turbo build` green.

### M4 (optional, same pattern) — daily ceiling editor
- Same row edits `zillow.max_broadcasts_per_day` (counts sent+ambiguous,
  poll-only). Skippable; default 50 is fine.

### M5 (only if the owner asks) — 60 s floor override
- `zillow.fast_poll_floor_override="60"` honored by `decidePoll` +
  `normalizePollIntervalSec`; UI unlocks the 1-min chip behind an explicit
  confirm listing the anti-bot risk. NOT built by default (D1).

### M6 — Live gate
1. In the dashboard, change 3 min → 2 min → within ~30 s the log cadence
   tightens (`[zillow-poll] cycle → …` spacing ~120 s + jitter); status shows
   `effectiveSec 120`.
2. Off → polling stops within one 30 s evaluation; scheduled 10/16/22 untouched
   (banner goes amber).
3. Restore 3 min; confirm audit rows recorded each change.

## Stress points already covered by design
- **UI can't bypass the floor** — the engine clamps independently (M1 helper is
  UX, `Math.max` in `decidePoll` is the law).
- **No write races with the schedule editor** — disjoint config keys; both use
  the same upsert + double cache refresh.
- **Ceiling/window interplay unchanged** — interval edits never touch the 8–22
  texting window (U1) or the 50/day ceiling.
- **Rollback** = Off preset or `set-config zillow fast_poll_sec 0`; the
  scheduled cadence is always the fallback.

## Owner decisions
1. Keep the 2-min floor (recommended) or build M5's 60 s override?
2. Presets Off/2/3/5/10 ok, or different set?
3. Include the M4 ceiling editor now or later?
