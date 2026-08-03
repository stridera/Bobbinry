# Dependabot lockfile workflow — one-time setup

`.github/workflows/dependabot-lockfile.yml` regenerates `bun.lock` on Dependabot
PRs and pushes it back. Without it, every Dependabot PR fails CI at
`bun install --frozen-lockfile`, because Dependabot bumps the manifests but
leaves the lockfile untouched in npm-workspace monorepos
([dependabot-core#14223](https://github.com/dependabot/dependabot-core/issues/14223),
open upstream).

Pushing back requires a credential the default `GITHUB_TOKEN` can't provide:
pushes made with `GITHUB_TOKEN` **deliberately do not trigger workflow runs**, so
the fixed commit would sit forever with stale red checks. A GitHub App
installation token does re-trigger CI, and unlike a PAT it expires in about an
hour and is revoked when the job ends.

The workflow fails fast with a pointer here if the two secrets below are missing.

## 1. Create the GitHub App

<https://github.com/settings/apps/new>

| Field | Value |
|---|---|
| **GitHub App name** | `bobbinry-lockfile-bot` (must be globally unique) |
| **Homepage URL** | `https://github.com/stridera/Bobbinry` |
| **Webhook** | **Uncheck "Active"** — this App never receives events |

Under **Repository permissions**, set exactly one:

- **Contents: Read and write**

Leave everything else at *No access*. Under **Where can this GitHub App be
installed?** choose **Only on this account**.

Click **Create GitHub App**.

## 2. Record the App ID, generate a private key

On the App's settings page:

- Copy the **App ID** (a number near the top).
- Scroll to **Private keys** → **Generate a private key**. A `.pem` file
  downloads. This is the only time you can get it.

## 3. Install the App on the repo

Left sidebar → **Install App** → install on your account → **Only select
repositories** → pick **stridera/Bobbinry** → **Install**.

An App that is never installed produces a token with no access, and the workflow
fails at checkout rather than at the credential check — so don't skip this.

## 4. Add both values as **Dependabot** secrets

<https://github.com/stridera/Bobbinry/settings/secrets/dependabot>

> [!IMPORTANT]
> These must go under **Dependabot**, *not* Actions. On a Dependabot-authored
> `pull_request`, `secrets.*` resolves only to the Dependabot secret store;
> Actions secrets are invisible and would silently read as empty. This is the
> single most common way this setup is gotten wrong.

| Secret name | Value |
|---|---|
| `LOCKFILE_APP_ID` | the App ID from step 2 |
| `LOCKFILE_APP_PRIVATE_KEY` | the **entire** `.pem` file contents |

For the private key, paste everything including the
`-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----` lines and
the trailing newline. Delete the `.pem` from your Downloads folder afterwards.

## 5. Verify

The next Dependabot PR should show the **Dependabot lockfile / regenerate** check
run green, add a `build(deps): regenerate bun.lock` commit, and re-fire CI so the
PR can go green on its own.

To test without waiting for the Monday schedule, comment `@dependabot recreate`
on any open Dependabot PR.

The workflow settles after exactly one regeneration: its own push re-fires the
workflow, the second run finds the lockfile already in sync, and stops.

## Rotating the key

Generate a new private key on the App's settings page, update
`LOCKFILE_APP_PRIVATE_KEY`, then delete the old key. Issued installation tokens
are short-lived, so nothing else needs revoking.

## If it fails

| Symptom | Cause |
|---|---|
| `LOCKFILE_APP_ID / LOCKFILE_APP_PRIVATE_KEY are not set` | Secrets missing, or added under Actions instead of Dependabot (step 4). |
| Token creation fails with `not found` / `Integration not found` | Wrong App ID, or malformed private key — re-paste the whole `.pem`. |
| Checkout or push fails with 403 | App not installed on the repo (step 3), or missing **Contents: read/write** (step 1). |
| Check never appears at all | The PR touched no `**/package.json`, or its author isn't `dependabot[bot]` — both are intentional guards in the workflow. |

## Manual fallback

If the automation is down, fix a Dependabot PR by hand:

```bash
gh pr checkout <num>
bun install
git add bun.lock && git commit -m "build(deps): regenerate bun.lock" && git push
```
