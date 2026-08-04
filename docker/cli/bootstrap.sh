#!/usr/bin/env bash
# Shared prelude for every CLI entrypoint.
#
# Two things every one of them needs:
#
# 1. Not running as root. Claude Code flatly refuses to skip permission prompts
#    as root, and the others are not worth finding out about the hard way.
#    Named volumes arrive root-owned, so the container starts as root, fixes
#    ownership, and drops.
#
# 2. A writable workspace at the same path in every container. The prompts ask
#    the agents to edit a file, which a read-only bind mount would refuse; and
#    a path shared across all three means Lantern should group their sessions
#    into one workspace, which is worth testing.
set -uo pipefail

AGENT_USER=agent
AGENT_HOME=/home/agent
export WORK=/work

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$AGENT_HOME" "$WORK"

  # A pristine copy per run: the agents edit it, and a dirty tree would make
  # each run depend on the last.
  if [ -d /workspace-src ]; then
    cp -a /workspace-src/. "$WORK"/
  fi

  # Every directory the CLI might write to, including the mounted volumes.
  for dir in "$AGENT_HOME" "$WORK" "${HARNESS_OWNED_DIRS:-}"; do
    [ -n "$dir" ] && [ -e "$dir" ] && chown -R "$AGENT_USER:$AGENT_USER" "$dir"
  done

  exec gosu "$AGENT_USER" "$0" "$@"
fi

export HOME="$AGENT_HOME"

cd "$WORK" || exit 1
git init -q 2>/dev/null || true
git config user.email harness@example.com 2>/dev/null || true
git config user.name "Harness" 2>/dev/null || true
