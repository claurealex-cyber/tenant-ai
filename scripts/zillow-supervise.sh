#!/bin/bash
# Iris-cron daily supervisor for the Zillow automation (zero-token).
# Convention (iris-cron.py wrapper): stdout "all clear" → silent;
# anything else → macOS notification with the output as the message.
set -uo pipefail
cd /Users/alejandroclaure/tenant-ai/apps/server
set -a; source .env 2>/dev/null || true; set +a

# The API server port is dynamic (start.sh falls back when 3001 is taken).
PORT=""
for p in 3005 3001 3006 3007 3008; do
  if curl -sf -m 3 "http://localhost:$p/health" 2>/dev/null | grep -q '"status":"ok"'; then
    PORT=$p; break
  fi
done
if [ -z "$PORT" ]; then
  echo "Zillow automation: tenant-ai server is not running on any known port."
  exit 0
fi

SERVER_PORT=$PORT npx tsx scripts/zillow-auto-supervise.ts
