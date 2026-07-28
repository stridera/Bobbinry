# BUG: `DELETE` chapter annotation returns 500

**Status:** fixed 2026-07-28 · root cause identified and reproduced deterministically
**Severity:** medium, but far wider than first reported — the defect was in the shared
`application/json` body parser, so it affected **every route in the API**, not just
annotations.

## Root cause

`server.ts` replaces Fastify's built-in `application/json` parser to raise the body limit.
The replacement did not reproduce the built-in's error semantics:

```ts
done(null, JSON.parse(body as string))   // body === ''  →  SyntaxError
} catch (error) {
  done(error instanceof Error ? error : new Error('Invalid JSON'), undefined)
}
```

Two things combine:

1. A request that sets `Content-Type: application/json` but sends **no body** makes
   `JSON.parse('')` throw. Fastify's built-in parser has a dedicated branch for this
   (`FST_ERR_CTP_EMPTY_JSON_BODY`, status 400); the replacement did not.
2. The re-thrown error carries **no `statusCode`**, and the global error handler falls back
   to `error.statusCode || 500`. So a client error surfaced as `500 Internal Server Error`.

Because parsing happens *before* routing, the handler never ran — which is why the failure
looked like it came from the `db.delete()` call and why the response body said
`"Internal Server Error"` rather than the handler's own `"Failed to delete annotation"`.

### What triggered it

The Daily-Sync bot calls the API through Python's `urllib`, with a helper that sets a fixed
header dict on every request:

```python
req = urllib.request.Request(url, data=None, method='DELETE',
    headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
```

`data=None` means no body, but the `Content-Type` header is still sent. Plenty of clients do
this — Python `urllib`, several SDKs, hand-rolled DELETE calls.

### Deterministic reproduction

```bash
# No Content-Type → reaches the handler
curl -sS -X DELETE ".../api/public/chapters/<uuid>/annotations/<uuid>" -H "Authorization: Bearer bby_..."
# {"error":"Annotation not found",...}  HTTP 404

# Content-Type: application/json with no body → dies in the parser
curl -sS -X DELETE ".../api/public/chapters/<uuid>/annotations/<uuid>" \
  -H "Authorization: Bearer bby_..." -H "Content-Type: application/json"
# {"error":"Internal Server Error",...}  HTTP 500
```

Stack trace, captured on dev:

```
SyntaxError: JSON Parse error: Unexpected EOF
    at <anonymous> (apps/api/src/server.ts:210:23)
    at onEnd (fastify/lib/content-type-parser.js:301:27)
```

## The fix

`apps/api/src/server.ts` — the custom parser now mirrors the built-in's semantics:

- empty body → `done(null, undefined)`, so the route decides what to do about it
- malformed JSON → an error tagged `statusCode: 400`
- oversized body → an error tagged `statusCode: 413`

## Why the original investigation stalled

Worth recording, because each wrong turn was a reasonable inference from bad signals:

- **The reproduction in the report was not the failing call.** It was written as `curl` with
  only an `Authorization` header, but the failure came from the Python helper that also sent
  `Content-Type`. The documented repro genuinely returns 200 — it exercises a different path.
- **The narrowing table was misleading.** The 404/403 probes were run with a *different*
  helper in the same session, one that omitted the `Content-Type` header. So they took the
  working path, which made it look like only the `db.delete()` line could be at fault.
- **The "prime suspect" was schema drift.** Checked against the production database: zero
  inbound foreign keys, zero non-internal triggers, zero RLS policies, zero rewrite rules,
  and `DELETE` granted. The statement itself was executed against the real production row
  inside an aborting `DO` block and ran cleanly. The database was never involved.
- **The log-lookup advice pointed at the wrong message and the wrong id.** A 500 from the
  global handler logs `'Unhandled error'`, not `'Failed to delete annotation'`, and the id
  in the body was a Fastify request id, not the handler's own `randomUUID()`. That mismatch
  is fixed separately (see below).
- **A restart red herring.** The report is dated 2026-07-27 and Fly release v209 restarted
  the machine at `2026-07-27T07:19:11Z`, which suggested a transient process-state fault
  cleared by the restart. The session transcript shows the failures actually occurred at
  **2026-07-28 05:12–05:24Z** — the restart predates them by ~22h and is irrelevant.

## Related fix: correlation ids are now greppable

Handlers minted their own `randomUUID()` as `correlationId` and returned it, while the
pipeline logged `request.id` as `reqId`. A correlation id handed to a user therefore appeared
in the logs only if that handler's own catch block ran — not the case here. The global error
handler compounded it by preferring a client-supplied `x-correlation-id`, which appears in no
log line at all.

All 61 handler sites in `reader.ts`, `publishing.ts` and `project-tags.ts` now use
`request.id`, as does `server.ts`; a client-supplied `x-correlation-id` is recorded as a
separate `clientCorrelationId` field. This is what made the stack trace above findable in one
grep.

## Regression tests

- `apps/api/src/routes/__tests__/json-body-parser.test.ts` — empty body with a JSON
  content-type is not a 500; malformed JSON is a 400; valid JSON still parses.
- `apps/api/src/routes/__tests__/reader-annotations.test.ts` — the delete round trip
  (including the exact `Content-Type: application/json` + no body case), plus 401/404/403.

## Standing risk: CI runs no tests

`.github/workflows/ci.yml` runs build, typecheck and lint only. Nothing runs `bun run test`
or `bun run test:integration`, which is why this endpoint had no coverage and why seven
unrelated integration tests had been failing unnoticed. Wiring the suites into CI is the
highest-value follow-up.

## Cleanup

Both probe annotations on **Quantum Error** Chapter 1 (`9fa00380-…` and the round-trip probe
created while investigating) are deleted. No probe rows remain.

## Downstream impact

The Daily-Sync bot (`~/Writing/Daily-Sync`) can retract false-positive proofing annotations
again. Note the bot also calls `PATCH .../annotations/:id/status`, which 404s — that route is
registered as `PUT`. Unrelated to this bug, but it will bite the same code path.
