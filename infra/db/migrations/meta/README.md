# Drizzle migration meta — known quirks

The snapshot chain in this directory is **incomplete** and the `_journal.json`
has gaps. Both are intentional once you know the history, but they trip up
anyone running `drizzle-kit` for the first time. Read this before "fixing"
anything in here.

## The 0006 gap

`_journal.json` jumps from `idx 5` (`0005_unique_user_followers_pair`) directly
to `idx 6` (`0007_add_email_verification`). There is no `0006_*.sql`.

Why: `0006_add_manifests_versions_unique_index.sql` was an **orphaned** file
that had only ever been applied via `drizzle-kit push` and was never tracked
in the journal. It was removed in commit `2177381` ("Make migrations idempotent
and remove orphaned migration files") together with another orphan,
`0002_add_user_bobbins_installed.sql`.

The journal is correct as-is. Do not try to "renumber" entries to close the
gap — the production `__drizzle_migrations` table is keyed off the migration
hash and tag, so renaming would force a re-apply attempt.

## The snapshot chain is broken from 0006 onward

Only `0000_snapshot.json` through `0005_snapshot.json` exist. Migrations
`0007`–`0022` apply fine (they are read straight from their `.sql` files at
runtime by `runMigrations()`), but their snapshot states were never committed.
On top of that, `0004_snapshot.json` and `0005_snapshot.json` historically
shared the same `id`, so `drizzle-kit check` reports a collision warning.

### What this means for `drizzle-kit`

- **Runtime migrator** (the `runMigrations()` call in `apps/api/src/index.ts`):
  works fine. It only reads `_journal.json` + the `.sql` files, never the
  snapshots.
- **`drizzle-kit check`**: prints a "collision" error and exits non-zero.
- **`drizzle-kit generate`**: also exits early on the same collision, which
  means the schema-drift pre-commit check (`apps/api/scripts/check-schema-drift.sh`)
  passes **vacuously** — it cannot actually detect drift today. See the
  comment in that script.

### Fixing this properly

The right fix is to rebase the snapshot baseline against the live dev DB.
That requires:

1. Standing up a fresh Postgres with all 22 migrations applied.
2. Running `drizzle-kit introspect` against it into a scratch directory to
   capture the current schema as a fresh `0000_snapshot.json`.
3. Renaming/copying that snapshot to `0023_snapshot.json` (or the next
   sequential index) and patching its `id`/`prevId` to chain off `0005`.
4. Adding a no-op `0023_*.sql` migration so the journal entry is honored by
   the runtime migrator.
5. Verifying `drizzle-kit generate` runs to completion against an unchanged
   `schema.ts` (i.e., produces no new files).

This was attempted experimentally and reverted because `drizzle-kit introspect`
refuses to overwrite an existing migrations dir, and `drizzle-kit generate
--custom` only emits an empty SQL file without refreshing the snapshot
content. Doing it properly needs an isolated workspace and is tracked as
follow-up work — not a one-line patch.
