#!/usr/bin/env bash
# Installs the packed tarball on a clean machine and checks that it runs.
#
#   scripts/pack/smoke.sh
#
# This is what `scripts/smoke-test-packages.sh` used to do for the .deb and the
# .rpm. Those channels are gone, but the question they answered is not: a
# tarball that packs cleanly can still fail on a machine that has none of this
# repository's node_modules, and `scripts/pack/check.sh` runs it through npx
# here, where a stray dependency would resolve from the checkout.
#
# Docker rather than an install on the runner, because the point is a machine
# that has never seen Lantern: a global install, a real `lantern` on PATH, and a
# started server answering on a port.
set -euo pipefail

cd "$(dirname "$0")/../.."

IMAGE=${SMOKE_IMAGE:-node:24-slim}
PORT=${SMOKE_PORT:-4500}

# `scripts/pack/check.sh` runs first in CI and leaves its tarball behind, so the
# usual path here is to smoke test exactly what that check just started, without
# paying for a second build.
if ! ls temp-pack/*.tgz >/dev/null 2>&1; then
  ./scripts/pack/pack.sh >/dev/null
fi

TARBALL=$(ls temp-pack/*.tgz | head -1)
echo "smoke: testing $TARBALL on $IMAGE"

# The script goes in on stdin, quoted, so nothing here is expanded by this shell
# and there is no escaping to get wrong. What it needs is passed as environment.
# -i, so the heredoc below actually reaches bash inside the container. Without
# it docker attaches no stdin, bash reads an empty script, and the whole test
# passes without running a line of it.
docker run --rm -i \
  -e PORT="$PORT" \
  -e TARBALL="/pkg/$(basename "$TARBALL")" \
  -v "$PWD/temp-pack:/pkg:ro" \
  "$IMAGE" bash -euo pipefail -s <<'INNER'
npm install -g "$TARBALL" >/dev/null 2>&1

# The command the package promises, found on PATH rather than by its path.
command -v lantern >/dev/null || { echo "smoke: lantern is not on PATH"; exit 1; }
echo "smoke: installed $(lantern --version)"

# A global npm install is precisely what `lantern upgrade` is for, so it has to
# recognise this one rather than refusing it. Any of its three honest answers
# will do: which one depends on what is published and whether this machine can
# reach the registry, neither of which this test is about.
lantern upgrade --check >/tmp/upgrade.log 2>&1 || true
grep -qE "is the latest release|is available|could not reach the npm registry" /tmp/upgrade.log || {
  echo "smoke: upgrade did not recognise a global npm install"
  cat /tmp/upgrade.log
  exit 1
}
echo "smoke: upgrade says $(head -1 /tmp/upgrade.log)"

mkdir -p /root/.claude/projects
lantern --port "$PORT" --claude-dir /root/.claude >/tmp/lantern.log 2>&1 &
server=$!

# node rather than curl: the image is whatever Node ships, and a smoke test
# should not need anything installed to run.
for _ in $(seq 1 30); do
  if node -e "
    fetch('http://127.0.0.1:${PORT}/api/version')
      .then((r) => r.text())
      .then((t) => { require('node:fs').writeFileSync('/tmp/version.json', t); })
      .catch(() => process.exit(1));
  " >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

kill "$server" 2>/dev/null || true

grep -q '"version"' /tmp/version.json 2>/dev/null || {
  echo "smoke: the server never answered"
  cat /tmp/lantern.log
  exit 1
}
echo "smoke: served $(cat /tmp/version.json)"

# A start that logs an error is a start that half worked.
if grep -q "level=ERROR" /tmp/lantern.log; then
  echo "smoke: errors in the startup log"
  grep "level=ERROR" /tmp/lantern.log
  exit 1
fi

# Nothing was attached to this run, so the version notice must have stayed out
# of it — a line printed here is a line in somebody's piped output.
if grep -q "is available (you have" /tmp/lantern.log; then
  echo "smoke: the update notice fired without a terminal"
  exit 1
fi

echo "smoke: ok"
INNER
