# Bobbinry API

Fastify-based backend providing data management, authentication, publishing, and platform services for Bobbinry.

## Quick Start

```bash
# From monorepo root
bun install
bun run dev          # Starts API on port 4100 + shell on port 3100
```

The API is available at `http://localhost:4100` (dev) or `https://api.bobbinry.com` (production).

## Technology Stack

- **Runtime**: Bun + Node.js 20+
- **Framework**: Fastify 5.x
- **Language**: TypeScript
- **Database**: PostgreSQL 15+ with Drizzle ORM
- **Validation**: Zod for request/response validation
- **Authentication**: JWT (NextAuth integration) + API keys (`bby_` prefix)
- **Logging**: Pino (structured)
- **Object Storage**: S3-compatible (MinIO local, Cloudflare R2 production)

## Environment

Single `.env` at the monorepo root, symlinked into `apps/api/`. Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | JWT secret (shared with shell) |
| `WEB_ORIGIN` | Shell URL for CORS (`http://localhost:3100`) |
| `S3_ENDPOINT`, `S3_BUCKET`, etc. | Object storage config |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe integration |
| `RESEND_API_KEY` | Email delivery |

## Project Structure

```
src/
├── index.ts              # Entry point, migration runner
├── server.ts             # Fastify server setup, plugin registration
├── db/
│   ├── connection.ts     # Database connection pool
│   ├── schema.ts         # Drizzle schema definitions
│   ├── seed.ts           # Dev seed data
│   └── seed-test-follows.ts  # Follow/subscribe test data
├── routes/               # Route plugins (see API Endpoints below)
├── middleware/
│   └── auth.ts           # JWT + API key auth, scope enforcement, ownership checks
├── lib/                  # Shared utilities
│   ├── effective-bobbins.ts  # Scope-aware bobbin resolution
│   ├── disk-manifests.ts     # Bobbin manifest loading
│   ├── membership.ts         # Tier/badge logic
│   ├── metrics.ts            # Internal metrics
│   └── ...
└── jobs/                 # Background handlers (notifications, Drive sync, Discord)
```

## API Endpoints

All routes are prefixed with `/api` unless noted. Authentication is JWT-based (session) or API key (`bby_` prefix, read-only).

### Health & Internal

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check with DB connectivity |
| GET | `/internal/metrics` | Internal | Metrics snapshot |

### Authentication (`auth.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/signup` | None | Register with email/password |
| POST | `/api/auth/login` | None | Login, returns JWT + 2FA status |
| GET | `/api/auth/session` | JWT only | Current user session info |
| GET | `/api/auth/verify-email` | None | Verify email via token |
| POST | `/api/auth/resend-verification` | JWT | Resend verification email |
| POST | `/api/auth/forgot-password` | None | Request password reset |
| POST | `/api/auth/reset-password` | None | Reset password with token |
| POST | `/api/auth/totp/setup` | JWT | Generate TOTP secret + QR |
| POST | `/api/auth/totp/enable` | JWT | Enable 2FA |
| POST | `/api/auth/totp/disable` | JWT | Disable 2FA |
| POST | `/api/auth/totp/verify` | None | Verify 2FA code during login |

### Projects (`projects.ts`)

| Method | Path | Auth | Scope | Description |
|--------|------|------|-------|-------------|
| GET | `/api/projects` | JWT/Key | `projects:read` | List user's projects |
| GET | `/api/projects/:projectId` | JWT/Key | `projects:read` | Get project details (owner) |
| POST | `/api/projects` | JWT | — | Create project |
| PUT | `/api/projects/:projectId` | JWT | — | Update project |
| POST | `/api/projects/:projectId/bobbins/install` | JWT | — | Install bobbin to project |
| GET | `/api/projects/:projectId/bobbins` | JWT | — | List project bobbins |
| DELETE | `/api/projects/:projectId/bobbins/:bobbinId` | JWT | — | Uninstall bobbin |

### Entities (`entities.ts`)

| Method | Path | Auth | Scope | Description |
|--------|------|------|-------|-------------|
| GET | `/api/collections/:collection/entities` | JWT/Key | `entities:read` | Query entities (requires `?projectId=`) |
| GET | `/api/entities/:entityId` | JWT/Key | `entities:read` | Get entity (requires `?projectId=&collection=`) |
| HEAD | `/api/entities/:entityId` | JWT/Key | `entities:read` | Version check (lightweight) |
| POST | `/api/entities` | JWT | — | Create entity |
| PUT | `/api/entities/:entityId` | JWT | — | Update entity (optimistic locking) |
| DELETE | `/api/entities/:entityId` | JWT | — | Delete entity |
| POST | `/api/entities/batch/atomic` | JWT | — | Atomic batch create/update/delete |

