#!/usr/bin/env bash

set -ueo pipefail

./scripts/pack/pack.sh

npx_timeout_sec=10
if ! timeout "$npx_timeout_sec" ./temp-pack/lantern; then
  status=$?
  # timeout (124) means it started and kept running, which is what we want
  if [ "$status" -ne 124 ]; then
    exit "$status"
  fi
fi
