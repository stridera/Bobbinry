#!/usr/bin/env bash
# Checks that the Drizzle schema and migrations are in sync.
# Runs `drizzle-kit generate` and fails if a new migration file is produced,
# meaning someone changed the schema without generating a migration.
#
# CAVEAT: As of 2026-04, this check passes VACUOUSLY. The snapshot chain in
# `infra/db/migrations/meta/` is broken from 0006 onward and the 0004/0005
# snapshots share an `id`, causing `drizzle-kit generate` to exit early on a
# collision error before it ever computes a real diff. No new SQL files are
# produced, so this script reports "in sync" regardless of actual drift.
# See `infra/db/migrations/README.md` for the full history and the rebase
# plan needed to restore real drift detection.

set -euo pipefail

MIGRATIONS_DIR="../../infra/db/migrations"
META_DIR="$MIGRATIONS_DIR/meta"

# Snapshot existing state
before_sql=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | sort)
before_snapshots=$(find "$META_DIR" -maxdepth 1 -name '*_snapshot.json' | sort)
before_journal=$(cat "$META_DIR/_journal.json")

# Run generate (compares schema.ts against migration snapshots, no DB needed)
bunx drizzle-kit generate 2>&1

after_sql=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | sort)

if [ "$before_sql" != "$after_sql" ]; then
  new_files=$(comm -13 <(echo "$before_sql") <(echo "$after_sql"))
  echo ""
  echo "ERROR: Schema drift detected!"
  echo "drizzle-kit generated new migration(s):"
  echo "$new_files"
  echo ""
  echo "This means the Drizzle schema was changed without generating a migration."
  echo "To fix: run 'bun run db:generate' in apps/api, then commit the migration."
  echo ""
  echo "Cleaning up generated file(s)..."

  # Remove generated SQL files
  for f in $new_files; do
    rm -f "$f"
  done

  # Remove any new snapshot files
  after_snapshots=$(find "$META_DIR" -maxdepth 1 -name '*_snapshot.json' | sort)
  new_snapshots=$(comm -13 <(echo "$before_snapshots") <(echo "$after_snapshots"))
  for f in $new_snapshots; do
    rm -f "$f"
  done

  # Restore the journal file
  echo "$before_journal" > "$META_DIR/_journal.json"

  exit 1
fi

echo "Schema and migrations are in sync."