### Dashboard (`dashboard.ts`)

| Method | Path | Auth | Scope | Description |
|--------|------|------|-------|-------------|
| GET | `/api/dashboard/stats` | JWT/Key | `stats:read` | Overview stats (projects, collections, entities, trash) |
| GET | `/api/users/me/projects` | JWT/Key | `stats:read` | Projects with collection info |
| GET | `/api/users/me/projects/grouped` | JWT/Key | `stats:read` | Projects grouped by collection |
| GET | `/api/users/me/recent-activity` | JWT/Key | `stats:read` | Recent entity edits |
| GET | `/api/users/me/trash` | JWT | — | Trashed projects and collections |
| DELETE | `/api/projects/:projectId` | JWT | — | Soft-delete project |
| PUT | `/api/projects/:projectId/restore` | JWT | — | Restore from trash |
| DELETE | `/api/projects/:projectId/permanent` | JWT | — | Hard delete project |
| PUT | `/api/projects/:projectId/archive` | JWT | — | Archive project |
| PUT | `/api/projects/:projectId/unarchive` | JWT | — | Unarchive project |
| POST | `/api/projects/:projectId/short-url` | JWT | — | Claim short URL |
| DELETE | `/api/projects/:projectId/short-url` | JWT | — | Release short URL |
| POST | `/api/short-urls/check` | None | — | Check short URL availability |
| GET | `/api/p/:shortUrl` | None | — | Resolve project short URL |
| GET | `/api/c/:shortUrl` | None | — | Resolve collection short URL |

### Collections (`collections.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/me/collections` | JWT | List user's collections |
| POST | `/api/collections` | JWT | Create collection |
| GET | `/api/collections/:collectionId` | JWT | Get collection |
| PUT | `/api/collections/:collectionId` | JWT | Update collection |
| DELETE | `/api/collections/:collectionId` | JWT | Soft-delete collection |
| PUT | `/api/collections/:collectionId/restore` | JWT | Restore collection |
| DELETE | `/api/collections/:collectionId/permanent` | JWT | Hard delete collection |
| GET | `/api/collections/:collectionId/projects` | JWT | List projects in collection |
| POST | `/api/collections/:collectionId/projects/:projectId` | JWT | Add project to collection |
| DELETE | `/api/collections/:collectionId/projects/:projectId` | JWT | Remove project from collection |
| PUT | `/api/collections/:collectionId/projects/reorder` | JWT | Reorder projects |
| GET | `/api/collections/:collectionId/stats` | JWT | Collection stats |
| POST | `/api/collections/:collectionId/short-url` | JWT | Claim short URL |
| DELETE | `/api/collections/:collectionId/short-url` | JWT | Release short URL |
| POST | `/api/collections/:collectionId/bobbins/install` | JWT | Install collection-scoped bobbin |
| GET | `/api/collections/:collectionId/bobbins` | JWT | List collection bobbins |
| DELETE | `/api/collections/:collectionId/bobbins/:bobbinId` | JWT | Uninstall bobbin |

### Publishing (`publishing.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/projects/:projectId/chapters/:chapterId/publish` | JWT | Publish/schedule chapter |
| POST | `/api/projects/:projectId/chapters/:chapterId/unpublish` | JWT | Unpublish to draft |
| POST | `/api/projects/:projectId/chapters/:chapterId/mark-complete` | JWT | Mark chapter complete |
| POST | `/api/projects/:projectId/chapters/:chapterId/embargo` | JWT | Create embargo schedule |
| GET | `/api/projects/:projectId/publish-config` | JWT | Get publish configuration |
| POST | `/api/projects/:projectId/publish-config` | JWT | Create/update publish config |
| GET | `/api/projects/:projectId/chapters` | JWT | List chapters with pub status |
| GET | `/api/projects/:projectId/tier-delays` | JWT | Tier-based release delays |
| PUT | `/api/embargoes/:embargoId` | JWT | Update embargo |
| DELETE | `/api/embargoes/:embargoId` | JWT | Delete embargo |
| GET | `/api/projects/:projectId/destinations` | JWT | List publishing destinations |
| POST | `/api/projects/:projectId/destinations` | JWT | Add destination |
| PUT | `/api/destinations/:destinationId` | JWT | Update destination |
| DELETE | `/api/destinations/:destinationId` | JWT | Remove destination |
| GET | `/api/projects/:projectId/content-warnings` | JWT | List content warnings |
| POST | `/api/projects/:projectId/content-warnings` | JWT | Add content warning |
| DELETE | `/api/warnings/:warningId` | JWT | Remove content warning |
| GET | `/api/projects/:projectId/publish-snapshots` | JWT | List snapshots |
| POST | `/api/chapters/:chapterId/publish-snapshots` | JWT | Create snapshot |
| GET | `/api/projects/:projectId/chapters/:chapterId/snapshot/:snapshotId` | JWT | Get snapshot |
| POST | `/api/projects/:projectId/publish-check` | JWT | Validate for publishing |

