#!/usr/bin/env bash
# Points the Homebrew formula and the AUR PKGBUILD at a published npm release.
#
#   scripts/bump-tap.sh <version>
#
# Both recipes install from the npm tarball, so the version and its checksum are
# all that change. The tarball has to be on the registry already — run this after
# the release workflow's npm job succeeds.
#
# It only rewrites the files in this repository. Publishing them is a separate,
# credentialled step:
#   Homebrew  cp packaging/homebrew/lantern.rb <tap>/Formula/ && commit
#   AUR       cp packaging/aur/PKGBUILD <aur-clone>/ && makepkg --printsrcinfo > .SRCINFO && commit
set -euo pipefail

VERSION=${1:?usage: bump-tap.sh <version>}
VERSION=${VERSION#v}

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TARBALL="https://registry.npmjs.org/lantern-viewer/-/lantern-viewer-${VERSION}.tgz"

echo "resolving $TARBALL"
if ! curl -fsIL "$TARBALL" >/dev/null 2>&1; then
  echo "bump-tap.sh: $TARBALL is not on the registry yet." >&2
  echo "bump-tap.sh: wait for the release workflow's npm job, then re-run." >&2
  exit 1
fi

SHA=$(curl -fsSL "$TARBALL" | shasum -a 256 | cut -d' ' -f1)
echo "sha256 $SHA"

FORMULA="$REPO_ROOT/packaging/homebrew/lantern.rb"
PKGBUILD="$REPO_ROOT/packaging/aur/PKGBUILD"

# The URL and sha lines are rewritten wholesale rather than patched in place, so a
# stale checksum can never survive a version bump.
node - "$FORMULA" "$VERSION" "$SHA" <<'NODE'
const [file, version, sha] = process.argv.slice(2);
const fs = require("node:fs");
const next = fs
  .readFileSync(file, "utf8")
  .replace(
    /url "https:\/\/registry\.npmjs\.org\/lantern-viewer\/-\/lantern-viewer-[^"]+\.tgz"/,
    `url "https://registry.npmjs.org/lantern-viewer/-/lantern-viewer-${version}.tgz"`,
  )
  .replace(/sha256 "[^"]+"/, `sha256 "${sha}"`);
fs.writeFileSync(file, next);
NODE

node - "$PKGBUILD" "$VERSION" "$SHA" <<'NODE'
const [file, version, sha] = process.argv.slice(2);
const fs = require("node:fs");
const next = fs
  .readFileSync(file, "utf8")
  .replace(/^pkgver=.*$/m, `pkgver=${version}`)
  .replace(/^pkgrel=.*$/m, "pkgrel=1")
  .replace(/^sha256sums=\('.*'\)$/m, `sha256sums=('${sha}')`);
fs.writeFileSync(file, next);
NODE

echo "updated:"
grep -nE 'url |sha256 ' "$FORMULA"
grep -nE '^pkgver=|^sha256sums=' "$PKGBUILD"
