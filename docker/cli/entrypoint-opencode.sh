#!/usr/bin/env bash
# Drives opencode through the harness prompts and leaves its storage tree in
# $XDG_DATA_HOME/opencode for Lantern to read.
set -uo pipefail

# Drops to a non-root user and prepares a writable workspace at $WORK.
. /usr/local/bin/bootstrap

PROMPTS="${PROMPTS:-/prompts}"
# A turn that never returns would hang the whole harness. The cap is generous
# because a small model on CPU is slow, but it is finite.
TURN_TIMEOUT="${TURN_TIMEOUT:-300}"

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
MODEL="${OPENCODE_MODEL:-qwen3:0.6b}"

mkdir -p "$CONFIG_DIR" "${XDG_DATA_HOME:-$HOME/.local/share}/opencode"

# An OpenAI-compatible provider pointed at the gateway. opencode resolves
# models as "<provider>/<model>", so the provider id here is half of the model
# string below.
cat > "$CONFIG_DIR/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "harness/${MODEL}",
  "small_model": "harness/${MODEL}",
  "provider": {
    "harness": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Local harness gateway",
      "options": {
        "baseURL": "${OLLAMA_BASE_URL:-http://ollama:11434/v1}",
        "apiKey": "ollama"
      },
      "models": {
        "${MODEL}": { "name": "${MODEL}" }
      }
    }
  }
}
EOF


echo "[opencode] driving $(ls "$PROMPTS"/*.txt | wc -l) prompts"

for prompt in "$PROMPTS"/*.txt; do
  echo "[opencode] $(basename "$prompt")"
  if ! timeout "$TURN_TIMEOUT" opencode run "$(cat "$prompt")" 2>&1 | tail -20; then
    echo "[opencode] turn failed"
  fi
done

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
echo "[opencode] storage:"
# Which of these two exists is the answer to a question the adapter currently
# has to guess at, so both are reported.
find "$DATA/storage" -name '*.json' -printf '  %p\n' 2>/dev/null | head -20 || true
find "$DATA" -name '*.db' -printf '  %p (SQLite — Lantern cannot read this layout)\n' 2>/dev/null || true
