# Remote Access via ngrok (Free) + Google-Form Survey Toggle — Implementation Plan (rev. 3 — BUILT & LIVE-GATED 2026-08-26)

**Scope:** Two things, both on the ngrok **Free** tier, without changing the phone system's public URL:

1. **Survey toggle** — the link texted to prospective tenants switches between the self-hosted survey (today) and the Google Form Mr. Jo receives via Google Docs. Switchable from the dashboard or `.env`, no restart, reversible.
2. **Tenant AI dashboard accessible from anywhere, on the existing static domain** — a local reverse proxy (Caddy) sits behind `prepossessionary-….ngrok-free.dev` and splits by path: webhook/survey paths → Fastify, everything else → the dashboard. One permanent dashboard URL, no random URLs, webhooks never interrupted.

One instance on the Mac mini, one Postgres. All paths relative to `/Users/alejandroclaure/tenant-ai` unless absolute.

Google Form (cleaned from the Gmail redirect wrapper):
`https://docs.google.com/forms/d/e/1FAIpQLSf4jZ7jYk14CDnRZjZCZPhV6NEhD53sDqfdZp7omfBUe3Vbug/viewform`

**rev. 3 (built 2026-08-26, all milestones live-gated)** — status per milestone:
- **M1 survey toggle — DONE.** `packages/shared/src/survey-mode.ts` (pure `decideSurveyMode` + `resolveSurveyModeConfig(read)`), fields `sms_relay.survey_mode` / `google_form_url`, `resolveSurveyLink()` in `apps/server/src/handlers/survey-intake.ts` is the only `buildSurveyUrl` caller (intake, `scripts/send-survey-once.ts`, Zillow sends), status chip on Admin → SMS Relay, preview tool `apps/server/scripts/survey-link-preview.ts` (real config/DB, no send). 21 new tests; real-DB gate printed the hosted link, the Google Form link, and the empty-URL degradation.
- **M2 Caddy split — DONE.** `ops/Caddyfile`, Caddy 2.11.4 via Homebrew, `start.sh` step 7b with degradation, tunnel → :3010. Live: `/health`, `/survey/*`, `/owner/*`, `POST /telnyx/sms` reach Fastify through the public URL; `/login`, `/admin/*`, `/internal/*` reach the dashboard; WebSocket upgrade → 101.
- **M3 auth on the public origin — DONE.** `NEXTAUTH_URL` = static domain; live login through the public URL set `__Secure-next-auth.session-token` (Secure, HttpOnly), admin APIs answered, the same cookie on `http://localhost:3000` yields no session (by design). Next 14.2 emits **relative** `Location` headers for middleware/next-auth redirects, so the forced `X-Forwarded-Proto` is defense-in-depth, not the fix. System page polls every 120 s, visibility-gated, stops after 3 failures.
- **M4 kill-switch — DONE.** `./start.sh web-off|web-on` and the Admin → System button (`POST /api/admin/phone-system {action}`) both round-tripped live: off → public `/login` is Fastify 404 while `/health` stays 200; on → dashboard back. `phone-system.ts` models the tunnel target (`proxy | server | other`) so both valid states are healthy.
- **M5 keep-alive — DONE.** `ops/com.tenantai.launcher.plist` + `ops/install-launchd.sh` installed (`RunAtLoad`, `KeepAlive SuccessfulExit=false`, `ThrottleInterval 60`, log `~/Library/Logs/tenant-ai.log`); kickstart brings everything up in ~10 s; `kill -9` of the API → launcher exit 1 → relaunch → back in ~55 s. Energy settings already correct (`sleep 0`, `womp 1`).

