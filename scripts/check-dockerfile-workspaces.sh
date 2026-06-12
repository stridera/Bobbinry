#!/usr/bin/env bash
# Verify the API Dockerfile and the workspace layout agree, in both directions:
#  1. every workspace package.json is listed in the Dockerfile
#     (catches "new package breaks Fly deploy")
#  2. every workspace package.json the Dockerfile COPYs still exists on disk
#     (catches "deleted package breaks Fly deploy" — COPY of a missing path
#     fails the remote Docker build with "failed to calculate checksum")
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

stale=()

# Reverse direction: every workspace package.json COPY source must exist
while IFS= read -r src; do
  if [ ! -f "$src" ]; then
    stale+=("$src")
  fi
done < <(grep -oE '^COPY (apps|packages|bobbins)/[^ ]+/package\.json' "$DOCKERFILE" | sed 's/^COPY //')

if [ ${#stale[@]} -gt 0 ]; then
  echo "ERROR: Dockerfile COPYs workspace packages that no longer exist:"
  for src in "${stale[@]}"; do
    echo "  $src"
  done
  echo ""
  echo "Remove the stale COPY line(s) from ${DOCKERFILE} so Fly deploys don't fail."
  exit 1
fi

echo "Dockerfile workspace check: OK"
