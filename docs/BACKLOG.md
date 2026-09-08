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