**Defects found while building (fixed at the root, all with tests/gates):** (h) `resolveSurveyModeConfig` called `resolveConfig` *inside* the shared package, so a caller's mocked/alternate reader could never reach it → the decision is now pure and the reader is injected; (i) `SurveyInvite` has a partial unique index allowing ONE outstanding invite per phone+property — the toggle now reuses that row and updates its `channel` instead of minting a sibling; (j) after a takeover, the launcher spawned ngrok while the previous Free-plan session was still draining and discarded its output → ngrok now logs to `~/Library/Logs/tenant-ai-ngrok.log`, waits for :4040 to free, verifies the tunnel via the agent API and retries once; (k) `cleanup`'s `kill 0` signalled the launcher itself, so a crash exited 0 and launchd (correctly) did not relaunch → TERM is ignored inside cleanup; zsh has no `wait -n` → explicit child monitor; (l) `web-off` from the dashboard is a one-way door for a remote user (the dashboard is what goes offline) → confirm dialog states the recovery, `web-off` detail names it, and a relaunch **always** restores the proxy (the launcher used to accept either target); (m) the Zillow-leads plan's blasts and `send-survey-once` bypassed the toggle → routed through `resolveSurveyLink`.

**Not done / needs you:** send a real text to (708) 907-0695 after flipping the mode in Settings → Integrations → SMS Relay (`survey_mode` = `google_form`, `google_form_url` = the form) to see the form link arrive via the relay; open the public URL from the Windows PC once to accept the ngrok interstitial. Nothing is committed to git yet.

**rev. 2 (stress test, 2026-08-26)** — defects found in rev. 1 and fixed at the root here: (a) Caddy matcher listed `/api/data` and `/test`, which are test fixtures, not routes; (b) Caddy overwrites `X-Forwarded-Proto` → Next 14.2 builds `req.url` as `http://` → every middleware/next-auth redirect would dead-end on an https-only ngrok endpoint; (c) Admin → System page polls health every 30 s → one open tab burns the whole 20k/month quota in ~7 days and takes the phone webhooks with it; (d) `phone-system.ts` health + Start button compare the tunnel target to `SERVER_PORT` → the panel would flag the proxy as "wrong" and one click would retarget the tunnel to 3005, silently killing public dashboard access; (e) Zillow-lead sends (`/internal/zillow/*`) mint links with `buildSurveyUrl` directly → would ignore the toggle; (f) rev. 1 proposed a random-URL tenant-site endpoint, but tenant-site URLs are embedded in **texted** links (`notice-sms.ts`, convert) — a URL that dies on restart must never be texted; (g) no degradation path if Caddy is missing/crashed. Verified non-issues: `SurveyInvite.channel` is a plain `String` (no migration); `rewriteForRelay` only rewrites STOP wording (Google link passes through untouched); login already has lockout (5 attempts / 15 min); media-stream `wss://` URL comes from the `public_url` config, not the request scheme; `/internal/*` is only ever called by the dashboard over localhost (`proxyToServer`), so it does not need — and should not get — public routing.

---

## 1. Current state (verified 2026-08-26)

