#!/bin/zsh
# Tenant AI launcher — serves the PRODUCTION build.
# Starts Colima (Docker), infra containers, applies DB migrations, (re)builds with
# Turbo (cached, so it's instant when nothing changed), and serves the production
# build. Edit this file to change what the Dock shortcut does.

set -e

# Dock-launched apps get a minimal environment — make sure Homebrew tools are found.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

PROJECT_DIR="/Users/alejandroclaure/tenant-ai"
cd "$PROJECT_DIR"

# Load environment (DATABASE_URL, secrets, etc.) for the server + Next apps.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# ── Subcommands: `start.sh web-off` / `start.sh web-on` ─────────────────────
# Retarget the static ngrok domain without restarting anything:
#   web-on  → Caddy proxy  (dashboard reachable from anywhere)
#   web-off → API server   (quota kill-switch; phones + hosted survey keep working)
NGROK_API="http://127.0.0.1:4040"
retarget_tunnel() {  # $1 = port
  local domain="${PUBLIC_URL#https://}"
  local name
  name=$(curl -sf "$NGROK_API/api/tunnels" | python3 -c "import sys,json;[print(t['name']) for t in json.load(sys.stdin)['tunnels'] if '$domain' in t['public_url']]" 2>/dev/null | head -1)
  [ -n "$name" ] && curl -sf -X DELETE "$NGROK_API/api/tunnels/$name" >/dev/null 2>&1
  curl -sf -X POST "$NGROK_API/api/tunnels" -H 'Content-Type: application/json' \
    -d "{\"name\":\"tenant-ai\",\"proto\":\"http\",\"addr\":\"$1\",\"domain\":\"$domain\"}" >/dev/null
}
case "${1:-}" in
  web-off)
    retarget_tunnel "${SERVER_PORT:-3005}" && echo "✓ web access OFF — $PUBLIC_URL → server :${SERVER_PORT:-3005}" || { echo "✗ could not retarget (is ngrok running?)"; exit 1; }
    exit 0 ;;
  web-on)
    curl -sf -m 3 "http://127.0.0.1:${PROXY_PORT:-3010}/health" >/dev/null || { echo "✗ Caddy proxy not answering on :${PROXY_PORT:-3010} — relaunch Tenant AI"; exit 1; }
    retarget_tunnel "${PROXY_PORT:-3010}" && echo "✓ web access ON — $PUBLIC_URL → proxy :${PROXY_PORT:-3010}" || { echo "✗ could not retarget (is ngrok running?)"; exit 1; }
    exit 0 ;;
  "") ;;
  *) echo "usage: start.sh [web-on|web-off]"; exit 2 ;;
esac

# Cap the logs THIS script appends to so an always-on (launchd KeepAlive)
# launcher can never fill the disk over time. Must ALWAYS return 0 — the script
# runs under `set -e`, and a size test that fails on a small file would abort
# the whole launcher. Deliberately does NOT touch tenant-ai.log: that is
# launchd's StandardOutPath (its open fd), truncating it fights launchd.
rotate_log() {
  if [ -f "$1" ] && [ "$(stat -f%z "$1" 2>/dev/null || echo 0)" -gt 20971520 ]; then
    : > "$1"
  fi
  return 0
}
rotate_log "$HOME/Library/Logs/tenant-ai-ngrok.log"
rotate_log "$HOME/Library/Logs/tenant-ai-launch.log"

echo "▶ Tenant AI launcher (production build)"
echo

# 0. If a previous instance is running, stop it — relaunching means "restart".
PIDFILE="$PROJECT_DIR/.launcher.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "▶ Stopping previous Tenant AI instance…"
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  for i in {1..10}; do
    kill -0 "$(cat "$PIDFILE")" 2>/dev/null || break
    sleep 1
  done
fi
echo $$ > "$PIDFILE"

# Clean up any orphaned Next.js servers from a crashed instance (they hold
# ports 3000/3002 and would block startup).
for port in 3000 3002; do
  pid=$(lsof -nP -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1)
  if [ -n "$pid" ] && ps -p "$pid" -o command= 2>/dev/null | grep -q "next-server"; then
    echo "▶ Stopping orphaned server on port $port"
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
done

# Orphaned Caddy proxy from a crashed instance holds PROXY_PORT.
pid=$(lsof -nP -tiTCP:${PROXY_PORT:-3010} -sTCP:LISTEN 2>/dev/null | head -1)
if [ -n "$pid" ] && ps -p "$pid" -o command= 2>/dev/null | grep -q "caddy"; then
  echo "▶ Stopping orphaned Caddy proxy on port ${PROXY_PORT:-3010}"
  kill "$pid" 2>/dev/null || true
  sleep 1
fi

