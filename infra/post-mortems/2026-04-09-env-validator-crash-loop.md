# 2026-04-09 — Env validator crash loop took down the API and shell

## Impact

- **api.bobbinry.com**: hard down for ~2 hours, returning 502. Fly.io machine
  was crash-looping (`failed to change machine state: machine still active,
  refusing to start`).
- **bobbinry.com**: returning 500 `MIDDLEWARE_INVOCATION_FAILED` for the entire
  outage window. The site stayed broken for an additional ~30 minutes after
  the API came back, because the in-flight Vercel deploys couldn't get
  through builds (see "secondary failure" below).
- **Vercel deploys**: three consecutive deploys failed in the static
  generation phase before the issue was caught.

## Root cause

Commit [`a590af6`](https://github.com/stridera/Bobbinry/commit/a590af6)
("Audit env vars: sync .env.example, extend validators, wire shell validation")
expanded the `requiredEnvVars.production` list in **both** `apps/api/src/lib/env.ts`
and `apps/shell/src/lib/env.ts` and wired the shell validator to run at boot
via a side-effect import in `apps/shell/src/auth.ts`.

The problem: I added vars to the required list **without verifying they were
set in the actual production environments**.

- API (Fly): added `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_SUPPORTER_MONTHLY_PRICE_ID`, `STRIPE_SUPPORTER_YEARLY_PRICE_ID`.
  The Stripe price IDs were never set as Fly secrets.
- Shell (Vercel): added `NEXT_PUBLIC_APP_URL` and `INTERNAL_API_AUTH_TOKEN`.
  At least one of these was missing in Vercel production env.

The validator's failure mode is to **`throw new Error()` at module load**:

```ts
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}\n...`)
}
```

Combined with `export const env = validateEnv()` at the bottom of the same
file, that throw runs the moment any module imports `env`. On the API, that
killed the Fastify process before it could open a socket; Fly restarted it,
the validator threw again, infinite loop. On the shell, the same pattern
crashed `auth.ts` on every request, producing `MIDDLEWARE_INVOCATION_FAILED`.

## Secondary failure: cascading sitemap build timeout

`apps/shell/src/app/sitemap.ts` calls `fetch(\`${API_URL}/api/discover/...\`)`
during Next.js static generation to enumerate URLs. With the API in a crash
loop, those fetches hung the full Vercel build worker timeout (60s × 3
retries) and the build was marked failed:

```
Failed to build /sitemap.xml/route: /sitemap.xml after 3 attempts.
```

This meant **even after** the API hotfix landed, the very next Vercel deploy
also failed because:
1. The fetch had no client-side timeout.
2. The build worker had started before the API recovered.

So the broken `d771f3a` deployment kept serving 500s even while the fix
existed in `main` and was in the middle of building.

## Detection

Caught by `/verify-deploy` skill, which surfaced:
- `bobbinry.com=500` and `api.bobbinry.com=502` from raw curls.
- The full stack trace from `flyctl logs` pointing at `validateEnv` in
  `apps/api/dist/lib/env.js:37:15`.
- Three Vercel deploys in `state: ERROR` for consecutive `main` commits.

Without the verify skill the outage would likely have lasted longer — none
of the existing pre-commit checks (lint, typecheck, build) reproduce a
production environment, so they pass even when production env vars are
missing.

## Fix

[`18dfb1a`](https://github.com/stridera/Bobbinry/commit/18dfb1a) "Stop env
validators from crashing the API and shell on optional vars":
- Narrowed the `requiredEnvVars.production` lists back to vars that are
  truly load-bearing (DB URL, JWT secret, S3 credentials, NEXTAUTH_SECRET).
- Introduced a `recommendedEnvVars` list for the rest. Missing recommended
  vars now print a `console.warn` instead of throwing.
- Added a unit test that asserts loading `apps/api/src/lib/env.ts` does NOT
  throw when the Stripe price IDs are unset (regression guard).

Follow-up commit added a fetch timeout to `apps/shell/src/app/sitemap.ts`
so a slow or unreachable API can no longer hang the build for 3 minutes.

## What we got wrong

- **"Required" was the wrong axis.** The choice of which vars throw at boot
  and which warn isn't about how important the var is — it's about whether
  the *whole service* should refuse to start when it's missing. A missing
  Stripe price ID disables membership signups. That's bad. It is not "the
  API can't function" bad. The validator conflated those.
- **The pre-commit check ran the build, which fooled me.** During
  `next build`, the validator was correctly bypassed via the
  `NEXT_PHASE === PHASE_PRODUCTION_BUILD` guard, so the local build passed
  cleanly. The validator only fired at *runtime* on Vercel. The pre-commit
  check would have had to spin up an actual server to catch this.
- **No env-var diff between `.env.example` and the deployed environments.**
  I assumed that because I'd added a var to `.env.example`, it was set
  everywhere. There is currently no audit/sync between those files and Fly
  secrets / Vercel env vars.

## Prevention

**Landed:**
- Unit test in `apps/api/src/lib/__tests__/unit/env.test.ts` that asserts
  the `recommended` vars never throw the validator. Catches the exact
  pattern that broke prod.
- Fetch timeout in `sitemap.ts` so a single slow upstream can't hang the
  Vercel build longer than `FETCH_TIMEOUT_MS × number_of_fetches`.
- Comments in both env modules explaining *why* the required list is narrow
  and pointing at this post-mortem.

**Landed after the secondary incident (`postgres-js` stuck pool):**

A second incident surfaced during the same `/verify-deploy` session:
after setting the Stripe price IDs as Fly secrets, the rolling-restart
that followed created a fresh pool that got stuck ~3 minutes later
with `CONNECT_TIMEOUT` errors and the suspicious
`address: undefined, port: undefined` signature. Fly's health check
marked the machine critical but didn't auto-restart it; traffic kept
hitting the dead pool until a manual `flyctl machine restart`.

Fixes landed in `apps/api/src/db/connection.ts`:

- `checkDatabaseHealth()` now wraps the `SELECT 1` probe in a 3-second
  `Promise.race` timeout so `/health` always returns within ~3s even
  when the pool is stuck. Previously the probe could hang for 13s+
  and tie up Fly's 5s-timeout health check.
- A consecutive-failure counter calls `process.exit(1)` after 3
  sequential health check failures (≈90s of confirmed unhealthiness).
  Fly's default behavior is to restart an exited machine, which
  rebuilds the pool from scratch — exactly what manual intervention
  did to recover. No `fly.toml` changes needed; this works on Fly's
  default restart policy.

**Not yet done — file as follow-up if it bites again:**
- A script that diffs the var names referenced in
  `apps/{api,shell}/src/lib/env.ts:requiredEnvVars.production` against the
  output of `flyctl secrets list` and `vercel env ls production`, and fails
  CI if anything is missing. This would have caught the original mistake at
  PR time.
- Health checks for the Vercel deployment that probe `/` immediately after
  promotion and rollback automatically if the response is 5xx.
- Better separation between "this is a build-time concern" and "this is a
  runtime concern" in the env validator — right now it's all the same code
  path with a `NEXT_PHASE` flag.
