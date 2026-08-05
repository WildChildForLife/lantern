#!/usr/bin/env bash
# Scans staged changes for secrets before they can be committed.
#
# gitleaks is a Go binary that is not installed everywhere, and a hook that
# fails because a tool is missing teaches people to pass --no-verify, which
# disables the checks that do work. So: use the binary when it is there, fall
# back to the official image when Docker is, and only then refuse.
set -euo pipefail

if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks protect --staged --no-banner
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  exec docker run --rm -v "$(pwd):/repo" -w /repo \
    zricethezav/gitleaks:latest protect --staged --no-banner
fi

cat >&2 <<'MESSAGE'
✗ gitleaks is not available, so staged changes were not scanned for secrets.

  Install it (https://github.com/gitleaks/gitleaks#installing) or start Docker,
  then commit again. To commit anyway you must pass --no-verify deliberately —
  GitHub push protection is the only thing left between you and a leaked
  credential at that point.
MESSAGE
exit 1