# Also stop orphaned API servers (tsx dev instances or prior prod starts) so a
# relaunch takes over their port instead of drifting the ngrok tunnel to a new
# one — the SMS-relay webhook depends on the tunnel target staying put.
for port in 3005 3006 3007 3008; do
  pid=$(lsof -nP -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1)
  if [ -n "$pid" ] && ps -p "$pid" -o command= 2>/dev/null | grep -Eq "tsx src/index.ts|server/dist/index.js"; then
    echo "▶ Stopping orphaned API server on port $port"
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
done

# 1. Start Colima (the Docker daemon) if it isn't already up.
if ! docker info >/dev/null 2>&1; then
  echo "▶ Starting Colima (Docker daemon)… ~30s on a cold start"
  colima start
else
  echo "✓ Docker daemon already running"
fi

# 2. Bring up the infra containers the apps depend on.
echo "▶ Starting infra containers (postgres, redis, minio)…"
docker compose up -d postgres redis minio

# 3. Free port 3000 for the dashboard. Other projects' containers (invidious)
#    also publish 3000 and grab it whenever it's free.
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  holders=$(docker ps --format '{{.Names}}\t{{.Ports}}' | awk -F'\t' '$2 ~ /:3000->/ {print $1}')
  if [ -n "$holders" ]; then
    echo "▶ Port 3000 is held by container(s): ${holders//$'\n'/, } — stopping them"
    echo "$holders" | xargs docker stop >/dev/null
    sleep 2
  fi
  if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✗ Port 3000 is still in use by a non-Docker process:"
    lsof -nP -iTCP:3000 -sTCP:LISTEN
    echo "  Stop it and relaunch."
    exit 1
  fi
fi

# 4. API server port is PINNED (SERVER_PORT in .env, 3005). It used to hunt
#    for a free port, but the Caddy proxy (ops/Caddyfile) and the ngrok tunnel
#    both need a fixed target — a moving port would silently desync them.
if lsof -nP -iTCP:${SERVER_PORT:-3005} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✗ Port ${SERVER_PORT:-3005} (API server) is held by another process:"
  lsof -nP -iTCP:${SERVER_PORT:-3005} -sTCP:LISTEN
  echo "  Stop it and relaunch (SERVER_PORT is pinned so ops/Caddyfile and the tunnel stay in sync)."
  exit 1
fi

# 5. Wait for Postgres to accept connections.
echo "▶ Waiting for Postgres (localhost:5433)…"
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready >/dev/null 2>&1; then
    echo "✓ Postgres ready"
    break
  fi
  sleep 1
done

# 6. Apply any pending database migrations (no-op when already up to date).
echo "▶ Applying database migrations…"
( cd apps/server && npx prisma migrate deploy )

# 7. Build the production bundles (Turbo cache makes this instant if unchanged).
echo "▶ Building production bundles…"
npm run build

# 7b. Caddy path-split proxy (ops/Caddyfile): the single static ngrok domain
#     serves BOTH the API (webhook/survey paths) and the dashboard (everything
#     else). If Caddy is missing or fails to bind, the tunnel falls back to the
#     API server directly — phones never depend on the proxy; only the
#     dashboard's public access does.
PROXY_PORT="${PROXY_PORT:-3010}"
WEB_TARGET="${SERVER_PORT:-3005}"
if command -v caddy >/dev/null 2>&1; then
  ( caddy run --config "$PROJECT_DIR/ops/Caddyfile" >/dev/null 2>&1 ) &
  for i in {1..6}; do
    lsof -nP -iTCP:$PROXY_PORT -sTCP:LISTEN >/dev/null 2>&1 && break
    sleep 0.5
  done
  if lsof -nP -iTCP:$PROXY_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✓ Caddy proxy on 127.0.0.1:$PROXY_PORT (webhooks → :${SERVER_PORT:-3005}, dashboard → :3000)"
    WEB_TARGET="$PROXY_PORT"
  else
    echo "⚠ Caddy failed to start — dashboard will NOT be public (tunnel → API server directly)"
  fi
else
  echo "⚠ caddy not installed (brew install caddy) — dashboard will NOT be public (tunnel → API server directly)"
fi

