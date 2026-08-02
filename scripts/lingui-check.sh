#!/usr/bin/env bash

set -ueo pipefail

# Run lingui:extract and look for missing translations
output=$(pnpm lingui:extract 2>&1)

# Pull out the Missing counts
missing_values=$(echo "$output" | grep -A 100 "Catalog statistics" | grep -E "│.*│.*│.*│" | grep -v "Language" | grep -v "─" | awk -F'│' '{gsub(/^[ \t]+|[ \t]+$/, "", $4); if ($4 != "-" && $4 != "") print $4}')

# Fail if any of them is greater than zero
has_missing=false
for value in $missing_values; do
  if [ "$value" -gt 0 ]; then
    echo "Error: Missing translations found: $value"
    has_missing=true
  fi
done

if [ "$has_missing" = true ]; then
  echo ""
  echo "$output"
  exit 1
fi

echo "✓ All translations are complete (no missing translations)"

