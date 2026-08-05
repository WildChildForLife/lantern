#!/bin/sh
# Launcher installed as /usr/bin/lantern by the deb and rpm packages.
#
# The package ships the built application and its production dependencies under
# /usr/lib/lantern and declares nodejs as a package dependency, so the user never
# installs a runtime by hand — their package manager already did.
set -e

LANTERN_HOME=/usr/lib/lantern

if ! command -v node >/dev/null 2>&1; then
  echo "lantern: node was not found on PATH." >&2
  echo "lantern: the package depends on nodejs, so this usually means it was" >&2
  echo "lantern: removed afterwards. Reinstall nodejs (24 or newer)." >&2
  exit 1
fi

exec node "$LANTERN_HOME/dist/main.js" "$@"
