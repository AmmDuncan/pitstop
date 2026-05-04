#!/usr/bin/env bash
# pitstop-context.sh — UserPromptSubmit hook for Claude Code.
# Surfaces unread pitstop responses as additional context on every user prompt
# when an active pitstop session exists for $PWD. Read-only — does not flip
# `addressed: true`; the agent must call mcp__pitstop__get_unread_responses to
# atomically drain the queue.

set -uo pipefail

HOST="${PITSTOP_HOST:-http://localhost:7773}"

SID=$(curl -sf "$HOST/api/sessions/active?projectRoot=$PWD" 2>/dev/null | jq -r '.id // empty' 2>/dev/null)
[ -z "$SID" ] && exit 0

UNREAD=$(curl -sf "$HOST/api/sessions/$SID/responses?unaddressed=true" 2>/dev/null)
if [ -n "$UNREAD" ] && [ "$UNREAD" != "[]" ]; then
  echo "[pitstop unread responses] session=$SID"
  echo "$UNREAD" | jq -c '.[]?' 2>/dev/null
fi
exit 0
