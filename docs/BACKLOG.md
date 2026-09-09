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
- 2026-09-08 `components/ShellLayout.tsx` (8 cases: panel geometry from stored preferences, collapse persistence, account sync started once with the token, revealOn dispatch and re-subscription, focus mode and its Esc exit and floating panel). No component changes needed.
- 2026-09-08 `routes/ai-tools.ts` (65 cases: per-user encrypted key storage, every analysis route's auth/ownership/validation, model failures as 502 with no half-written rows, upstream 401/429 passthrough). No route changes needed; the routes have no quota or tier gate to test.
- 2026-09-09 `routes/publishing.ts` release preview endpoint + the publisher's release-config screen now list the next four computed dates (2 cases: the biweekly fortnight invariant and count clamping, plus the ownership guard).

## Open questions from test writing

### Should a biweekly schedule start on the author's chosen week?
`isMatchingCadence` in `apps/api/src/lib/release-schedule.ts` anchors biweekly
parity to Monday, so every selected day of a week fires together. Which of the
two weeks is the "on" one still follows the calendar rather than anything the
author picked, so enabling biweekly gives a first release either this week or
next. The release-config screen now previews the actual dates, which is what
authors were really missing; anchoring to a stored schedule start would only be
worth it if someone asks for "start my fortnight this week" specifically, and it
means a new column plus rules for what happens when the days or frequency
change under a running schedule.
