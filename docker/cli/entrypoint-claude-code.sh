#!/usr/bin/env bash
# Drives Claude Code through the harness prompts, one non-interactive turn at
# a time, and leaves its transcripts in the mounted home directory for Lantern
# to read.
set -uo pipefail

# Drops to a non-root user and prepares a writable workspace at $WORK.
# Claude Code refuses to skip permission prompts while running as root, so this
# is required rather than tidiness.
. /usr/local/bin/bootstrap

PROMPTS="${PROMPTS:-/prompts}"
# A turn that never returns would hang the whole harness. The cap is generous
# because a small model on CPU is slow, but it is finite.
TURN_TIMEOUT="${TURN_TIMEOUT:-300}"


mkdir -p "$HOME/.claude"

cat > "$HOME/.claude/settings.json" <<EOF
{
  "env": {
    "ANTHROPIC_BASE_URL": "${ANTHROPIC_BASE_URL:-}",
    "ANTHROPIC_AUTH_TOKEN": "${ANTHROPIC_AUTH_TOKEN:-}",
    "ANTHROPIC_MODEL": "${ANTHROPIC_MODEL:-qwen3:0.6b}"
  }
}
EOF
# Skip first-run onboarding, which otherwise blocks on stdin forever.
printf '{"hasCompletedOnboarding":true}\n' > "$HOME/.claude.json"

echo "[claude-code] model=${ANTHROPIC_MODEL:-} base=${ANTHROPIC_BASE_URL:-} cwd=$WORK"

session=""
for prompt in "$PROMPTS"/*.txt; do
  echo "[claude-code] $(basename "$prompt")"

  # The first turn starts a session and the rest resume it, so the transcript
  # holds several exchanges — a single-turn history exercises none of the
  # parent-linking the viewer does.
  if [ -z "$session" ]; then
    out="$(timeout "$TURN_TIMEOUT" claude -p "$(cat "$prompt")" --permission-mode bypassPermissions --output-format json 2>&1)"
  else
    out="$(timeout "$TURN_TIMEOUT" claude -p "$(cat "$prompt")" --permission-mode bypassPermissions --output-format json --resume "$session" 2>&1)"
  fi
  status=$?

  if [ $status -ne 0 ]; then
    echo "[claude-code] turn failed (exit $status):"
    printf '%s\n' "$out" | tail -5
    continue
  fi

  if [ -z "$session" ]; then
    session="$(printf '%s' "$out" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
    [ -n "$session" ] && echo "[claude-code] session $session"
  fi
done

echo "[claude-code] transcripts:"
if [ -n "$(find "$HOME/.claude/projects" -name '*.jsonl' 2>/dev/null)" ]; then
  find "$HOME/.claude/projects" -name '*.jsonl' -printf '  %p (%s bytes)\n' 2>/dev/null | head -10
else
  echo "  none written"
fi
exit 0
