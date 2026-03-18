#!/usr/bin/env bash
set -euo pipefail

# Vercel compatibility check
#
# Vercel builds from a clean git checkout. If the shell app's tsconfig has
# "incremental": true, TypeScript creates .tsbuildinfo references that
# Next.js file tracing tries to lstat — but those files are gitignored,
# so the build fails on Vercel even though it passes locally.

SHELL_TSCONFIG="apps/shell/tsconfig.json"

if grep -q '"incremental":\s*true' "$SHELL_TSCONFIG"; then
  echo "ERROR: $SHELL_TSCONFIG has \"incremental\": true"
  echo "  This breaks Vercel deploys — Next.js file tracing will try to lstat"
  echo "  .tsbuildinfo files that don't exist in a clean checkout."
  echo "  Set \"incremental\": false in the shell tsconfig."
  exit 1
fi

echo "Vercel compatibility: OK"
