#!/usr/bin/env bash
set -euo pipefail

# Guard against build-time imports of bobbin dist output from apps/api/src.
#
# The Fly Dockerfile builds the API with `npx turbo build --filter=api`, which
# only builds the api package and its workspace dependencies — it does NOT build
# the bobbins/*/dist output (bobbins are reached by relative path, not as
# workspace deps). A *literal* import specifier pointing into bobbins/*/dist is
# resolved by tsc at build time and fails with TS2307 in that image, even though
# it passes locally and in CI (both run the full `turbo build`, which happens to
# build the bobbin dist first).
#
# The safe pattern is a template-literal dynamic import, which tsc leaves
# unresolved at build time and loads at runtime where dist/ is present:
#   const id = 'google-drive-backup'
#   await import(`../../../../bobbins/${id}/dist/actions/sync-service`)

API_SRC="apps/api/src"

# 1) static imports:  from '...bobbins/...dist...'   (single or double quote)
# 2) dynamic imports with a string literal: import('...bobbins/...dist...')
# Template-literal imports use backticks and are intentionally NOT matched.
matches=$(grep -rnE \
  "(from[[:space:]]+['\"][^'\"]*bobbins/[^'\"]*dist|import\([[:space:]]*['\"][^'\"]*bobbins/[^'\"]*dist)" \
  "$API_SRC" || true)

if [ -n "$matches" ]; then
  echo "✗ check-api-bobbin-imports: build-time import(s) of bobbin dist found in $API_SRC:"
  echo "$matches"
  echo ""
  echo "These resolve at tsc time but bobbin dist is not built by 'turbo build --filter=api'"
  echo "(the Fly image build), so the API deploy fails with TS2307."
  echo "Use a template-literal dynamic import instead, e.g.:"
  echo "  const id = 'google-drive-backup'"
  echo "  await import(\`../../../../bobbins/\${id}/dist/actions/sync-service\`)"
  exit 1
fi

echo "API bobbin-import check: OK"
