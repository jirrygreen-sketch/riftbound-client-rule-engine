#!/usr/bin/env bash
# RIFT-1133: install (or refresh) the launchd job that runs pull.mjs every
# 5 minutes for the current macOS user. Idempotent; prints no secrets.
#   usage: scripts/issue-report-puller/install-launchd.sh [interval-seconds]
set -euo pipefail
INTERVAL=${1:-300}
LABEL=ai.riftbound.issue-report-puller
HERE=$(cd "$(dirname "$0")" && pwd)
NODE=$(command -v node)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/riftbound-issue-report-puller.log"
TOKEN_FILE="$HOME/.config/riftbound/issue-pull-token"

[ -s "$TOKEN_FILE" ] || { echo "missing $TOKEN_FILE (the RIFTBOUND_ISSUE_PULL_TOKEN value, mode 600)" >&2; exit 1; }
chmod 600 "$TOKEN_FILE"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$HERE/pull.mjs</string></array>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL (every ${INTERVAL}s), log: $LOG"
