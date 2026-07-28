# BUG: `DELETE` chapter annotation returns 500

**Status:** not reproducible as of 2026-07-28 · original hypothesis disproven · regression test added
**Severity:** medium — while it was failing, readers and bots could not retract their own
annotations; the author-side inbox accumulated entries that could only be `dismissed`.

## Endpoint

```
DELETE /api/public/chapters/:chapterId/annotations/:annotationId
```

Handler: `apps/api/src/routes/reader.ts:3216-3249` ("Delete own annotation").

## Outcome of the 2026-07-28 investigation

The endpoint works. A full create → delete round trip against `api.bobbinry.com` succeeds:

| Step | Result |
|---|---|
| `POST /api/public/chapters/<ch>/annotations` | `201` |
| `DELETE .../annotations/<new id>` | `200 {"success":true}` |
| `DELETE .../annotations/9fa00380-…` (the stuck probe row) | `200 {"success":true}` |

Both probe rows are gone from the production database — the cleanup task below is done.

## The prime suspect was wrong — schema drift is ruled out

The previous theory was a trigger / RLS policy / undeclared foreign key on the live
`chapter_annotations` table. Queried directly against the production Neon database, **all of
it comes back empty**:

| Check | Production result |
|---|---|
| Foreign keys pointing at `chapter_annotations` | 0 |
| Non-internal triggers | 0 |
| Row-level-security policies | 0 (and `relrowsecurity = false`) |
| Rewrite rules | 0 |
| `DELETE` privilege for `neondb_owner` | granted |

The exact statement was then executed against the real production row inside a `DO` block
that raised afterwards (so nothing committed) — Postgres ran the `DELETE` with no error.
The database was never the problem.

Also ruled out: prepared statements against the Neon pooler. Production's `DATABASE_URL`
host is `ep-shiny-cell-akcabwq4-pooler.c-3.us-west-2.aws.neon.tech`, so the
`isPooledConnection` check in `apps/api/src/db/connection.ts:10` matches and `prepare` is
correctly `false`.

## What the reported response body actually tells us

The report recorded this body:

```json
{"error":"Internal Server Error","correlationId":"..."}
```

That string is **not** what the handler's own catch block sends — that one sends
`{"error":"Failed to delete annotation", …}` (`reader.ts:3247`). `"Internal Server Error"`
is produced only by the global error handler in `apps/api/src/server.ts:107-141`.

So the error never reached the handler's `try/catch`. Since the `try` wraps the entire
handler body including the `db.delete()`, the failure did not originate in the statement the
report narrowed it down to.

**This also means the log-lookup advice in the original report was wrong**, which is why it
led nowhere:

- The message to grep is `'Unhandled error'`, not `'Failed to delete annotation'`.
- The two `correlationId`s in a 500 body are **not the same ID space**. The handler mints its
  own `randomUUID()`; the global error handler instead uses
  `request.headers['x-correlation-id'] ?? request.id`, i.e. the Fastify request id. The IDs
  recorded here (`350a9c49-…`, `9d258250-…`) are request ids and correlate with the
  `reqId` field on the ordinary request/response log lines.

## Most likely cause: transient process state, cleared by a restart

The delete handler has not been touched since 2026-04-08 (commit `6823a23`), and no code
commit landed between the reported failures and the successful retest — the last commit was
`8bb03b1` on 2026-07-27 00:16. Fly release **v209** restarted the single `sjc` machine at
`2026-07-27T07:19:11Z`, *after* the failures were observed and before this retest.

That timeline — same code, fails consistently, then works after a machine restart — points
at per-process or per-connection state rather than a logic or schema defect. Note that
`apps/api/src/db/connection.ts:63-83` already documents a known `postgres-js` stuck-pool mode
in which the machine keeps serving traffic while queries fail, and already self-heals via the
health check.

The exact trigger could not be confirmed: Fly log retention had rolled past the failure
window, so the original stack traces are gone.

## If it happens again — do this first

Retention is the binding constraint, so capture logs *while* reproducing:

```bash
fly logs -a bobbinry-api > /tmp/flylogs.txt &      # start the tail FIRST
curl -sS -X DELETE "https://api.bobbinry.com/api/public/chapters/<ch>/annotations/<id>" \
  -H "Authorization: Bearer bby_..."
grep -E "Unhandled error|Failed to delete annotation" /tmp/flylogs.txt
```

The distinction between those two log messages is the fork in the road: `'Failed to delete
annotation'` means the database really did reject the statement; `'Unhandled error'` means the
failure was in the surrounding pipeline (hook, serialization, or reply lifecycle), not the
query.

## Known diagnosability defect (not yet fixed)

Handlers in `reader.ts` mint a per-handler `randomUUID()` as `correlationId` and return it to
the client, while the request pipeline logs a *different* id (`request.id`) on every
request/response line. A `correlationId` handed to a user therefore only appears in the logs
if the handler's own catch block ran. Unifying these on `request.id` would make every returned
correlation id greppable. Left alone here because it spans many handlers and is a separate
change from this bug.

## Regression test — added

`apps/api/src/routes/__tests__/reader-annotations.test.ts` covers the delete path:

- create an annotation, delete it as its author → `200`, and the row is actually gone
- unauthenticated delete → `401`
- nonexistent annotation → `404`
- someone else's annotation → `403`, and the row survives

Run with `cd apps/api && bun run test:integration -- --testPathPatterns reader-annotations`.

## Cleanup task — done

Probe annotation `9fa00380-2bf8-447f-a47c-a333ed8bb501` on **Quantum Error**, Chapter 1, has
been deleted, along with the round-trip probe created during this investigation. No probe rows
remain.

## Downstream impact

The Daily-Sync bot (`~/Writing/Daily-Sync`) writes proofing annotations (typos, wrong names,
continuity slips) into the feedback panel on each daily run. Retraction of a false positive
works again. The low per-run cap can be revisited independently.