### Reader (`reader.ts`) — Public

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/reader/projects` | Optional | Browse published projects |
| GET | `/api/reader/projects/:projectId` | Optional | Project details (published) |
| GET | `/api/reader/projects/:projectId/chapters` | Optional | Chapter list with access control |
| GET | `/api/reader/chapters/:chapterId` | Optional | Read chapter content |
| GET | `/api/reader/chapters/:chapterId/next` | Optional | Next chapter |
| POST | `/api/reader/chapters/:chapterId/view` | Optional | Record view |
| POST | `/api/reader/chapters/:chapterId/comments` | JWT | Post comment |
| GET | `/api/reader/chapters/:chapterId/comments` | Optional | Get comments |
| POST | `/api/reader/comments/:commentId/reactions` | JWT | React to comment |
| DELETE | `/api/reader/comments/:commentId` | JWT | Delete comment |
| GET | `/api/reader/entities` | Optional | Search published entities |

### Discover (`discover.ts`) — Public

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/discover/projects` | None | Browse/search published projects |
| GET | `/api/discover/trending` | None | Trending projects |
| GET | `/api/discover/recently-updated` | None | Recently updated projects |

### Subscriptions & Payments (`subscriptions.ts`, `stripe.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/:userId/subscriptions` | JWT (self) | User's subscriptions |
| POST | `/api/users/:userId/subscribe` | JWT | Subscribe (free tiers) |
| PUT | `/api/subscriptions/:subscriptionId` | JWT | Update subscription tier |
| DELETE | `/api/subscriptions/:subscriptionId` | JWT | Cancel subscription |
| GET | `/api/subscriptions/:subscriptionId/payments` | JWT | Payment history |
| GET | `/api/users/:userId/payments` | JWT (self) | All subscription payments |
| GET | `/api/authors/:authorId/subscribers` | JWT (author) | Author's subscribers |
| GET | `/api/authors/:authorId/discount-codes` | JWT (author) | Discount codes |
| POST | `/api/authors/:authorId/discount-codes` | JWT (author) | Create discount code |
| PUT | `/api/discount-codes/:codeId` | JWT (author) | Update discount code |
| DELETE | `/api/discount-codes/:codeId` | JWT (author) | Delete discount code |
| POST | `/api/discount-codes/validate` | None | Validate discount code |
| GET | `/api/users/:userId/access-grants` | JWT (self) | Access grants |
| POST | `/api/authors/:authorId/access-grants` | JWT (author) | Create access grant |
| DELETE | `/api/access-grants/:grantId` | JWT (author) | Revoke access grant |
| POST | `/api/authors/:authorId/subscription-tiers` | JWT (author) | Create tier |
| GET | `/api/subscription-tiers/:tierId` | JWT | Get tier details |
| PUT | `/api/subscription-tiers/:tierId` | JWT | Update tier |
| DELETE | `/api/subscription-tiers/:tierId` | JWT | Delete tier |
| GET | `/api/users/:userId/payment-config` | JWT (self) | Get Stripe config |
| PUT | `/api/users/:userId/payment-config` | JWT (self) | Update Stripe config |
| POST | `/api/stripe/webhook` | None | Stripe webhook |

### Membership & Badges (`membership.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/membership` | JWT | Current membership tier + badges |
| POST | `/api/membership/checkout` | JWT | Stripe Checkout for supporter upgrade |
| POST | `/api/membership/portal` | JWT | Stripe Customer Portal session |
| GET | `/api/users/:userId/badges` | None | Public user badges |

### Users (`users.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/by-email` | Internal | User lookup (NextAuth integration) |

### Project Follows (`project-follows.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/projects/:projectId/follow` | JWT | Follow project |
| DELETE | `/api/projects/:projectId/follow` | JWT | Unfollow project |
| PATCH | `/api/projects/:projectId/follow` | JWT | Mute/unmute follow |
| GET | `/api/projects/:projectId/follow-status` | Optional | Check follow status + count |
| GET | `/api/users/:userId/follows` | JWT (self) | List followed projects |