| Thing | State |
|---|---|
| ngrok | agent 3.36.0, Free. `~/Library/Application Support/ngrok/ngrok.yml` = authtoken only. One tunnel started by `start.sh` step 8 / `apps/dashboard/src/lib/phone-system.ts → ensureTunnel`: `https://prepossessionary-frontoparietal-charlsie.ngrok-free.dev → localhost:3005` |
| Free-plan limits | 1 static domain (above), 3 endpoints, **one agent process** (a second `ngrok http` is rejected), **20k HTTP requests + 1 GB / month shared by everything on the account**, browser interstitial on `*.ngrok-free.*` (browsers only — webhooks are unaffected, as today). ngrok v3 endpoints are https-only. |
| Fastify public routes | `/health`, `/health/deep`, `/voice/*`, `/sms/incoming`, `/telnyx/sms`, `/survey/:token` (GET+POST), `/webhook/stripe`, `/owner/:token`, `/media-stream` (WS), `/internal/*` (dashboard-only, shared secret, called via localhost). `trustProxy: true`. |
| Dashboard routes | pages `admin, applications, billing, call-logs, maintenance, messages, notices, onboarding, payments, properties, settings, tenants, website, login/signup/forgot-password`; `/api/{admin, applications, auth, billing, call-logs, dashboard, leases, maintenance, messages, notices, onboarding, payments, properties, stripe, tenants, twilio, website-config}`. **No overlap with the Fastify public set.** |
| Survey link today | `handleSurveyIntake()` (`apps/server/src/handlers/survey-intake.ts`): mint/reuse `SurveyInvite` → `resolvePublicBaseUrl()` (config `sms_relay.survey_base_url` = static domain while relay on) → `buildSurveyUrl()` = `<base>/survey/<token>`. Reply = `intakeAutoReply` + link + STOP. Completed `Application` (30 d) → ack instead. Same pieces reused by `scripts/send-survey-once.ts` and by the Zillow sends in `routes/internal.ts`. |
| Runtime config | `packages/shared/src/integrations.ts` declares `sms_relay` fields (`enabled`, `survey_base_url`, `forward_to`, `relay_from`, …). Fields are **plain text** (no boolean/select type — `enabled` is the string `"true"`). Each field has an `envVar` fallback. Read via `resolveConfig()` with a 60 s cache. |
| Auth | next-auth v4, credentials, lockout 5/15 min. `NEXTAUTH_URL=http://localhost:3000`. Next **14.2.35** derives `req.url` scheme from `x-forwarded-proto` (verified in `node_modules/next/dist/server/base-server.js`). `middleware.ts` redirects with `new URL("/onboarding", req.url)`; `withAuth` redirects to `/login` the same way. |
| Polling | Only `apps/dashboard/src/app/admin/system/page.tsx`: `fetch("/api/admin/server-health")` every 30 s while mounted, no visibility check. Nothing else in the dashboard polls. |
| Tenant site | `TENANT_SITE_URL=http://localhost:3002` is embedded in tenant-facing texted links (`notice-sms.ts`, `tenants/[id]/convert`) — **already broken for real tenants today**; out of scope here but recorded (§6). |

---

## 2. Target architecture

```
Prospect texts +17089070695 ─► Telnyx ─► https://prepossessionary-….ngrok-free.dev/telnyx/sms
                                            │ handleSurveyIntake() → resolveSurveyLink()
                                            │   survey_mode = hosted       → <static>/survey/<token>   (today)
                                            │   survey_mode = google_form  → docs.google.com/forms/…   (new)
                                            ▼ reply via Messages relay / Telnyx                        (unchanged)

https://prepossessionary-frontoparietal-charlsie.ngrok-free.dev   (ONE static domain, ONE endpoint, ONE agent)
        │
        ▼  ngrok agent → 127.0.0.1:3010  (Caddy, path split, X-Forwarded-Proto forced to https)
        ├─ /telnyx/* /voice/* /sms/* /survey/* /webhook/* /owner/* /media-stream /health /health/*  → Fastify :3005
        └─ everything else (/, /login, /admin, /api/admin/*, /_next/*, … and /internal/* → dashboard 404)  → Dashboard :3000

"web off" state (quota kill-switch / Caddy missing):  ngrok → 127.0.0.1:3005 directly. Phones + hosted survey work, dashboard not public.
```

Why not "toggle the static domain to the dashboard": the static domain carries `/telnyx/sms` (every inbound text), Twilio voice, the media-stream WebSocket and Stripe. Repointing it would stop inbound texts — Google-Form mode would silence the auto-reply it exists to send. The path split keeps all of it live at once; `PUBLIC_URL` and webhook registrations never change (tunnel target port 3005 → 3010 is the only delta).

Why Caddy, not Next.js `rewrites()`: rewrites can't proxy the `/media-stream` WebSocket. `brew install caddy`, one `Caddyfile`, no Docker.

Why `/internal/*` is **not** routed to Fastify: the dashboard calls it over localhost (`proxyToServer`, `zillow-admin.ts`); publicly it lands on the dashboard and 404s. Smaller public surface than today.

---

## 3. Milestones

### M1 — Survey toggle (hosted ↔ Google Form)
Config — add to the `sms_relay` integration in `packages/shared/src/integrations.ts` (text fields, like the others):
- `survey_mode` (`envVar: SMS_RELAY_SURVEY_MODE`, placeholder `hosted`) — help: "`hosted` or `google_form`. Which link intake texts send. Reaches the running server within 60 s." Server normalizes: trimmed, case-insensitive `google_form` → form; anything else → hosted.
- `google_form_url` (`envVar: SMS_RELAY_GOOGLE_FORM_URL`) — the URL above. Server accepts only `https://docs.google.com/forms/` or `https://forms.gle/`.

