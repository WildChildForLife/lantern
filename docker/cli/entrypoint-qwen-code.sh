#!/usr/bin/env bash
# Drives Qwen Code through the harness prompts and leaves whatever it writes
# under $HOME/.qwen for Lantern to read.
#
# The point of this one is discovery: no adapter reads Qwen Code or Gemini CLI
# yet, so the closing dump below is the evidence PR-7 gets built from rather
# than a check on a format already known.
set -uo pipefail

# Drops to a non-root user and prepares a writable workspace at $WORK.
. /usr/local/bin/bootstrap

PROMPTS="${PROMPTS:-/prompts}"
TURN_TIMEOUT="${TURN_TIMEOUT:-300}"

MODEL="${OPENAI_MODEL:-qwen3:0.6b}"
QWEN_DIR="$HOME/.qwen"

mkdir -p "$QWEN_DIR"

# Qwen Code reads its OpenAI settings from the environment, but only takes the
# "use an OpenAI-compatible endpoint" branch when told so in settings.json —
# otherwise it opens the Qwen OAuth flow and blocks on a browser that is not
# there.
cat > "$QWEN_DIR/settings.json" <<EOF
{
  "security": {
    "auth": {
      "selectedType": "openai"
    }
  },
  "privacy": {
    "usageStatisticsEnabled": false
  }
}
EOF

export OPENAI_API_KEY="${OPENAI_API_KEY:-ollama}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://ollama:11434/v1}"
export OPENAI_MODEL="$MODEL"

echo "[qwen-code] $(qwen --version 2>&1 | tail -1)"
echo "[qwen-code] driving $(ls "$PROMPTS"/*.txt | wc -l) prompts"

for prompt in "$PROMPTS"/*.txt; do
  echo "[qwen-code] $(basename "$prompt")"
  # --yolo approves tool calls without a prompt; without it the run blocks on
  # stdin that never arrives and the harness hangs until the timeout.
  if ! timeout "$TURN_TIMEOUT" qwen --yolo -p "$(cat "$prompt")" 2>&1 | tail -20; then
    echo "[qwen-code] turn failed"
  fi
done

# Everything it wrote, with sizes. Which files exist, where, and how big is the
# whole question PR-7 turns on, so this is deliberately a full listing rather
# than a check for paths that were expected.
echo "[qwen-code] tree under $QWEN_DIR:"
find "$QWEN_DIR" -type f -printf '  %10s  %p\n' 2>/dev/null | sort -k2 || true

echo "[qwen-code] session listing:"
qwen sessions list --json 2>&1 | head -40 || echo "  (no sessions subcommand)"