# 8. Start the ngrok tunnel so Twilio (calls + SMS) — and, via Caddy, the
#    dashboard — are reachable on the static domain from PUBLIC_URL in .env.
#    Non-fatal if it fails — the Phone System panel in Admin → System can also
#    start it. A relaunch always resets the tunnel to the NORMAL target
#    (proxy when Caddy is up): relaunching from the Dock is the recovery path
#    after `web-off`, which makes the dashboard unreachable from outside.
if [ -n "$PUBLIC_URL" ] && command -v ngrok >/dev/null 2>&1; then
  ngrok_domain="${PUBLIC_URL#https://}"
  tunnels=$(curl -sf "$NGROK_API/api/tunnels" 2>/dev/null || true)
  NGROK_LOG="$HOME/Library/Logs/tenant-ai-ngrok.log"
  # Spawn the agent and PROVE the tunnel exists via the local API. The Free plan
  # allows one agent session: right after a takeover the previous session can
  # still be draining, so the first attempt may come up without a tunnel (and
  # with its output in /dev/null nobody could tell). Log to a file, wait for the
  # old agent to release :4040, verify, and retry once.
  start_ngrok() {
    for attempt in 1 2; do
      pkill -x ngrok 2>/dev/null || true
      for i in {1..10}; do lsof -nP -iTCP:4040 -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done
      echo "▶ Starting ngrok tunnel ($ngrok_domain → localhost:$WEB_TARGET) [attempt $attempt, log: $NGROK_LOG]…"
      (ngrok http --url="$ngrok_domain" "$WEB_TARGET" --log=stdout >> "$NGROK_LOG" 2>&1 &)
      for i in {1..20}; do
        if curl -sf -m 2 "$NGROK_API/api/tunnels" 2>/dev/null | grep -q "localhost:$WEB_TARGET\""; then
          echo "✓ ngrok tunnel up ($ngrok_domain → localhost:$WEB_TARGET)"; return 0
        fi
        sleep 1
      done
      echo "⚠ ngrok tunnel not confirmed within 20s — $(grep -oE 'ERR_NGROK_[0-9]+[^\"]*' "$NGROK_LOG" | tail -1)"
      [ $attempt -eq 1 ] && sleep 5
    done
    echo "✗ ngrok tunnel failed twice — phones are OFFLINE; see $NGROK_LOG or use the Phone System panel"
    return 1
  }
  if echo "$tunnels" | grep -q "$ngrok_domain" && echo "$tunnels" | grep -q "localhost:$WEB_TARGET\""; then
    echo "✓ ngrok tunnel already running ($ngrok_domain → localhost:$WEB_TARGET)"
  elif echo "$tunnels" | grep -q "$ngrok_domain"; then
    echo "▶ Retargeting ngrok tunnel to localhost:$WEB_TARGET (was $(echo "$tunnels" | grep -oE "localhost:[0-9]+" | head -1))…"
    retarget_tunnel "$WEB_TARGET" || start_ngrok || true
  else
    start_ngrok || true
  fi
fi

# 9. Open the dashboard once the servers have had a moment to boot. The
#    session cookie is Secure (NEXTAUTH_URL is https), so use the public URL
#    even on this Mac — http://localhost:3000 can no longer hold a login.
DASH_URL="${NEXTAUTH_URL:-http://localhost:3000}"
( sleep 6; open "$DASH_URL" ) &

# 10. Serve the production build. Ctrl-C in this window stops all three servers.
echo
echo "▶ Serving production build:"
echo "    Dashboard:   $DASH_URL   (from anywhere; local port 3000)"
if [ "$WEB_TARGET" = "$PROXY_PORT" ]; then
  echo "    Public:      $PUBLIC_URL → Caddy :$PROXY_PORT → API :${SERVER_PORT:-3005} + dashboard :3000"
else
  echo "    Public:      $PUBLIC_URL → API :${SERVER_PORT:-3005} only (dashboard local-only)"
fi
echo "    API server:  http://localhost:${SERVER_PORT:-3005}"
echo "    Tenant site: http://localhost:3002"
echo "  Toggle public dashboard access without restarting:  ./start.sh web-off | web-on"
echo "  (Press Ctrl-C in this window to stop.)"
echo
# Only remove the pidfile if it still holds OUR pid — during a takeover the
# new instance has already overwritten it, and deleting it would break the
# next relaunch's ability to find and stop the new instance.
# Exit codes matter under launchd (KeepAlive SuccessfulExit=false):
#   INT/TERM (Ctrl-C, or a Dock relaunch taking over) → exit 0 → NOT relaunched
#   a server process dying on its own                 → exit 1 → relaunched
cleanup() {
  [ "$(cat "$PIDFILE" 2>/dev/null)" = "$$" ] && rm -f "$PIDFILE"
  # `kill 0` signals our whole process group INCLUDING this shell; ignore TERM
  # first so the intended exit code (0 = deliberate stop, 1 = crash) survives.
  trap '' TERM INT
  kill 0 2>/dev/null
}
trap 'cleanup; exit 0' INT TERM
trap 'cleanup' EXIT
( cd apps/server && npm start ) &      pid_api=$!
( cd apps/dashboard && npm start ) &   pid_dash=$!
( cd apps/tenant-site && npm start ) & pid_site=$!
# zsh has no `wait -n`: poll the three children; the first one to die ends the
# launcher with exit 1 so launchd relaunches the whole set.
while sleep 5; do
  for p in $pid_api $pid_dash $pid_site; do
    if ! kill -0 "$p" 2>/dev/null; then
      echo "✗ a Tenant AI server process (pid $p) exited — stopping the rest (launchd will relaunch)"
      exit 1
    fi
  done
done
