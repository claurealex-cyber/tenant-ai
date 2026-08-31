# Plan rev.2: dashboard editor for the real-time Zillow scrape interval

Date: 2026-08-31. Rev.2 after a stress pass against the live code — four
findings (P1 structural: rev.1's editor placement made it IMPOSSIBLE to turn
polling on from the UI). Builds on the LIVE realtime system
(`zillow-realtime-api-plan.md` rev.5, armed at 180 s) and the proven
schedule-editor pattern.

## Goal
On `/admin/zillow`, let the owner change how often the real-time scraper polls
— Off / every 2 / 3 / 5 / 10 minutes / custom — applying to the running server
within seconds, no restart, no terminal.

## Grounding (verified in code)
- ONE config key: `zillow.fast_poll_sec` (0 = off), read per evaluation;
  `decidePoll` clamps with `Math.max(fastPollSec, POLL_FLOOR_SEC=120)` — the
  engine enforces the floor no matter what any UI writes.
- `/internal/zillow/auto-status` already carries the full `realtime` block
  (`active / fastPollSec effective / window / lastPollAt / sentToday /
  maxPerDay / ambiguousCount`) and AutomationPanel already loads it.
- Write pattern proven by `/api/admin/zillow/schedule`: admin session gate →
  encrypted `systemConfig` upsert → `auditLog` row → `clearConfigCache()`
  (dashboard) → `proxyToServer("/internal/config/refresh")` (server) →
  live in seconds, with a `serverRefreshed:false` fallback message.

## STRESS PASS of rev.1 — findings and root fixes

### P1 — STRUCTURAL: rev.1's editor could never turn polling ON
AutomationPanel renders the realtime banner ONLY when
`status.realtime?.active` (verified, line ~250). Rev.1 put the editor "inside
the banner" → with polling Off (`fastPollSec=0` → `active:false`) or the lane
not on Direct API, the banner — and the editor — vanish. The one state where
you most need the control is the one where it doesn't exist.
**Root fix (M3):** the banner becomes an always-rendered "Real-time polling"
section (whenever `status.realtime` exists, i.e. any rev.5+ server) with FOUR
explicit states, editor visible in all of them:
1. **ACTIVE** (green): interval chips + live stats.
2. **OFF** (amber): "Polling OFF — leads ride the scheduled runs" + chips to
   turn it on.
3. **DORMANT — lane** (grey): interval editable but "dormant until Zillow
   delivery is Text-Em-All · Direct API" (anchor-link to DeliveryMethodPanel).
4. **DORMANT — automation off** (grey): "dormant until Automation is ON"
   (the big toggle above governs everything, polling included).
State picking needs `transport/method/enabled` → M1 adds them to the status
block instead of letting the UI re-derive them (P2).

