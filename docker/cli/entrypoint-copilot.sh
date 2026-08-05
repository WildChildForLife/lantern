#!/usr/bin/env bash
# Drives GitHub Copilot CLI through the harness prompts and leaves whatever it
# writes under $HOME/.copilot for Lantern to read.
#
# This one is a probe before it is a driver. No adapter reads Copilot CLI yet,
# and it is not yet established that the CLI will even start without a paid
# subscription. The dump at the end is the evidence PR-8 gets built from —
# including the evidence that it produced nothing, which is equally an answer.
set -uo pipefail

# Drops to a non-root user and prepares a writable workspace at $WORK.
. /usr/local/bin/bootstrap

PROMPTS="${PROMPTS:-/prompts}"
TURN_TIMEOUT="${TURN_TIMEOUT:-300}"

COPILOT_DIR="$HOME/.copilot"
mkdir -p "$COPILOT_DIR"

# BYOK: setting a base URL replaces GitHub's own model routing entirely. The
# model has to support tool calling and streaming; the Responses API is not
# supported on this path.
export COPILOT_PROVIDER_TYPE="${COPILOT_PROVIDER_TYPE:-openai}"
export COPILOT_PROVIDER_BASE_URL="${COPILOT_PROVIDER_BASE_URL:-http://ollama:11434/v1}"
export COPILOT_PROVIDER_API_KEY="${COPILOT_PROVIDER_API_KEY:-ollama}"
export COPILOT_MODEL="${COPILOT_MODEL:-qwen3:0.6b}"

echo "[copilot] version: $(copilot --version 2>&1 | tail -1)"

# Whether it starts at all is the first finding. `--help` needs no model and no
# network, so a failure here is a licence or auth wall rather than a bad config.
echo "[copilot] --help exit check:"
if timeout 60 copilot --help >/tmp/copilot-help.txt 2>&1; then
  echo "  ok — CLI runs"
else
  echo "  FAILED (exit $?) — output follows"
  head -30 /tmp/copilot-help.txt
fi

echo "[copilot] driving $(ls "$PROMPTS"/*.txt | wc -l) prompts"

for prompt in "$PROMPTS"/*.txt; do
  echo "[copilot] $(basename "$prompt")"
  # `-p` is one non-interactive prompt; --allow-all-tools stops it blocking on
  # an approval it has no terminal to receive.
  if ! timeout "$TURN_TIMEOUT" copilot -p "$(cat "$prompt")" --allow-all-tools 2>&1 | tail -25; then
    echo "[copilot] turn failed"
  fi
done

# Everything it wrote, with sizes. Which files exist and where is the whole
# question PR-8 turns on, so this is a full listing rather than a check for
# paths that were expected.
echo "[copilot] tree under $COPILOT_DIR:"
find "$COPILOT_DIR" -type f -printf '  %10s  %p\n' 2>/dev/null | sort -k2 | head -40 || true
