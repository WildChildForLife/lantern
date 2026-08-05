#!/usr/bin/env bash
# Builds the Debian and RPM packages for one architecture.
#
#   scripts/build-packages.sh <version> <arch>
#
# <arch> is nfpm's name for it — amd64 or arm64. The production dependency tree is
# installed for that architecture rather than the build machine's, so an arm64
# package built on an amd64 runner still gets the right optional binaries.
#
# Output lands in packaging/dist. Requires nfpm on PATH; CI installs it, and
# locally you can run it through Docker instead:
#
#   docker run --rm -v "$PWD:/w" -w /w goreleaser/nfpm package -f ... -t ...
set -euo pipefail

VERSION=${1:?usage: build-packages.sh <version> <arch>}
PKG_ARCH=${2:?usage: build-packages.sh <version> <arch>}

case "$PKG_ARCH" in
amd64) NPM_CPU=x64 ;;
arm64) NPM_CPU=arm64 ;;
*)
  echo "build-packages.sh: unsupported arch '$PKG_ARCH' (expected amd64 or arm64)" >&2
  exit 2
  ;;
esac

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
STAGING="$REPO_ROOT/packaging/staging/lantern"
OUT="$REPO_ROOT/packaging/dist"

rm -rf "$REPO_ROOT/packaging/staging" "$OUT"
mkdir -p "$STAGING" "$OUT"

# The application itself, already built by `pnpm build`.
if [ ! -d "$REPO_ROOT/dist" ]; then
  echo "build-packages.sh: dist/ is missing — run 'pnpm build' first." >&2
  exit 1
fi
cp -R "$REPO_ROOT/dist" "$STAGING/dist"

# Production dependencies only, resolved for the target architecture. npm is used
# rather than pnpm so the tree is a plain directory the package can carry, with no
# symlinks into a store that will not exist on the user's machine.
node -e '
  const pkg = require(process.argv[1]);
  const fs = require("node:fs");
  fs.writeFileSync(process.argv[2], JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: pkg.type,
    dependencies: pkg.dependencies,
  }, null, 2));
' "$REPO_ROOT/package.json" "$STAGING/package.json"

# Only filter by target platform when this machine is not already it. npm's
# --cpu/--os pick which optional binaries to fetch, but they are less reliable
# than a native resolve, and the amd64 package needs @replit/ruspty's linux-x64
# build to keep the in-app terminal. Building on Linux amd64 — as CI does — gets
# it natively; the arm64 package has no such binary to fetch, because ruspty
# publishes none for linux/arm64.
HOST_OS=$(node -p "process.platform")
HOST_CPU=$(node -p "process.arch")

(
  cd "$STAGING"
  if [ "$HOST_OS" = "linux" ] && [ "$HOST_CPU" = "$NPM_CPU" ]; then
    npm install --omit=dev --no-audit --no-fund --no-package-lock
  else
    echo "note: cross-building $PKG_ARCH on $HOST_OS-$HOST_CPU; optional native" >&2
    echo "note: binaries may be skipped. Release packages are built on Linux." >&2
    npm install --omit=dev --no-audit --no-fund --no-package-lock \
      --cpu="$NPM_CPU" --os=linux
  fi
)

# nfpm resolves the paths in contents relative to the working directory.
cd "$REPO_ROOT/packaging"
export VERSION PKG_ARCH
nfpm package --config nfpm.yaml --packager deb --target "$OUT"
nfpm package --config nfpm.yaml --packager rpm --target "$OUT"

echo "built:"
ls -1 "$OUT"