### P2 — rev.1's GET route duplicated the source of truth
A dashboard-side GET recomputing `active` from `resolveConfig` +
`resolveZillowDelivery` creates a second brain (the exact drift the
DeliveryMethodPanel design forbids) — and the panel ALREADY loads auto-status.
**Root fix (M2):** there is NO GET route. `getPollStatus` (server, the single
source) gains the missing fields; the panel's existing `load()` supplies
everything. The new route is POST-only (a pure writer, like the schedule
route's POST).

### P3 — a "set it and wonder" trap: interval accepted while dormant
Writing `fast_poll_sec=120` with automation off or the lane on form/relay is
valid (it arms the future) but rev.1 only footnoted it.
**Root fix:** the POST response echoes the full refreshed status block and the
UI states (P1) make dormancy loud, with the reason and the link to fix it.

### P4 — the floor constant lives in the wrong package for a shared helper
`POLL_FLOOR_SEC` is defined in `apps/server/src/services/zillow-poll.ts`;
`@tenant-ai/shared` (where the validation helper belongs so the dashboard
route can use it) cannot import from the server app.
**Root fix (M1):** move the constant to shared as `ZILLOW_POLL_FLOOR_SEC`
(one source); `zillow-poll.ts` re-exports it (`export const POLL_FLOOR_SEC =
ZILLOW_POLL_FLOOR_SEC`) so all existing imports/tests stand unchanged.

Minor: custom input clamps SILENTLY in rev.1 — the UI must say "raised to
2 min (minimum)" when it clamps (M3 gate case).

## The "every minute" question (owner decision D1 — unchanged)
The 120 s floor is deliberate (each poll = a full Safari scrape; 60 s ≈ 720
scrapes/day of anti-bot exposure and Safari busy 10–30 s of every minute,
delaying inbound sends). Keep the floor; show "1 min" locked with that
tooltip. A gated `fast_poll_floor_override` build (M5) only on explicit
request.

## Milestones

### M1 — Shared floor + validation + richer status (P2, P4)
- `ZILLOW_POLL_FLOOR_SEC = 120` moves to `@tenant-ai/shared`;
  `zillow-poll.ts` re-exports (no call-site churn).
- `normalizePollIntervalSec(raw)` in shared: `0`/`"off"` → 0; numbers clamp to
  `[floor, 3600]`; non-numeric → null (reject). Minutes↔seconds helpers.
- `getPollStatus` gains `floorSec`, `configuredSec` (raw key value),
  `transport`, `method`, `autoEnabled` — everything the four UI states need,
  from the one source.
- **Gate (unit):** clamp table (0, 30→120, 119→120, 120, 180, 3600,
  5000→3600, "x"→null); status shape; existing poll suites green unchanged
  (re-export proves no drift).

### M2 — POST-only route `/api/admin/zillow/realtime` (P2, P3)
- `POST { minutes?: number, seconds?: number, off?: boolean }` → normalize
  (null → 400 with reason); encrypted upsert of `zillow.fast_poll_sec`;
  `auditLog` (`zillow_poll_interval_update`, old→new, userId);
  `clearConfigCache()`; best-effort `proxyToServer("/internal/config/refresh")`
  → `serverRefreshed` flag; response includes the refreshed
  auto-status `realtime` block (proxied) so the UI updates in one round trip.
- **Gate (route tests):** 403 non-admin; 400 garbage; clamp applied (1 min in
  → 120 stored); off→"0"; audit row with old/new; refresh-failure →
  `serverRefreshed:false`; response echoes status.

### M3 — Always-rendered Real-time section with the editor (P1, P3)
- Replace the `active &&` banner with the four-state section; chips
  `Off · 1 min 🔒 · 2 · 3 · 5 · 10 · [custom min]`; highlight from
  `configuredSec` (falling back to effective); clamp feedback ("raised to
  2 min (minimum)"); copy per `serverRefreshed`; dormant states name the
  reason + anchor the fix.
- **Gate:** component cases — all four states, locked chip tooltip, custom
  clamp message, Off→amber, save round-trip updates without full reload;
  dashboard screenshot; `npx turbo build` green.

### M4 (optional) — `zillow.max_broadcasts_per_day` editor in the same row.

### M5 (only on explicit owner request) — gated 60 s floor override (D1).

### M6 — Live gate
1. UI 3 min → 2 min → log cadence tightens within ~30 s; status
   `effectiveSec 120`; audit row present.
2. Off → polls stop within one evaluation; section turns amber; scheduled
   10/16/22 untouched.
3. With the lane flipped to iMessage temporarily: section shows DORMANT-lane
   with the link; flip back → ACTIVE returns without touching the interval.
4. Restore 3 min.

## Stress points covered by design (carried from rev.1)
- UI can never bypass the floor — `decidePoll`'s `Math.max` is the law.
- No write races with the schedule editor (disjoint keys, same pattern).
- Interval edits never touch the 8–22 window or the daily ceiling.
- Rollback = Off chip (or `set-config zillow fast_poll_sec 0`); the scheduled
  cadence is always the fallback.

## Owner decisions
1. Keep the 2-min floor (recommended) or request the M5 override?
2. Presets Off/2/3/5/10 ok?
3. Include the M4 ceiling editor now or later?
