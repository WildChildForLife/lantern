#!/usr/bin/env bash
# Installs the built packages in clean containers and checks they actually run.
#
#   scripts/smoke-test-packages.sh <version>
#
# Building a package proves the recipe parses. This proves the result installs,
# resolves its dependency, starts, and serves — which is what caught both a
# half-gigabyte of unused dependency and an rpm that installed happily onto a Node
# too old to run it.
#
# Debian covers the deb, Fedora the rpm. Both need Docker.
set -euo pipefail

VERSION=${1:?usage: smoke-test-packages.sh <version>}
VERSION=${VERSION#v}

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST="$REPO_ROOT/packaging/dist"

DEB="$DIST/lantern_${VERSION}_amd64.deb"
RPM="$DIST/lantern-${VERSION}-1.x86_64.rpm"

for f in "$DEB" "$RPM"; do
  if [ ! -f "$f" ]; then
    echo "smoke-test-packages.sh: $f is missing — run build-packages.sh first." >&2
    exit 1
  fi
done

# The installed tree must stay proportionate to the application. It was 533 MB
# once, almost all of it a dependency the bundle never imports, and nothing in the
# build would have noticed.
MAX_INSTALLED_MB=64

run_case() {
  local image=$1 script=$2
  echo ""
  echo "=== $image ==="
  docker run --rm --platform linux/amd64 \
    -v "$DIST:/pkg:ro" \
    -e "VERSION=$VERSION" \
    -e "MAX_INSTALLED_MB=$MAX_INSTALLED_MB" \
    "$image" bash -c "$script"
}

COMMON_CHECKS='
set -e
echo "node: $(node --version)"
echo "--- installed size ---"
size_mb=$(du -sm /usr/lib/lantern | cut -f1)
echo "${size_mb} MB"
if [ "$size_mb" -gt "$MAX_INSTALLED_MB" ]; then
  echo "FAIL: installed tree is ${size_mb} MB, over the ${MAX_INSTALLED_MB} MB ceiling." >&2
  echo "Something is being packaged that should not be:" >&2
  du -sh /usr/lib/lantern/node_modules/* 2>/dev/null | sort -rh | head -5 >&2
  exit 1
fi
echo "--- version ---"
lantern --version
echo "--- boots and serves ---"
mkdir -p /root/.claude/projects
# HOSTNAME is set to the container id by Docker and Lantern binds to it, so it is
# cleared here to reach the server over loopback.
env -u HOSTNAME lantern --port 4500 >/tmp/l.log 2>&1 &
for _ in $(seq 1 20); do sleep 1; grep -q "Server is running" /tmp/l.log && break; done
code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4500/ || true)
echo "HTTP: $code"
[ "$code" = "200" ] || { echo "FAIL: expected 200"; cat /tmp/l.log; exit 1; }
errors=$(grep -c "level=ERROR" /tmp/l.log || true)
echo "ERROR lines: $errors"
[ "$errors" = "0" ] || { echo "FAIL: errors in the log"; cat /tmp/l.log; exit 1; }
echo "PASS"
'

run_case debian:12-slim "
set -e
apt-get update -qq >/dev/null
apt-get install -y -qq curl ca-certificates >/dev/null
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null 2>&1
apt-get install -y -qq nodejs >/dev/null
apt-get install -y -qq /pkg/lantern_${VERSION}_amd64.deb
$COMMON_CHECKS
"

# Fedora deliberately gets a current Node from NodeSource rather than its own,
# which lags the requirement. The old-node path is what postinstall.sh warns about
# and is covered by the warning test below.
run_case fedora:41 "
set -e
dnf -q install -y curl >/dev/null 2>&1 || true
curl -fsSL https://rpm.nodesource.com/setup_24.x | bash - >/dev/null 2>&1
dnf -q install -y nodejs >/dev/null 2>&1
dnf -q install -y /pkg/lantern-${VERSION}-1.x86_64.rpm >/dev/null
$COMMON_CHECKS
"

echo ""
echo "=== fedora:41 with its own older Node: the warning must appear ==="
docker run --rm --platform linux/amd64 -v "$DIST:/pkg:ro" fedora:41 bash -c "
set -e
dnf -q install -y nodejs >/dev/null 2>&1
echo \"node: \$(node --version)\"
out=\$(dnf -q install -y /pkg/lantern-${VERSION}-1.x86_64.rpm 2>&1 || true)
echo \"\$out\" | grep -q 'lantern: WARNING' && echo 'PASS: install warned about the old Node' && exit 0
echo 'FAIL: no warning was printed on a Node too old to run' >&2
echo \"\$out\" >&2
exit 1
"

echo ""
echo "all smoke tests passed"
