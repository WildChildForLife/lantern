#!/usr/bin/env bash
# Build the harness, drive every CLI through a real conversation, then serve
# Lantern against what they wrote.
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE=(docker compose -f compose.yaml)
LANTERN_PORT="${LANTERN_PORT:-3410}"

drive_only=false
skip_drive=false
for arg in "$@"; do
  case "$arg" in
    --drive-only) drive_only=true ;;
    --no-drive)   skip_drive=true ;;
    -h|--help)
      cat <<'EOF'
Usage: ./run.sh [--drive-only | --no-drive]

  (no flags)    pull the model, drive every CLI, then serve Lantern
  --drive-only  drive the CLIs and stop; do not start Lantern
  --no-drive    serve Lantern against whatever the CLIs wrote last time
EOF
      exit 0 ;;
  esac
done

if [ "$skip_drive" = false ]; then
  echo "==> starting the model gateway (first run downloads the model)"
  "${COMPOSE[@]}" up -d ollama
  "${COMPOSE[@]}" up ollama-pull

  echo
  echo "==> driving the CLIs"
  # Sequentially, not in parallel: they share one small local model, and several
  # agents contending for it makes every one of them slow and flaky.
  for cli in claude-code codex opencode qwen-code copilot; do
    echo
    echo "--- $cli ---"
    # A CLI that fails should not stop the others — a partial history still
    # tells us something, and which one failed is the interesting part.
    "${COMPOSE[@]}" --profile drive run --rm --build "$cli" || echo "!!! $cli exited non-zero"
  done
fi

if [ "$drive_only" = true ]; then
  echo
  echo "==> done. Run './run.sh --no-drive' to view the results."
  exit 0
fi

echo
echo "==> enabling every source"
# Seeded rather than passed as LANTERN_SOURCES, which would lock the settings
# UI for the whole run and defeat the point of testing it.
"${COMPOSE[@]}" run --rm --no-deps --entrypoint /bin/sh lantern -c \
  'mkdir -p /root/.lantern/sources && printf "{\"enabled\":[\"claude-code\",\"codex\",\"opencode\",\"qwen-code\",\"copilot\"]}\n" > /root/.lantern/sources/sources.json' \
  >/dev/null

# The release image first, then the harness image that adds the CLIs on top of
# it. Two steps because topic naming shells out to the selected CLI, so Lantern
# and the CLIs have to share a container the way they share a real machine.
echo "==> building Lantern"
docker build -q -t lantern-harness-app -f ../Dockerfile .. > /dev/null

echo "==> starting Lantern"
"${COMPOSE[@]}" up -d --build lantern

echo
echo "    http://localhost:${LANTERN_PORT}"
echo
echo "    logs:  docker compose -f docker/compose.yaml logs -f lantern"
echo "    stop:  docker compose -f docker/compose.yaml down"
echo "    reset: docker compose -f docker/compose.yaml down -v   (also drops the model)"
