#!/bin/zsh
# Install (or reinstall) the Tenant AI LaunchAgent: starts start.sh at login and
# relaunches it if a server process dies. Dock relaunches keep working (they
# take over via the pidfile; the agent does not fight them).
#   ops/install-launchd.sh            install + start now
#   ops/install-launchd.sh uninstall  remove
set -e
LABEL=com.tenantai.launcher
SRC="$(cd "$(dirname "$0")" && pwd)/$LABEL.plist"
DST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_=$(id -u)
launchctl bootout "gui/$UID_/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "uninstall" ]; then rm -f "$DST"; echo "removed $LABEL"; exit 0; fi
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$SRC" "$DST"
plutil -lint "$DST" >/dev/null
launchctl bootstrap "gui/$UID_" "$DST"
launchctl enable "gui/$UID_/$LABEL"
echo "installed $LABEL (log: ~/Library/Logs/tenant-ai.log)"
launchctl print "gui/$UID_/$LABEL" | grep -E "state|pid" | head -3
