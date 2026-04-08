#!/usr/bin/env bash
set -euo pipefail

# Ensure every bobbin's package.json is copied into the Dockerfile
# for workspace dependency resolution during Docker builds.
#
# Without this, adding a new bobbin will pass CI build but break
# the Fly.io deploy when bun install can't resolve the workspace dep.

DOCKERFILE="apps/api/Dockerfile"
errors=0

for pkg in bobbins/*/package.json; do
  bobbin_dir=$(dirname "$pkg")
  copy_line="COPY ${bobbin_dir}/package.json ${bobbin_dir}/"

  if ! grep -qF "$copy_line" "$DOCKERFILE"; then
    echo "ERROR: $DOCKERFILE is missing: $copy_line"
    errors=$((errors + 1))
  fi
done

if [ "$errors" -gt 0 ]; then
  echo ""
  echo "$errors bobbin(s) not in Dockerfile. Add the missing COPY line(s) to the"
  echo "dependency resolution stage (before 'bun install') in $DOCKERFILE."
  exit 1
fi

echo "Dockerfile bobbin check: OK"
