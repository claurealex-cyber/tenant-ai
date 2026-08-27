# Tenant-AI — Remote Control App (restart + live access links over Tailnet)

> **BUILT 2026-08-27 (NOT yet installed — by request, not restarted/tested live).** Agent lives
> at `~/tenant-ai-control/` (zero-dependency Node, built-ins only). Done: M0 spike (detached
> launch survives `kill 0`, control case dies — proven), M1 agent (`/status /restart /web /logs`,
> token auth, single-flight restart, launchd plist + installer), M2 access-link surfacing
> (web-on→stable ngrok dashboard URL; web-off→kill-switch message; URL-change flag), M3 web
> control panel + PWA (installs as an app on Windows/iPhone). **20/20 tests green** incl. the
> detached-`kill 0` survival; **read-only live /status** correctly read the running stack
> (api up, dashboard up, web "on", real URL, launcher alive) and 401'd without a token. M4 native
> wrapper: delivered as a **PWA install** (Add to Home Screen / Install app) — a separate Tauri
> binary was deferred (needs a Windows build toolchain; PWA is the testable, genuinely-installable
> answer). NOT done (awaiting user): `./install.sh` to go live, and firing `/restart` + `/web`
> against the real stack. Restart/web were exercised with mocks only, never live.


**Goal:** A small app on the other tailnet devices (Windows desktop, iPhones) that can
**restart Tenant AI on the Mac with one button** — like the `Tenant AI.app` Dock launcher does
locally — and **shows the current link(s) to reach the dashboard from anywhere**, flagging
changes.

**Investigate-only plan.** Nothing is built here.

> **Stress-tested & root-fixed 2026-08-27.** The first draft rested on two premises that a
> deeper look at `start.sh` and `ops/Caddyfile` proved **false or obsolete**. Corrections are
> marked ⟲. Net effect: the "access URL" half of the app shrinks dramatically (the dashboard is
> ALREADY reachable at one stable URL), and the "restart" half gains a critical safety fix.

---

## 0. Investigation findings (verified 2026-08-27)

**Tailnet is fully in place.** One owner; devices: Mac `alejandros-mac-mini.tail1200f6.ts.net`
(100.104.222.121, the server), `desktop-5fgsuvg` (Windows), `iphone-13`, `iphone-14`.

**Launcher = AppleScript applet → Terminal.** `Tenant AI.app` runs `main.scpt`, which does
`tell application "Terminal" to do script "'…/start.sh'"`. Crucially, it launches start.sh in a
**brand-new Terminal process**, fully isolated from the applet.

**⟲ FALSE PREMISE #1 — "the ngrok link changes / dashboard access is broken."** Reality, from
`start.sh` + `ops/Caddyfile`:
- `PUBLIC_URL` is a **reserved static ngrok domain** — it does not change.
- Ports are now **pinned** (`start.sh` comment: *"API server port is PINNED… It used to hunt"*):
  API `:3005`, Caddy proxy `:3010`, dashboard `:3000`, tenant-site `:3002`.
- **Caddy is the single front door.** ngrok → Caddy `:3010`, which path-splits: webhook/survey/
  owner/health/media paths → API `:3005`; **everything else → the dashboard `:3000`**.
- **Therefore the dashboard is ALREADY reachable from anywhere at the stable ngrok URL.**
  Verified live: `GET https://…ngrok-free.dev/` → HTTP 307 (dashboard redirect). No per-restart
  link change, no broken access to repair.

**⟲ What actually varies — the web ON/OFF kill-switch.** `start.sh web-on` / `web-off` retarget
the static ngrok domain *without a restart*: **web-on** → Caddy `:3010` (dashboard reachable
from anywhere); **web-off** → API `:3005` directly (quota kill-switch; phones + hosted survey
keep working, dashboard goes dark publicly). This on/off state is the ONE meaningful thing to
display and toggle — not a "new link."

**⟲ Tailscale Serve → :3001 is stale/vestigial** (pre-Caddy). `serve status` proxies
`https://…ts.net/` → `127.0.0.1:3001`, but nothing serves 3001. It's a leftover; if a *tailnet*
dashboard URL is wanted it should proxy to **Caddy :3010** (identical behavior to ngrok,
including the X-Forwarded-Proto handling Next.js needs). Existing serve entries
(`/pocketbrick`, `:8452 → :8090`) must NOT be clobbered.

**⟲ CRITICAL BUILD HAZARD — `kill 0` in start.sh.** `start.sh` ends with
`cleanup(){ trap '' TERM INT; kill 0; }` on EXIT/INT/TERM — it signals its **entire process
group**. The Dock applet is safe only because Terminal runs start.sh in a separate process.
**If the control agent spawns start.sh as a normal child, the takeover's `kill 0` will kill the
agent too.** The agent MUST launch start.sh **fully detached in its own session/process group**
(the way Terminal does) — this is the single most important correctness requirement.

