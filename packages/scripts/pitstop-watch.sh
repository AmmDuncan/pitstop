#!/usr/bin/env bash
# pitstop-watch.sh — emits one stdout line per new unaddressed pitstop response.
# Designed to be invoked via Claude Code's `Monitor` tool; the start_review MCP
# call returns the exact command to invoke.
#
# Usage: pitstop-watch.sh <sessionId>
# Env:   PITSTOP_HOST (default http://localhost:7773)

set -uo pipefail

SID="${1:?sessionId required}"
HOST="${PITSTOP_HOST:-http://localhost:7773}"
LAST=0

while true; do
  RESP=$(curl -sf "$HOST/api/sessions/$SID/responses?since=$LAST&unaddressed=true" 2>/dev/null || echo '[]')
  echo "$RESP" | jq -c '.[]?' 2>/dev/null | while IFS= read -r line; do
    printf '%s\n' "$line"
  done
  LAST_NEW=$(echo "$RESP" | jq -r 'map(.at) | max // empty' 2>/dev/null)
  [ -n "$LAST_NEW" ] && LAST=$LAST_NEW
  sleep 1
done
