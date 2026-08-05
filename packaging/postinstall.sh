#!/bin/sh
# Runs after the deb or rpm is unpacked, once the declared nodejs dependency has
# been configured.
#
# The dependency floor is not reliable on its own. Debian and Ubuntu enforce
# `nodejs (>= 24)`, but dnf installed the package unchallenged on Fedora 41, which
# ships Node 22 — leaving a package that runs and immediately refuses to work. A
# check here turns that into something the user reads at install time rather than
# on first launch.
#
# It warns rather than failing: refusing the install would leave the package
# half-configured on a system where the user is about to upgrade Node anyway, and
# Lantern already reports the same thing clearly when it starts.
set -e

REQUIRED_MAJOR=24

if ! command -v node >/dev/null 2>&1; then
  echo "lantern: node is not on PATH. Install Node.js ${REQUIRED_MAJOR} or newer before running lantern." >&2
  exit 0
fi

version=$(node --version 2>/dev/null | sed 's/^v//')
major=$(printf '%s' "$version" | cut -d. -f1)

case "$major" in
'' | *[!0-9]*)
  # An unreadable version is not worth failing an install over.
  exit 0
  ;;
esac

if [ "$major" -lt "$REQUIRED_MAJOR" ]; then
  echo "" >&2
  echo "lantern: WARNING — Node.js ${version} was found, but lantern needs ${REQUIRED_MAJOR} or newer." >&2
  echo "lantern: it is installed, but will refuse to start until node is upgraded." >&2
  echo "lantern: your distribution's default nodejs may be older than ${REQUIRED_MAJOR}" >&2
  echo "lantern: (Fedora 41 ships 22, for instance) — install a newer stream, e.g." >&2
  echo "lantern:   dnf install nodejs${REQUIRED_MAJOR}" >&2
  echo "lantern:   curl -fsSL https://deb.nodesource.com/setup_${REQUIRED_MAJOR}.x | bash - && apt install nodejs" >&2
  echo "" >&2
fi

exit 0
