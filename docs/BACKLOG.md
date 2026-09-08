# Engineering Backlog

Known work that is understood but not yet done. Each item says what is wrong,
why it matters, and what the fix looks like, so it can be picked up cold.
Items leave this file when they land; history is in git.

Last reviewed: 2026-09-07 (after the `fix/slop-review-security` cleanup and its follow-ups).

## D. Verify / housekeeping

### D2. `@types/html-to-text` pinned to 9.x while runtime is 10.x
No v10 typings on DefinitelyTyped yet; compiles because the API is
compatible. Check `npm view @types/html-to-text version` occasionally and
bump `apps/api/package.json` when 10.x appears.

## Test coverage log

Routes and modules that gained tests, newest last. Bugs found while writing
them are fixed in the same commit.
- 2026-09-08 `routes/dashboard.ts` (35 cases: stats, project lists and grouping, recent activity, archive, short URLs, trash lifecycle) — dashboard entity count no longer includes `entity_type_definitions`, which the same file treats as internal elsewhere.
- 2026-09-08 `routes/admin.ts` (45 cases: the owner gate on every route, user search and pagination, badge grant/revoke, supporter grant/revoke incl. Stripe protection, cron trigger) — admin `:userId` routes validate the id (were masked 500s) and re-granting a revoked badge reactivates it instead of conflicting forever.
- 2026-09-08 `jobs/revision-thinning` seeds anchor to midday UTC; the supporter newest-per-day test merged two days into one whenever the suite ran within three hours of midnight UTC.