### Project Tags (`project-tags.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/projects/:projectId/tags` | JWT (owner) | List project tags |
| POST | `/api/projects/:projectId/tags` | JWT (owner) | Add tag |

### Notifications (`notifications.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/notifications` | JWT | Paginated notifications |
| GET | `/api/notifications/unread-count` | JWT | Unread count |
| PUT | `/api/notifications/:id/read` | JWT | Mark as read |
| PUT | `/api/notifications/read-all` | JWT | Mark all as read |

### Uploads (`uploads.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/uploads/presign` | JWT | Get presigned S3 PUT URL |
| POST | `/api/uploads/confirm` | JWT | Confirm upload + save metadata |
| POST | `/api/uploads/:id/report` | JWT | Flag for moderation |
| DELETE | `/api/uploads/:id` | JWT | Delete upload |
| GET | `/api/uploads` | JWT | List uploads |
| GET | `/api/images/:key` | None | Image proxy |

### Bobbin Actions (`bobbin-actions.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/bobbins/:bobbinId/actions/:actionId` | JWT | Invoke custom bobbin action |

### User Bobbins (`user-bobbins.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/me/bobbins` | JWT | List global-scoped bobbins |
| POST | `/api/users/me/bobbins/install` | JWT | Install global bobbin |
| DELETE | `/api/users/me/bobbins/:bobbinId` | JWT | Uninstall global bobbin |

### Google Drive (`google-drive.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/google-drive/auth-url` | JWT | Google OAuth URL |
| GET | `/api/google-drive/callback` | None | OAuth callback |
| GET | `/api/google-drive/sync/:projectId` | JWT | Sync status |
| POST | `/api/google-drive/sync/:projectId` | JWT | Start sync |
| DELETE | `/api/google-drive/disconnect/:projectId` | JWT | Disconnect |

### AI Tools (`ai-tools.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/ai-tools/providers` | JWT | List AI providers |
| PUT | `/api/ai-tools/config` | JWT | Update AI config |
| POST | `/api/ai-tools/test` | JWT | Test provider connection |
| POST | `/api/ai-tools/summarize` | JWT | Generate entity summary |
| POST | `/api/ai-tools/outline` | JWT | Generate chapter outline |
| POST | `/api/ai-tools/brainstorm` | JWT | Brainstorm ideas |
| GET | `/api/ai-tools/brainstorm` | JWT | Previous brainstorm results |
| POST | `/api/ai-tools/character-profile` | JWT | Generate character profile |
| POST | `/api/ai-tools/name-suggestions` | JWT | Generate name suggestions |

### API Keys (`api-keys.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/api-keys` | JWT only | Create API key |
| GET | `/api/api-keys` | JWT only | List API keys |
| DELETE | `/api/api-keys/:keyId` | JWT only | Revoke API key |

### Admin (`admin.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/stats` | Owner | Dashboard stats |
| GET | `/api/admin/users` | Owner | Paginated user list |
| POST | `/api/admin/users/:userId/badges` | Owner | Assign badge |
| POST | `/api/admin/users/:userId/supporter` | Owner | Grant/revoke supporter |
| DELETE | `/api/admin/users/:userId/badges/:badge` | Owner | Remove badge |

## Authentication

### JWT (Session)

Shell issues JWTs via NextAuth. Pass as `Authorization: Bearer <token>`.

### API Keys

Read-only keys for programmatic access. Created via `/api/api-keys` or the Settings UI.

```bash
curl -H "Authorization: Bearer bby_..." https://api.bobbinry.com/api/projects
```

**Scopes**: `projects:read`, `entities:read`, `stats:read`

**Rate limits**: 100 req/min (free), 500 req/min (supporter). Keyed per API key (vs per-IP for browser sessions).

### Internal

Server-to-server calls authenticated via `X-Bobbins-Secret` header.

## Database

- **ORM**: Drizzle with PostgreSQL
- **Schema**: `apps/api/src/db/schema.ts`
- **Migrations**: `infra/db/migrations/` — auto-run on startup via `runMigrations()`
- **Generate migration**: `cd apps/api && bunx drizzle-kit generate --name <name>`

## Deployment

- **Production**: Fly.io (`fly.toml`, `apps/api/Dockerfile`)
- **URL**: `https://api.bobbinry.com`
- **CI**: Push to main triggers GitHub CI (build/lint/typecheck) then Fly deploy
- **Local (minastirith)**: PM2 — `pm2 restart bobbins --update-env`
