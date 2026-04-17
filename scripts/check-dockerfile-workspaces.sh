#!/usr/bin/env bash
# Verify that every workspace package.json is listed in the API Dockerfile.
# Catches the "new package breaks Fly deploy" bug at commit time.
set -euo pipefail

DOCKERFILE="apps/api/Dockerfile"

if [ ! -f "$DOCKERFILE" ]; then
  echo "Dockerfile not found at $DOCKERFILE — skipping check"
  exit 0
fi

missing=()

# Find all workspace package.json files (apps/*, packages/*, bobbins/*)
for pkg in apps/*/package.json packages/*/package.json bobbins/*/package.json; do
  [ -f "$pkg" ] || continue
  # Check if this package.json path appears as a COPY source in the Dockerfile
  if ! grep -q "COPY ${pkg}" "$DOCKERFILE"; then
    missing+=("$pkg")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "ERROR: Dockerfile is missing COPY lines for these workspace packages:"
  for pkg in "${missing[@]}"; do
    echo "  COPY ${pkg} ${pkg%/*}/"
  done
  echo ""
  echo "Add the missing COPY line(s) to ${DOCKERFILE} so Fly deploys don't fail."
  exit 1
fi

echo "Dockerfile workspace check: OK"
