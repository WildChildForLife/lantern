#!/usr/bin/env bash
# Drives goose through the harness prompts and leaves its SQLite session store
# under $XDG_DATA_HOME/goose for Lantern to read.
set -uo pipefail

# Drops to a non-root user and prepares a writable workspace at $WORK.
. /usr/local/bin/bootstrap

PROMPTS="${PROMPTS:-/prompts}"
TURN_TIMEOUT="${TURN_TIMEOUT:-300}"

# There is no OS keyring in a container, so goose is configured by environment
# rather than by the config file its wizard would write.
export GOOSE_PROVIDER="${GOOSE_PROVIDER:-ollama}"
export OLLAMA_HOST="${OLLAMA_HOST:-http://ollama:11434}"
export GOOSE_MODEL="${GOOSE_MODEL:-qwen3:0.6b}"
# Turns tool definitions into text prompts and parses the replies back — the
# only mitigation among these CLIs for a model too small to tool-call natively.
export GOOSE_TOOLSHIM="${GOOSE_TOOLSHIM:-1}"
export GOOSE_TOOLSHIM_OLLAMA_MODEL="${GOOSE_TOOLSHIM_OLLAMA_MODEL:-$GOOSE_MODEL}"

echo "[goose] version: $(goose --version 2>&1 | tail -1)"

for prompt in "$PROMPTS"/*.txt; do
  echo "[goose] $(basename "$prompt")"
  if ! timeout "$TURN_TIMEOUT" goose run --text "$(cat "$prompt")" 2>&1 | tail -20; then
    echo "[goose] turn failed"
  fi
done

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/goose"
echo "[goose] tree under $DATA:"
find "$DATA" -type f -printf '  %10s  %p\n' 2>/dev/null | sort -k2 | head -30 || true
