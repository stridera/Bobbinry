# Drizzle migrations — known quirks

The snapshot chain in `meta/` is **incomplete** and `meta/_journal.json` has
gaps. Both are intentional once you know the history, but they trip up
anyone running `drizzle-kit` for the first time. Read this before "fixing"
anything in `meta/`.

> ⚠️  Do not put non-`*.json` files inside `meta/` — `drizzle-kit` scans
> every file in that directory and JSON-parses it as a snapshot. Even a
> README will crash it.

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

## The snapshot chain rebase (0024)

Only `0000_snapshot.json` through `0005_snapshot.json` exist for the early
migrations. Snapshots for `0007`–`0023` were never committed, and `0004` /
`0005` historically shared the same `id`.

This was fixed in 2026-04 by adding `0024_rebase_baseline`:

- `0005_snapshot.json` was given a unique `id` (fixing the collision).
- `0024_snapshot.json` was generated from `schema.ts` via `drizzle-kit
  generate` in a scratch directory, then patched to chain off `0005`.
- `0024_rebase_baseline.sql` is a no-op (comment-only) — the runtime
  migrator records it but executes nothing.

After the rebase, `drizzle-kit check` and `drizzle-kit generate` both work
correctly. The schema-drift pre-commit check (`apps/api/scripts/check-schema-drift.sh`)
now catches real drift.
