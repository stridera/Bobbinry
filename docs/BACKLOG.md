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
- 2026-09-08 `routes/discover.ts` (29 cases: visibility, search, all four sorts, pagination, genre filter, enrichment, author and tag browse) — public browse counts now exclude unpublished chapters, which previously inflated the count and revealed unpublished work existed.
- 2026-09-08 `routes/templates.ts` (27 cases: gallery listing and filters, shareId fetch, publish validation and defaults, author/admin soft-hide) — a revoked or expired moderator badge no longer authorises hiding someone else's template.
- 2026-09-08 `routes/project-tags.ts` (20 cases: ownership, tag CRUD and duplicates, the installed-bobbins projection incl. a manifest missing from disk, dashboard aggregates) — tag names longer than the column now answer 400 instead of a 500 from Postgres.
- 2026-09-08 `routes/users/profiles.ts` + `public-profile.ts` (26 cases: self-guard, every validation branch, allow-listed updates, username claiming, public shape with no email leak, published-project listing) — claiming a taken username answers 409 instead of a 500 from the unique index.
- 2026-09-08 `routes/project-follows.ts`, `users/unsubscribe.ts`, `rss-tokens.ts` (29 cases: follow/unfollow/mute and follower counts, signed unsubscribe without a session incl. tampered and truncated tokens, RSS token issue/list/revoke with the plaintext never stored and a revoked token losing private-feed access). No route changes needed.
- 2026-09-08 `routes/user-bobbins.ts` (20 cases: global-scope enforcement, schema validation, path traversal refused outside bobbins/, idempotent re-install, per-user isolation on list and uninstall, rows whose manifest left disk). No route changes needed.
- 2026-09-08 `lib/release-schedule.ts` + `jobs/subscription-expiration.ts` + `jobs/tier-dispatch.ts` (44 cases: every cadence and slot-search branch, expiry reconciliation against a mocked Stripe, embargo dispatch) — an expired site membership backed by a Stripe subscription is no longer force-expired when Stripe is simply unconfigured.
- 2026-09-08 `routes/google-drive.ts` (22 cases: signed OAuth state, encrypted token storage, status, per-project opt-in, manual sync success and failure). No route changes needed.

## Open questions from test writing

These are behaviour choices the tests documented rather than changed, because
changing them alters what published schedules do for existing authors.

### Monthly release schedules ignore the configured day
`isMatchingCadence` in `apps/api/src/lib/release-schedule.ts` hardcodes
`date.getUTCDate() === 1` for monthly, so an author who sets a release day
gets the 1st regardless. The stored `releaseDay` is a shared column that means
day-of-week for weekly/biweekly, so honouring it for monthly needs a decision
about what the field means there (and a migration path for anyone already on a
monthly schedule).

### Biweekly "on" weeks are anchored to the Unix epoch
The same function decides biweekly parity with
`Math.floor(date.getTime() / (7*DAY_MS)) % 2 === 0`. Spacing is a correct 14
days, but which calendar weeks count as "on" is not tied to when the author
configured the schedule, so it cannot be explained in the UI and would shift
if the anchor ever changed.
