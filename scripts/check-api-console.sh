#!/usr/bin/env bash
# The API logs through lib/logger.ts (pino), shared with Fastify's request
# log. console.* is only for CLI scripts — seeds, backfills, migrations —
# whose output is meant for a terminal. Anything else must use
# moduleLogger(); this check keeps that boundary from eroding.
set -euo pipefail
cd "$(dirname "$0")/.."

hits=$(grep -rn --include='*.ts' -E 'console\.(log|warn|error|info|debug)\b' apps/api/src \
  | grep -vE 'apps/api/src/(db/(seed|backfill|migrate)[^/]*\.ts|check-tables\.ts|lib/logger\.ts|__tests__/|.*\.test\.ts|.*/__tests__/)' \
  || true)

if [ -n "$hits" ]; then
  echo "✗ console.* outside CLI scripts — use moduleLogger() from apps/api/src/lib/logger.ts:"
  echo "$hits" | sed 's/^/  /'
  exit 1
fi
echo "API console check: OK"
