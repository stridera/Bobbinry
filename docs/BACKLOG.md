# Engineering Backlog

Known work that is understood but not yet done. Each item says what is wrong,
why it matters, and what the fix looks like, so it can be picked up cold.
Items leave this file when they land; history is in git.

Last reviewed: 2026-09-06 (end of the `fix/slop-review-security` cleanup).

## A. Left over from the September 2026 quality review

### A1. Ownership checks still inside 36 route handlers
`apps/api/src/middleware/auth.ts#ownsProject()` runs as a preHandler on 54
routes. The remaining 36 call `requireProjectOwnership(request, reply, id)`
inside the handler because the project id is derived mid-request (looked up
from an entity, upload, destination, or API key row) rather than read from
`params`. A guard in the handler body can be skipped by an early return above
it. Fix: for routes whose id *is* in params (`entity-types.ts`,
`search-replace.ts`, `entity-changes.ts`, `import.ts`, `entity-publish.ts`)
switch to the preHandler; for genuinely derived ids, add a
`ownsEntityProject()`-style preHandler that resolves the row first, so no
handler body carries an authorization branch.

### A2. Global error handler and strict bodies on the remaining routes
The security patch gave the reader/annotation routes Zod `.strict()` bodies
and typed error replies. Other routes still hand-validate or spread bodies,
and unexpected throws fall through to Fastify's default 500 with the stack in
dev. Fix: one `setErrorHandler` in `apps/api/src/index.ts` that maps
ZodError → 400 with issues, `ApiError` → its status, everything else → 500
with a correlation id and a `fastify.log.error`; then convert routes to
`schema: { body: zod… }` per module, largest first (`publishing.ts`,
`entities.ts`).

### A3. Logger boundary
`apps/api/src/lib/logger.ts` exists but 77 `console.*` calls remain in
`apps/api/src/jobs` and `apps/api/src/lib`. Fix: an ESLint `no-console` rule
scoped to `apps/api/src` (allowing `lib/logger.ts` and scripts), then
mechanical replacement with `logger.info/warn/error`, keeping structured
fields where the message interpolated ids.

### A4. Live `process.env` reads
`apps/api/src/lib/env.ts` snapshots at import, so `NEXTAUTH_SECRET` in
`middleware/auth.ts#getJwtSecret()` and seven `WEB_ORIGIN` reads (with a
duplicated `http://localhost:3100` fallback) still read `process.env`
directly because tests mutate them at runtime. Fix: expose lazy getters on
`env` for the mutable set (`NODE_ENV`, `WEB_ORIGIN`, `DATABASE_URL`, `S3_*`,
`RESEND_*`, `INTERNAL_API_AUTH_TOKEN`, `NEXTAUTH_SECRET`) and forbid direct
`process.env` outside `env.ts` with a lint rule.

## D. Verify / housekeeping

### D1. `entities.last_edited_at` may not be written on update
Single-row observation on prod (2026-08-06): `updated_at` current,
`last_edited_at` at creation time. `entities_last_edited_idx` exists to serve
"recently edited" sorts, which would silently return creation order. Check
the update path in `apps/api/src/routes/entities.ts`; if confirmed, set
`lastEditedAt` there and backfill
`SET last_edited_at = updated_at WHERE last_edited_at < updated_at`.

### D2. `@types/html-to-text` pinned to 9.x while runtime is 10.x
No v10 typings on DefinitelyTyped yet; compiles because the API is
compatible. Check `npm view @types/html-to-text version` occasionally and
bump `apps/api/package.json` when 10.x appears.

## E. Features

### E1. Shell layout preferences to the database
Panel stack layouts, view preferences, last-nav and panel widths live in
localStorage (`panelLayout:{slotId}`, `viewPreferences`,
`bobbinry:lastNav:{projectId}`, `shellPanelWidth:*`) and are lost on a
cookie clear. Plan: a `user_shell_preferences` table with a JSONB column,
read once at shell mount, written debounced, localStorage kept as the
offline cache.
