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

# 4. Pick the API server port. 3001 is the default, but other services
#    (claude-web-bridge) sometimes hold it — fall back to the next free port.
#    Every part of the app reads SERVER_PORT at runtime, so any port works.
if lsof -nP -iTCP:${SERVER_PORT:-3001} -sTCP:LISTEN >/dev/null 2>&1; then
  for candidate in 3005 3006 3007 3008; do
    if ! lsof -nP -iTCP:$candidate -sTCP:LISTEN >/dev/null 2>&1; then
      echo "▶ Port ${SERVER_PORT:-3001} is busy — API server will use $candidate"
      export SERVER_PORT=$candidate
      break
    fi
  done
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

# 8. Start the ngrok tunnel so Twilio (calls + SMS) can reach the server.
#    Uses the static domain from PUBLIC_URL in .env. Non-fatal if it fails —
#    the Phone System panel in Admin → System Health can also start it.
if [ -n "$PUBLIC_URL" ] && command -v ngrok >/dev/null 2>&1; then
  ngrok_domain="${PUBLIC_URL#https://}"
  tunnels=$(curl -sf http://127.0.0.1:4040/api/tunnels 2>/dev/null || true)
  if echo "$tunnels" | grep -q "$ngrok_domain" && echo "$tunnels" | grep -q "localhost:${SERVER_PORT:-3001}"; then
    echo "✓ ngrok tunnel already running → localhost:${SERVER_PORT:-3001}"
  else
    if [ -n "$tunnels" ]; then
      echo "▶ Restarting ngrok tunnel to target localhost:${SERVER_PORT:-3001}…"
      pkill -x ngrok 2>/dev/null || true
      sleep 1
    else
      echo "▶ Starting ngrok tunnel ($ngrok_domain → localhost:${SERVER_PORT:-3001})…"
    fi
    (ngrok http --url="$ngrok_domain" "${SERVER_PORT:-3001}" --log=stdout >/dev/null 2>&1 &)
  fi
fi

# 9. Open the dashboard once the servers have had a moment to boot.
( sleep 6; open "http://localhost:3000" ) &

# 10. Serve the production build. Ctrl-C in this window stops all three servers.
echo
echo "▶ Serving production build:"
echo "    Dashboard:   http://localhost:3000"
echo "    API server:  http://localhost:${SERVER_PORT:-3001}"
echo "    Tenant site: http://localhost:3002"
echo "  (Press Ctrl-C in this window to stop.)"
echo
# Only remove the pidfile if it still holds OUR pid — during a takeover the
# new instance has already overwritten it, and deleting it would break the
# next relaunch's ability to find and stop the new instance.
trap '[ "$(cat "$PIDFILE" 2>/dev/null)" = "$$" ] && rm -f "$PIDFILE"; kill 0' EXIT INT TERM
( cd apps/server && npm start ) &
( cd apps/dashboard && npm start ) &
( cd apps/tenant-site && npm start ) &
wait
