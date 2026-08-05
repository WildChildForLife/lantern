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

# The version reaches the package from the tag and the bundled manifest from
# package.json. Letting them diverge would label a package one version while it
# reports another, so they have to agree.
PKG_VERSION=$(node -p "require('$REPO_ROOT/package.json').version")
if [ "$VERSION" != "$PKG_VERSION" ]; then
  echo "build-packages.sh: version mismatch — asked for '$VERSION', package.json says '$PKG_VERSION'." >&2
  echo "build-packages.sh: bump package.json or tag the version it already declares." >&2
  exit 1
fi

rm -rf "$REPO_ROOT/packaging/staging" "$OUT"
mkdir -p "$STAGING" "$OUT"

# The application itself, already built by `pnpm build`.
if [ ! -d "$REPO_ROOT/dist" ]; then
  echo "build-packages.sh: dist/ is missing — run 'pnpm build' first." >&2
  exit 1
fi
cp -R "$REPO_ROOT/dist" "$STAGING/dist"

# Only the dependencies the built bundle actually loads at runtime, resolved for
# the target architecture. npm is used rather than pnpm so the tree is a plain
# directory the package can carry, with no symlinks into a store that will not
# exist on the user's machine.
#
# @anthropic-ai/claude-code is deliberately excluded even though package.json
# lists it: the bundle never imports it — Lantern finds the `claude` executable on
# PATH, or wherever --executable points — and carrying it made the installed
# footprint 533 MB for a 6.8 MB application. Users who want the optional AI topic
# naming install Claude Code themselves, which the README already requires.
RUNTIME_DEPS='["@replit/ruspty"]'

node -e '
  const pkg = require(process.argv[1]);
  const fs = require("node:fs");
  const keep = new Set(JSON.parse(process.argv[3]));

  const missing = [...keep].filter((name) => pkg.dependencies?.[name] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `build-packages.sh: ${missing.join(", ")} is no longer a dependency; update RUNTIME_DEPS.`,
    );
  }

  const dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies).filter(([name]) => keep.has(name)),
  );

  fs.writeFileSync(process.argv[2], JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: pkg.type,
    dependencies,
  }, null, 2));
' "$REPO_ROOT/package.json" "$STAGING/package.json" "$RUNTIME_DEPS"

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
    npm install --omit=dev --no-audit --no-fund --no-package-lock --ignore-scripts
  else
    echo "note: cross-building $PKG_ARCH on $HOST_OS-$HOST_CPU; optional native" >&2
    echo "note: binaries may be skipped. Release packages are built on Linux." >&2
    npm install --omit=dev --no-audit --no-fund --no-package-lock --ignore-scripts \
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
