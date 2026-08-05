#!/usr/bin/env bash
# Drives Codex CLI through the harness prompts and leaves rollouts in
# $CODEX_HOME/sessions for Lantern to read.
set -uo pipefail

# Drops to a non-root user and prepares a writable workspace at $WORK.
. /usr/local/bin/bootstrap

PROMPTS="${PROMPTS:-/prompts}"
# A turn that never returns would hang the whole harness. The cap is generous
# because a small model on CPU is slow, but it is finite.
TURN_TIMEOUT="${TURN_TIMEOUT:-300}"

CODEX_HOME="${CODEX_HOME:-/root/.codex}"
BASE_URL="${OLLAMA_BASE_URL:-http://ollama:11434/v1}"
MODEL="${CODEX_MODEL:-qwen3:0.6b}"
# Ollama and Codex both default to the responses API for local models. `chat`
# is the fallback: it has a known tool-call round-trip bug (openai/codex#7051)
# but some builds reject `responses`.
WIRE_API="${CODEX_WIRE_API:-responses}"

mkdir -p "$CODEX_HOME"

# The provider id must NOT be `ollama`, `openai` or `lmstudio`. Those are
# reserved built-ins, and Codex merges config with `or_insert` — a block using
# a reserved id is silently discarded and it keeps talking to localhost, which
# in a container is nothing at all. Filed as openai/codex#8240, closed as not
# planned. Hence `harness`.
write_config() {
  cat > "$CODEX_HOME/config.toml" <<EOF
model = "$MODEL"
model_provider = "harness"

# Nothing in a throwaway container needs protecting, and an approval prompt
# would block on stdin forever.
approval_policy = "never"
sandbox_mode = "danger-full-access"

[model_providers.harness]
name = "Local Ollama"
base_url = "$BASE_URL"
wire_api = "$1"
EOF
}


echo "[codex] model=$MODEL base=$BASE_URL wire_api=$WIRE_API"
write_config "$WIRE_API"

wrote_any=false
for prompt in "$PROMPTS"/*.txt; do
  echo "[codex] $(basename "$prompt")"
  if timeout "$TURN_TIMEOUT" codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox \
      -C "$WORK" "$(cat "$prompt")" 2>&1 | tail -15; then
    wrote_any=true
  else
    echo "[codex] turn failed"
  fi
done

# If the wire API was wrong, every turn fails the same way. Say so plainly
# rather than leaving an empty directory to be puzzled over.
if [ "$wrote_any" = false ] && [ "$WIRE_API" = "responses" ]; then
  echo "[codex] every turn failed on wire_api=responses; retrying once with chat"
  write_config "chat"
  timeout "$TURN_TIMEOUT" codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox \
    -C "$WORK" "$(cat "$PROMPTS"/01-*.txt)" 2>&1 | tail -15
fi

echo "[codex] rollouts:"
find "$CODEX_HOME/sessions" -name 'rollout-*.jsonl' -printf '  %p (%s bytes)\n' 2>/dev/null \
  || echo "  none written — codex exec may not persist a rollout; check before trusting this harness"