Server — `apps/server/src/handlers/survey-intake.ts`:
1. `resolveSurveyLink(property, phone): Promise<{ url; kind: "hosted" | "google_form"; invite }>` — the **single** place that decides what link goes out:
   - `hosted`: today's path unchanged (`createOrReuseSurveyInvite` + `resolvePublicBaseUrl` + `buildSurveyUrl`).
   - `google_form`: `url = google_form_url`. Empty/invalid URL → `logger.warn` + fall back to hosted (never text a broken link). Still `createOrReuseSurveyInvite` with `channel: "google_form"` (plain `String` column — no migration) so Admin → Surveys shows who was sent the form and when; no `Application` is created — responses live in Google. Optional `{phone}` / `{property}` placeholders substituted into a prefilled-form URL, only if you supply a prefill link.
2. `handleSurveyIntake()` calls `resolveSurveyLink()`. The completed-application ack (30 d) applies in both modes — someone who already applied via the hosted survey does not get the form.
3. **All other senders go through `resolveSurveyLink()` too**: `scripts/send-survey-once.ts`, and `routes/internal.ts` `/internal/zillow/leads/:id/send` + `/send-batch` (the Zillow-leads plan's blasts). Grep gate: `buildSurveyUrl(` is called from exactly one place afterwards — inside `resolveSurveyLink`.
4. `rewriteForRelay()` needs no change (verified: it only rewrites the STOP sentence and prefixes the property name).

Dashboard: the two fields appear automatically in Settings → Integrations → SMS Relay. Add a status chip on Admin → SMS Relay: "Survey link: Google Form" / "Hosted" + the URL.

Tests (`apps/server/src/__tests__/survey-intake.test.ts` + zillow/relay tests): hosted reply text unchanged (snapshot); google_form reply = intro + form URL + STOP line; invalid URL → hosted + warning; `SurveyInvite.channel === "google_form"` recorded; `send-survey-once` and zillow `send` honor the mode; relay rewrite leaves the form URL intact.

**Gate:** flip `survey_mode` in the dashboard → text "hi" from a test phone → reply carries the Google Form link (via the relay, from (708) 415-8984); flip back → `<static>/survey/<token>`. No restart. `npx vitest run apps/server` green.

### M2 — Caddy path split behind the existing static domain
1. `brew install caddy`. New `ops/Caddyfile`:
   ```
   {
     admin off
     auto_https off
   }
   :3010 {
     bind 127.0.0.1
     @api path /telnyx/* /voice/* /sms/* /survey/* /webhook/* /owner/* /media-stream /health /health/*
     handle @api {
       reverse_proxy 127.0.0.1:3005 {
         header_up X-Forwarded-Proto https
       }
     }
     handle {
       reverse_proxy 127.0.0.1:3000 {
         header_up X-Forwarded-Proto https
       }
     }
   }
   ```
   `header_up X-Forwarded-Proto https` is **required**: Caddy overwrites `X-Forwarded-*` from an untrusted upstream, so without it Next.js sees `http`, builds `req.url` as `http://<static>/…`, and every `middleware.ts` / `withAuth` redirect points at an `http://` URL that an https-only ngrok endpoint won't serve. Forcing `https` is safe because Caddy is bound to loopback and only ngrok reaches it. Host header is preserved by default; WebSocket upgrade is automatic.
2. `.env`: pin `SERVER_PORT=3005`, add `PROXY_PORT=3010`. `start.sh`: delete the 3005–3008 port-hunting loop (3001 is permanently claude-web-bridge; a moving port would desync the Caddyfile).
3. `start.sh` step 7b — start Caddy: orphan check on 3010 (same pattern as the 3000/3002 checks), then `caddy run --config ops/Caddyfile &` inside the existing `trap … kill 0` group. **Degradation rule:** if `caddy` is not installed or fails to bind within 3 s → `WEB_TARGET=3005`, print `⚠ dashboard not public (no proxy)`, continue. Phones never depend on Caddy.
4. `start.sh` step 8 — tunnel target is `${WEB_TARGET:-$PROXY_PORT}`; the "already running & correct?" check compares against that.
5. `apps/dashboard/src/lib/phone-system.ts` — model the tunnel target as a **state**, not a boolean:
   - `tunnelTarget(): "proxy" | "server" | "other"` from the agent API (`addr` ends with `:PROXY_PORT` / `:SERVER_PORT` / else).
   - `proxy` **and** `server` are both healthy (the latter labelled "web off"); only `other` is an error. Today's `tunnelPortMatches(tunnel, serverPort())` at the status check (~L335) and in `ensureTunnel` (~L290) is what would otherwise flag the proxy as wrong and "fix" it to 3005.
   - Start button → `ensureTunnel(publicUrl, PROXY_PORT)` when Caddy answers on 3010, else `SERVER_PORT`. Spawn fallback unchanged (`ngrok http --url=… <port>`).
   - New actions `web-off` (retarget to `SERVER_PORT`) and `web-on` (retarget to `PROXY_PORT`) via DELETE + POST on `/api/tunnels`, exposed as buttons on Admin → System.
   - Health steps: `Caddy: GET 127.0.0.1:3010/health` returns Fastify JSON and `GET 127.0.0.1:3010/login` returns the dashboard (200/302, HTML).
   Tests: state derivation for the three targets; Start never downgrades a `proxy` tunnel; `web-off`/`web-on` round-trip against a mocked agent API.

**Gate:** `curl -s https://<static>/health` → Fastify JSON; `curl -sI https://<static>/internal/zillow/runs` → dashboard (redirect to `/login`), **not** Fastify; `https://<static>/login` renders in a browser; Telnyx test SMS round-trips; Admin → System → Phone System green with target "proxy"; `lsof -i :3010` shows caddy on 127.0.0.1 only; `kill` caddy → panel shows "web off (no proxy)", SMS still round-trips.

### M3 — Auth, redirects, and links on the public origin
1. `.env`: `NEXTAUTH_URL=https://prepossessionary-frontoparietal-charlsie.ngrok-free.dev` (identical to `PUBLIC_URL`). Remove the stale duplicate in `apps/dashboard/.env` so the root value wins.
2. `https://` origin → next-auth sets `__Secure-`/`__Host-` cookies; `http://localhost:3000` stops holding a session. `start.sh` step 9 opens the static URL; use it on the Mac too. (Optional dev escape hatch: `NEXTAUTH_URL_LOCAL=http://localhost:3000` honored only when `NODE_ENV=development`.)
3. Every other absolute-link builder reads env first (`forgot-password`, `stripe/connect`, `tenants/[id]/convert`, website preview) — they follow automatically. Stripe/Plaid redirect URIs, when configured later, must list the static domain.
4. Hosted survey links unaffected: `resolvePublicBaseUrl()` uses `sms_relay.survey_base_url` (the static domain) and `/survey/*` is routed to Fastify.
5. **Quota-safe polling** — root fix in `apps/dashboard/src/app/admin/system/page.tsx` (the only poller in the app): interval 30 s → 120 s; pause while `document.visibilityState !== "visible"` and refetch once on return; stop after 3 consecutive failures with a "paused — click to resume" state; the 1 s countdown ticker stays client-only. Worst case drops from ~2,880 → ≤ 720 requests/day per open tab, and a background tab costs 0. Add a code-comment rule: **no new pollers in the dashboard without a visibility gate** (every request is metered on the Free plan).

**Gate:** from a non-tailnet device: open `https://<static>/`, click through the interstitial, log in, refresh, navigate 3 pages, log out — `localhost` never appears and no `http://` redirect occurs (every 3xx `Location` is relative or `https://`). Create a fresh non-onboarded user → landing on `/` redirects to `https://<static>/onboarding`. Leave Admin → System open in a background tab for 10 min → ngrok inspector (`127.0.0.1:4040`) shows 0 requests from it.

### M4 — Quota watch + kill-switch
1. `web-off` / `web-on` (M2.5) are the kill-switch: static domain → Fastify directly; webhooks + hosted survey + owner page keep working; dashboard offline until `web-on`. Also as `start.sh web-off|web-on` subcommands.
2. Rule of thumb: check ngrok's Usage page mid-month; past ~15k requests, `web-off` until the 1st. Dashboard pages are typically 20–60 requests on first load, ~5–15 per navigation afterwards (cached `_next/static`).
3. Later, if wanted: Hobbyist ($10/mo) removes the interstitial, raises the quota to 100k, adds an OAuth allow-list in front of the dashboard, and gives static domains for a tenant-site endpoint. Drop-in on top of this design.

**Gate:** `web-off` → `https://<static>/login` returns Fastify 404 while `/health` and a test SMS still work; `web-on` restores the dashboard; the Phone System panel shows the right label in both states.

### M5 — Keep it up
1. Mac mini: Energy → prevent sleep when display off; wake for network access.
2. `launchd` LaunchAgent (`~/Library/LaunchAgents/com.tenantai.launcher.plist`, `RunAtLoad` + `KeepAlive`) running `start.sh`, logging to `~/Library/Logs/tenant-ai.log` — same pattern as PocketBrick's `install-when-home.sh`.

**Gate:** reboot the Mac → within ~2 min `https://<static>/health` (Fastify) and `https://<static>/login` (dashboard) both answer; Telnyx test SMS round-trips.

---

## 4. Files touched

| File | Change |
|---|---|
| `packages/shared/src/integrations.ts` | `sms_relay.survey_mode`, `sms_relay.google_form_url` (text fields + envVars) |
| `apps/server/src/handlers/survey-intake.ts` (+ test) | `resolveSurveyLink()` — the only caller of `buildSurveyUrl` |
| `apps/server/src/routes/internal.ts`, `apps/server/scripts/send-survey-once.ts` | use `resolveSurveyLink()` |
| `apps/dashboard/src/app/admin/sms-relay/page.tsx` | survey-mode status chip |
| `ops/Caddyfile` | new — path split :3010, forced `X-Forwarded-Proto https` |
| `start.sh` | pinned ports, Caddy start + degradation, tunnel → `WEB_TARGET`, `web-off`/`web-on`, open static URL |
| `apps/dashboard/src/lib/phone-system.ts` (+ test) | tunnel-target state model, `PROXY_PORT`, Caddy health, `web-off`/`web-on` |
| `apps/dashboard/src/app/admin/system/page.tsx` | web-off/on buttons, target label; **visibility-gated 120 s polling** |
| `.env`, `apps/dashboard/.env`, `.env.example` | `NEXTAUTH_URL` = static domain, `PROXY_PORT`, pinned `SERVER_PORT`, `SMS_RELAY_SURVEY_MODE`, `SMS_RELAY_GOOGLE_FORM_URL` |
| `~/Library/LaunchAgents/com.tenantai.launcher.plist` | new (M5) |

No Prisma migration, no new npm packages; one Homebrew package (`caddy`). Order: **M1 first** (independent, immediately useful) → M2 → M3 → M4 → M5.

## 5. Security notes
- Dashboard becomes internet-facing on a known URL (the one Twilio/Telnyx already know). In place: credential lockout (5 tries / 15 min), helmet on the API, CAPTCHA on apply. `/internal/*` is no longer publicly routable. Postgres/Redis/MinIO stay localhost-only; Caddy binds 127.0.0.1. `ngrok.yml` (authtoken) stays out of the repo.
- Google Form mode: applicant data lives in Google, not in the encrypted `Application` table — the Applications tab won't show those; Mr. Jo's Docs connection is the record.

## 6. Out of scope / recorded
- **Tenant site remote access.** Not on a random-URL endpoint — tenant-site URLs are texted to tenants (`notice-sms.ts`, convert), and a URL that changes on restart must never be texted. Options when needed: Hobbyist static domain, or `basePath: "/site"` behind Caddy. Pre-existing bug to fix separately: those texted links currently embed `http://localhost:3002`.
- Second instance / DB sync; tailnet route (parked: `tailscale serve --https=8470/8471`; Mac `:443` is claude-web-bridge); toggling the static domain between API and dashboard (rejected, §2); the production nginx/docker-compose deploy on a real domain.
