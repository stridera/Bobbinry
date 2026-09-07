#!/usr/bin/env bash
# Two boundaries the API keeps:
#  - logging goes through lib/logger.ts (pino, shared with Fastify); console.*
#    is only for CLI scripts — seeds, backfills, migrations — whose output is
#    meant for a terminal.
#  - configuration goes through lib/env.ts; nothing else reads process.env, so
#    there is one place to look for a variable and one set of defaults.
set -euo pipefail
cd "$(dirname "$0")/.."

scripts_re='apps/api/src/(db/(seed|backfill|migrate)[^/]*\.ts|check-tables\.ts|test-setup\.ts|jest-global-setup\.ts|__tests__/|.*\.test\.ts|.*/__tests__/)'
fail=0

hits=$(grep -rn --include='*.ts' -E 'console\.(log|warn|error|info|debug)\b' apps/api/src \
  | grep -vE "$scripts_re|apps/api/src/lib/logger\.ts" || true)
if [ -n "$hits" ]; then
  echo "✗ console.* outside CLI scripts — use moduleLogger() from apps/api/src/lib/logger.ts:"
  echo "$hits" | sed 's/^/  /'; fail=1
fi

hits=$(grep -rn --include='*.ts' -E 'process\.env\b' apps/api/src \
  | grep -vE "$scripts_re|apps/api/src/lib/(env|logger)\.ts" || true)
if [ -n "$hits" ]; then
  echo "✗ process.env outside lib/env.ts — read env.X from apps/api/src/lib/env.ts (values are live getters):"
  echo "$hits" | sed 's/^/  /'; fail=1
fi

[ "$fail" -eq 0 ] && echo "API boundaries check: OK"
exit "$fail"
