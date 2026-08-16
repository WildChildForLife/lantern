#!/usr/bin/env bash
# Points the Homebrew formula at a published npm release.
#
#   scripts/bump-tap.sh <version>
#
# The formula installs from the npm tarball, so the version and its checksum are
# all that change. The tarball has to be on the registry already — run this after
# the release workflow's npm job succeeds.
#
# It only rewrites the file in this repository. Publishing it is a separate,
# credentialled step:
#   cp packaging/homebrew/lantern-viewer.rb <tap>/Formula/ && commit
set -euo pipefail

VERSION=${1:?usage: bump-tap.sh <version>}
VERSION=${VERSION#v}

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TARBALL="https://registry.npmjs.org/lantern-viewer/-/lantern-viewer-${VERSION}.tgz"

echo "resolving $TARBALL"
# The release workflow runs this straight after publishing, so allow for the
# registry taking a moment to serve what it has just accepted.
ATTEMPTS=${BUMP_TAP_ATTEMPTS:-10}
for attempt in $(seq 1 "$ATTEMPTS"); do
  if curl -fsIL "$TARBALL" >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq "$ATTEMPTS" ]; then
    echo "bump-tap.sh: $TARBALL is not on the registry after $ATTEMPTS attempts." >&2
    echo "bump-tap.sh: check the npm job published, then re-run." >&2
    exit 1
  fi
  echo "  not there yet, retrying in 6s ($attempt/$ATTEMPTS)"
  sleep 6
done

# sha256sum on Linux, shasum where it is absent (macOS ships only the latter).
if command -v sha256sum >/dev/null 2>&1; then
  SHA=$(curl -fsSL "$TARBALL" | sha256sum | cut -d' ' -f1)
else
  SHA=$(curl -fsSL "$TARBALL" | shasum -a 256 | cut -d' ' -f1)
fi
echo "sha256 $SHA"

FORMULA="$REPO_ROOT/packaging/homebrew/lantern-viewer.rb"

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

# A regex that stopped matching would leave the placeholder in place and still
# exit cleanly, which is how a formula with an unusable checksum reaches a tap.
if grep -q 'REPLACE_WITH_TARBALL_SHA256' "$FORMULA"; then
  echo "bump-tap.sh: $FORMULA still holds the placeholder checksum — the rewrite did not match." >&2
  exit 1
fi
if ! grep -q "$SHA" "$FORMULA"; then
  echo "bump-tap.sh: $FORMULA does not contain the checksum that was just computed." >&2
  exit 1
fi
if ! grep -q "$VERSION" "$FORMULA"; then
  echo "bump-tap.sh: $FORMULA was not updated to $VERSION." >&2
  exit 1
fi

echo "updated:"
grep -nE 'url |sha256 ' "$FORMULA"