**⟲ Config inconsistency to design around.** `.env` has `SERVER_PORT=3001`, but start.sh
defaults to `3005` and the running API is on `:3005`. The agent must therefore **discover live
targets** (from the ngrok 4040 API and by probing Caddy), never trust a hardcoded/`.env` port.

---

## 1. Architecture (revised)

The dashboard link already exists; the app's real unique value is **Restart + web on/off +
status**. Reframed as a *control panel*, not a networking layer.

```
 Other device (Windows / iPhone, on tailnet)
   Remote Control app  ── HTTP over tailnet ──▶  Mac: Control Agent (always-on, launchd)
     • status card              GET /status          • probe Caddy :3010/health + dashboard
     • [Restart] (confirm)      POST /restart        • launch start.sh DETACHED (own session)
     • [Web ON] / [Web OFF]     POST /web {on|off}   • shell `start.sh web-on|web-off`
     • shows the stable link    (token auth)         • read ngrok 4040 → publicUrl + live target
     • [Open Dashboard]                              • (optional) repair stale tailscale serve
```

**⟲ Reachability (decided): direct MagicDNS:port over the tailnet — no Tailscale Serve for the
agent.** Bind the agent to the **Tailscale IP** (`100.104.222.121`) on a fixed port outside the
stack's range (e.g. **4610**; avoid 3000/3002/3005/3007/3008/3010/4040/8451/8452/8090). Clients
hit `http://alejandros-mac-mini.tail1200f6.ts.net:4610`. Plain HTTP is fine — the tailnet
transport is already WireGuard-encrypted, and binding to the Tailscale IP means **only tailnet
peers can reach it** (not the LAN, not the public ngrok/Caddy front door). This sidesteps the
`tailscale serve` privilege question entirely. A **bearer token** (`x-control-token`,
constant-time) is defense-in-depth on top of tailnet ACLs.

**Separate always-on process.** The agent restarts tenant-ai — often *because it's down* — so it
is its own launchd agent (`dev.tenantai.control`, KeepAlive+RunAtLoad), never part of tenant-ai,
and it must **never** be exposed through the public ngrok/Caddy path (restart-over-internet =
no).

---

## 2. Milestones

### M0 — Recon + decisions  ✅ (findings §0)
- [x] Tailnet, launcher, Caddy front door, pinned ports, web on/off switch, `kill 0` hazard,
      stale serve — all identified.
- [ ] Confirm the agent's fixed port is free and stays free across a restart (pick 4610; verify
      start.sh's cleanup never touches it).
- [ ] Confirm launching start.sh detached from a launchd-run Node process actually survives the
      `kill 0` takeover (spike: `setsid`/`nohup` in a fresh group, trigger a second restart,
      assert the agent PID lives). ⟲ This spike gates M1.
- **Gate:** agent port chosen; detached-launch survival proven in a throwaway spike.

### M1 — Control Agent (the trusted core)
- [ ] Standalone service (`~/tenant-ai-control/`, Node/Fastify, SEPARATE package). Endpoints:
      - `GET /status` → `{ dashboard:{ok}, api:{ok}, web:{mode:"on"|"off", publicUrl, target},
        launcherRunning, lastRestartAt }` — all **discovered live** (probe Caddy :3010, read
        ngrok 4040), never hardcoded ports.
      - `POST /restart` → launches `start.sh` **detached in its own session** (the §0 hazard
        fix), then polls `:3010/health` + dashboard until healthy or a generous timeout
        (start.sh rebuilds — allow minutes), returns the outcome + log tail.
      - `POST /web {on|off}` → shells `start.sh web-on|web-off` (cheap ngrok retarget, no
        restart); returns the new `web.mode`.
      - `GET /logs?tail=N` → last N lines of the launcher log (read-only).
- [ ] Bind to the Tailscale IP:4610; token auth from a 0600 config (not in git).
- [ ] launchd `dev.tenantai.control` (KeepAlive, RunAtLoad) + install script.
- [ ] Tests: status assembly from mocked Caddy/4040 responses; restart single-flight lock;
      **detached-launch does not die on `kill 0`** (the spike, as a test); web on/off shells the
      right subcommand; bad-token 401; health-poll timeout returns the log tail.
- **Gate:** from a second tailnet device, `curl` the agent → correct status; `POST /restart`
      restarts the Mac stack and returns healthy; the agent PID is unchanged afterward; a
      concurrent restart is refused; `web off`/`web on` flips the ngrok target as shown by 4040.

