#!/usr/bin/env bash
# pitstop-context.sh — UserPromptSubmit hook for Claude Code.
# Surfaces unread pitstop responses as additional context on every user prompt
# when an active pitstop session exists for $PWD. Read-only — does not flip
# `addressed: true`; the agent must call mcp__pitstop__get_unread_responses to
# atomically drain the queue.
#
# Also emits a steering reminder when the pitstop drawer is wired for $PWD,
# nudging the agent to call start_review instead of asking the user to verify
# things in the browser manually.

set -uo pipefail

HOST="${PITSTOP_HOST:-http://localhost:7773}"

# Unread responses — only relevant when a session is active.
SID=$(curl -sf --max-time 2 "$HOST/api/sessions/active?projectRoot=$PWD" 2>/dev/null | jq -r '.id // empty' 2>/dev/null)
if [ -n "$SID" ]; then
  UNREAD=$(curl -sf --max-time 2 "$HOST/api/sessions/$SID/responses?unaddressed=true" 2>/dev/null)
  if [ -n "$UNREAD" ] && [ "$UNREAD" != "[]" ]; then
    echo "[pitstop unread responses] session=$SID"
    echo "$UNREAD" | jq -c '.[]?' 2>/dev/null
  fi
fi

# Drawer-wired steering — emit when the drawer is wired for this project so the
# agent reaches for start_review instead of "could you check this in the browser?"
WIRED=$(curl -sf --max-time 2 "$HOST/api/wired?projectRoot=$PWD" 2>/dev/null | jq -r '.wired // empty' 2>/dev/null)
if [ "$WIRED" = "true" ]; then
  echo "[pitstop drawer wired for $PWD]"
  echo "This project has pitstop's drawer wired. When you would otherwise ask the user to verify, check, or look at something in the browser, use mcp__pitstop__start_review to surface it as a review item instead. Each item lands in the drawer with the user's keyboard-driven review flow. Don't ask \"could you check...\" — call start_review with the items the user should see."
fi

exit 0
