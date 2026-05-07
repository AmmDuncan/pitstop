#!/usr/bin/env bash
# pitstop-session-id.sh — SessionStart hook for Claude Code.
#
# Captures CC's session_id (passed as JSON on stdin per the hooks spec) into
# ~/.claude/pitstop/cc-session-<ppid>.txt so the pitstop MCP adapter can
# bind to it. CC does NOT pass session_id to MCP server subprocesses via env
# or in the JSON-RPC stream — this hook is the bridge.
#
# $PPID is the CC process that spawned this hook. The MCP adapter that CC
# spawns has the same parent, so it finds the matching file via process.ppid.

set -uo pipefail

INPUT="$(cat)"
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
[ -z "$SID" ] && exit 0

mkdir -p "$HOME/.claude/pitstop"
printf '%s\n' "$SID" > "$HOME/.claude/pitstop/cc-session-$PPID.txt"
exit 0