### M2 — Access-link surfacing (much smaller than v1)
- [ ] `/status` reports the **stable dashboard URL** = `PUBLIC_URL` when `web.mode==="on"`, and a
      clear "dashboard is OFF (kill-switch) — turn Web ON to reach it remotely" when off.
- [ ] Change-flag: persist last-seen `publicUrl`; flag only a genuine domain change (rare —
      reserved domain), so the client can highlight it if it ever happens.
- [ ] **Optional** `POST /repair-serve`: surgically re-point the stale `tailscale serve /` from
      `:3001` → Caddy `:3010` (leaving `/pocketbrick` + `:8452` intact) so a *tailnet* dashboard
      URL also works — only if M0 confirms serve reconfiguration doesn't need interactive sudo;
      otherwise document it as a one-time manual `tailscale serve` fix and drop the endpoint.
- [ ] Tests: URL/mode derivation from web on/off; change-flag across snapshots; serve-repair
      command leaves other mappings intact (string-built, asserted).
- **Gate:** with web ON, `/status` shows the working stable dashboard link; toggling web OFF
      shows the kill-switch message; (if kept) repair-serve makes the tailnet URL resolve
      without breaking pocketbrick.

### M3 — Remote Control web app (served by the agent)
- [ ] Self-contained page the agent serves at its tailnet URL: status card (dashboard/api up,
      web on/off), the **stable dashboard link** (big, tap-to-open) shown only when web is ON, a
      **Restart** button (confirm + live progress), a **Web ON/OFF** toggle, and a log peek.
      Token entered once, stored client-side. Auto-refreshes; handles agent-unreachable.
- [ ] PWA manifest + icon so it installs to the Windows taskbar / iPhone home screen.
- [ ] Tests: renders each state (up / down / restarting / web-off / link-changed); restart &
      web-toggle call the endpoints with the token; agent-unreachable state.
- **Gate:** open the URL on the Windows desktop and an iPhone → live status; tap Restart → Mac
      stack restarts and the page shows it healthy with the current link; toggle Web on/off works.

### M4 — Downloadable native/PWA wrappers (optional; matches the Dock-app feel)
- [ ] Desktop: thin Tauri (preferred) or Electron wrapper loading the agent URL + a tray
      "Restart Tenant AI" item — a real double-click app for the Windows desktop (Mac build for
      parity).
- [ ] Phones: the PWA "Add to Home Screen" path documented as the iPhone "app" (no App Store).
- [ ] Distributable artifacts + a one-page per-platform install doc.
- **Gate:** Windows desktop has a double-click app that restarts the Mac and shows the link;
      both iPhones have a home-screen icon doing the same.

### M5 — Hardening & handoff
- [ ] Restart safety: confirm + cooldown (no double-tap thrash); audit line per action.
- [ ] Agent self-recovery verified across a Mac reboot; agent logs rotate (mirror start.sh's own
      log-cap pattern).
- [ ] `docs/remote-control.md`: install, token rotation, what each button does, the
      tailnet-only / never-public security model, and the web on/off meaning.
- **Gate:** reboot the Mac → agent returns by itself; full flow works from a cold device.

---

## 3. Risks
| Risk | Mitigation |
|---|---|
| ⟲ `kill 0` takeover kills the agent | launch start.sh **detached in its own session** (Terminal-equivalent); proven in the M0 spike + an M1 test |
| Agent restart reachable from the internet | bind to the **Tailscale IP** only (never LAN/0.0.0.0, never the public Caddy/ngrok path) + bearer token |
| Restart thrash / overlap | single-flight lock + confirm + cooldown; `/restart` polls health before returning |
| Trusting a hardcoded/.env port (already inconsistent 3001 vs 3005) | discover targets live from ngrok 4040 + Caddy probe |
| Clobbering existing `tailscale serve` (`/pocketbrick`, `:8452`) | repair-serve is surgical + gated on non-interactive privilege; else manual one-time fix |
| Agent dies with tenant-ai | separate launchd process, KeepAlive+RunAtLoad, independent |
| Web left OFF → user thinks dashboard is "down" | `/status` explicitly distinguishes "kill-switch OFF" from "crashed"; one-tap Web ON |
| Token leak | 0600 config, not in git; rotation documented; tailnet still gates reach |

## 4. Out of scope
- Managing tenant-ai internals (the dashboard's job) — this app only restarts, toggles web, reports.
- Truly-public dashboard exposure beyond the existing ngrok front door (already handled by web-on).
- Multi-user/role auth — single owner, single token.
- Auto-updating the client apps (manual re-install on change for M4).
