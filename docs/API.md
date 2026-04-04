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

## Authentication

### JWT (Session)

Shell issues JWTs via NextAuth. Pass as `Authorization: Bearer <token>`.

### API Keys

Read-only keys for programmatic access. Created via `/api/api-keys` or the Settings UI.

```bash
curl -H "Authorization: Bearer bby_..." https://api.bobbinry.com/api/projects
```

**Scopes**: `projects:read`, `entities:read`, `stats:read`, `profile:read`

**Rate limits**: 100 req/min (free), 500 req/min (supporter). Keyed per API key (vs per-IP for browser sessions).

### Internal

Server-to-server calls authenticated via `X-Bobbins-Secret` header.

## API Endpoints

All routes are prefixed with `/api` unless noted. Authentication is JWT-based (session) or API key (`bby_` prefix, read-only).

### Health & Internal

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check with DB connectivity |
| GET | `/internal/metrics` | Internal | Metrics snapshot (requires `X-Bobbins-Secret`) |

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

**Query parameters** for `GET /api/collections/:collection/entities`:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `projectId` | UUID | required | Filter by project |
| `limit` | number | 50 | Results per page (1–5000) |
| `offset` | number | 0 | Pagination offset |
| `search` | string | — | Full-text search across title, name, and entity data |
| `filters` | JSON string | — | Field-level filters against entity data, e.g. `{"status":"draft"}` |

**Entity response shape**: Entity data fields are spread at the top level, with metadata in a `_meta` envelope:

```json
{
  "id": "b95eb059-...",
  "title": "Chapter 1 - The Anomaly",
  "body": "<p>...</p>",
  "status": "draft",
  "wordCount": 2431,
  "order": 100,
  "_meta": {
    "bobbinId": "manuscript",
    "collection": "content",
    "scope": "project",
    "version": 23,
    "createdAt": "2026-03-10T08:30:42.968Z",
    "updatedAt": "2026-03-21T20:53:31.780Z"
  }
}
```

**Common collection names**: `content` (chapters/scenes), `containers` (folders/parts), `characters`, `locations`, `items`, `lore`, `entity_type_definitions` (custom types).

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

#### Chapter Publication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/projects/:projectId/chapters/:chapterId/publish` | JWT (verified) | Publish or schedule chapter |
| POST | `/api/projects/:projectId/chapters/:chapterId/unpublish` | JWT | Revert chapter to draft |
| POST | `/api/projects/:projectId/chapters/:chapterId/complete` | JWT | Mark chapter complete (auto-schedules if configured) |
| POST | `/api/projects/:projectId/chapters/:chapterId/revert-to-draft` | JWT | Revert complete chapter to draft |
| GET | `/api/projects/:projectId/chapters/:chapterId/publication` | JWT | Get publication record and status |
| GET | `/api/projects/:projectId/chapters/:chapterId/next-release-slot` | JWT | Next available auto-release slot |
| GET | `/api/projects/:projectId/publications` | JWT | List all chapter publications (`?status=draft,published,scheduled,complete,archived`) |

#### Publish Configuration

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/projects/:projectId/publish-config` | JWT | Get publish configuration |
| PUT | `/api/projects/:projectId/publish-config` | JWT (verified) | Update publish config (visibility, auto-release, moderation) |

#### Embargoes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/projects/:projectId/embargoes` | JWT | Create embargo schedule with tier-based release dates |
| GET | `/api/projects/:projectId/chapters/:chapterId/embargo` | JWT | Get chapter embargo schedule |
| PUT | `/api/embargoes/:embargoId` | JWT | Update embargo |
| DELETE | `/api/embargoes/:embargoId` | JWT | Delete embargo |

#### Destinations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/projects/:projectId/destinations` | JWT | List publishing destinations |
| POST | `/api/projects/:projectId/destinations` | JWT | Add destination |
| PUT | `/api/destinations/:destinationId` | JWT | Update destination |
| DELETE | `/api/destinations/:destinationId` | JWT | Remove destination |
| POST | `/api/destinations/:destinationId/sync` | JWT | Record sync result |

#### Content Warnings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/projects/:projectId/content-warnings` | JWT | List content warnings |
| POST | `/api/projects/:projectId/content-warnings` | JWT | Add content warning |
| DELETE | `/api/content-warnings/:warningId` | JWT | Remove content warning |

#### Analytics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/chapters/:chapterId/views` | JWT | Record chapter view |
| PUT | `/api/chapter-views/:viewId/progress` | JWT | Update reading progress |
| GET | `/api/projects/:projectId/chapters/:chapterId/analytics` | JWT | Chapter analytics (views, completions, read time) |
| GET | `/api/projects/:projectId/chapters/:chapterId/analytics/breakdown` | JWT | Detailed breakdown by device, progress, referrers |
| GET | `/api/projects/:projectId/analytics/chapters` | JWT | Cross-chapter analytics for project |
| GET | `/api/projects/:projectId/analytics` | JWT | Project-level analytics summary |

#### Snapshots (Version History)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/projects/:projectId/chapters/:chapterId/snapshots` | JWT | List publication snapshots |
| GET | `/api/projects/:projectId/snapshots/:snapshotId` | JWT | Get snapshot content |

#### Access Control

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/projects/:projectId/chapters/:chapterId/access` | JWT | Check chapter access (subscriptions, beta readers, embargoes) |

### Export (`export.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/projects/:projectId/export/:format` | JWT | Export project (`pdf`, `epub`, `markdown`, `txt`; `?mode=full\|chapters`) |

### Public Reader (`reader.ts`)

Public-facing endpoints for reading published content. No authentication required unless noted.

#### Content

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/public/projects/:projectId/toc` | None | Table of contents for a published project |
| GET | `/api/public/projects/:projectId/chapters/:chapterId` | None | Read a published chapter |
| POST | `/api/public/projects/:projectId/chapters/:chapterId/view` | None | Record a view event |

#### Stats & Metadata

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/public/projects/:projectId/stats` | None | Public aggregate stats (views, chapters) |
| GET | `/api/public/projects/:projectId/metadata` | None | Project SEO metadata |
| GET | `/api/public/projects/:projectId/chapters/:chapterId/metadata` | None | Chapter SEO metadata |

#### SEO & Feeds

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/public/projects/:projectId/sitemap.xml` | None | XML sitemap |
| GET | `/api/public/projects/:projectId/feed.xml` | None | RSS feed |

#### Slug Lookups

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/public/projects/by-slug/:slug` | None | Resolve project by short URL slug |
| POST | `/api/public/projects/by-slugs` | None | Batch resolve multiple slugs |
| GET | `/api/public/projects/by-author-and-slug/:username/:projectSlug` | None | Resolve by author + project slug |
| GET | `/api/public/authors/:username/projects` | None | List an author's published projects |

#### Comments & Reactions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/public/chapters/:chapterId/comments` | None | Get chapter comments |
| POST | `/api/public/chapters/:chapterId/comments` | JWT | Post a comment |
| GET | `/api/public/chapters/:chapterId/reactions` | None | Get chapter reactions |
| POST | `/api/public/chapters/:chapterId/reactions` | JWT | Add or toggle reaction |
| DELETE | `/api/public/chapters/:chapterId/reactions/:reactionType` | JWT | Remove reaction |

### Discover (`discover.ts`)

Public endpoints for browsing published content. No authentication required.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/discover/projects` | None | Browse/search published projects |
| GET | `/api/discover/authors` | None | Browse/search authors |
| GET | `/api/discover/tags` | None | List popular tags |

**Query parameters** for `GET /api/discover/projects`:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | — | Search project name and description |
| `genre` | string | — | Filter by genre tag |
| `sort` | string | `recent` | Sort order: `recent`, `popular`, `trending` |
| `limit` | number | 20 | Results per page (1–50) |
| `offset` | number | 0 | Pagination offset |

**Query parameters** for `GET /api/discover/authors`:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | — | Search author name/username |
| `sort` | string | `popular` | Sort: `popular`, `recent`, `alphabetical` |
| `limit` | number | 20 | Results per page |
| `offset` | number | 0 | Pagination offset |

**Query parameters** for `GET /api/discover/tags`:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `category` | string | — | Filter by tag category |
| `limit` | number | 50 | Max tags to return |

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

#### Profiles

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/:userId/profile` | None | Public user profile |
| GET | `/api/users/profiles/batch` | None | Batch resolve profiles (`?userIds=id1,id2`, max 100) |
| PUT | `/api/users/:userId/profile` | JWT (self) | Update own profile |
| GET | `/api/users/by-username/:username` | None | Lookup by username (with follower counts) |
| GET | `/api/users/:userId/published-projects` | None | User's published projects |

#### Followers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/:userId/followers` | None | Followers or following list (`?type=followers\|following`) |
| POST | `/api/users/:userId/follow` | JWT (self) | Follow a user |
| DELETE | `/api/users/:userId/follow/:followingId` | JWT (self) | Unfollow a user |
| GET | `/api/users/:userId/is-following/:targetId` | None | Check if following |

#### Subscription Tiers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/:userId/subscription-tiers` | None | List author's tiers |
| POST | `/api/users/:userId/subscription-tiers` | JWT (self) | Create tier |
| PUT | `/api/users/:userId/subscription-tiers/:tierId` | JWT (self) | Update tier |
| DELETE | `/api/users/:userId/subscription-tiers/:tierId` | JWT (self) | Delete tier |

#### Preferences

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/:userId/notification-preferences` | JWT (self) | Get notification preferences |
| PUT | `/api/users/:userId/notification-preferences` | JWT (self) | Update notification preferences |
| GET | `/api/users/:userId/reading-preferences` | JWT (self) | Get reading preferences |
| PUT | `/api/users/:userId/reading-preferences` | JWT (self) | Update reading preferences |

#### Beta Readers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/:userId/beta-readers` | JWT (self) | List beta readers (`?projectId=` optional) |
| POST | `/api/users/:userId/beta-readers` | JWT (self) | Add beta reader |
| PUT | `/api/users/:userId/beta-readers/:betaReaderId` | JWT (self) | Update beta reader |
| DELETE | `/api/users/:userId/beta-readers/:betaReaderId` | JWT (self) | Remove beta reader |

#### Reader Bobbins

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/:userId/reader-bobbins` | JWT (self) | List reader bobbins |
| POST | `/api/users/:userId/reader-bobbins` | JWT (self) | Install reader bobbin |
| PUT | `/api/users/:userId/reader-bobbins/:bobbinInstallId` | JWT (self) | Update reader bobbin config |
| DELETE | `/api/users/:userId/reader-bobbins/:bobbinInstallId` | JWT (self) | Uninstall reader bobbin |

#### Feed & Reading Progress

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/:userId/feed` | JWT (self) | Recent publications from followed authors |
| GET | `/api/users/:userId/reading-progress` | JWT (self) | In-progress reading |

#### Email Unsubscribe

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/unsubscribe` | None (token) | One-click unsubscribe (RFC 8058) |
| GET | `/api/unsubscribe` | None (token) | Unsubscribe confirmation page |

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

### Backups (`google-drive.ts`)

Google Drive backup integration for syncing project content to Drive.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/backups/google-drive/authorize` | JWT | Google OAuth consent URL |
| GET | `/api/backups/google-drive/callback` | None | OAuth callback (exchanges code for tokens) |
| GET | `/api/backups/status` | JWT | Backup connection status + all project backup states |
| DELETE | `/api/backups/google-drive/disconnect` | JWT | Disconnect Google Drive |
| POST | `/api/backups/projects/:projectId/sync` | JWT | Sync single project to Drive |
| PUT | `/api/backups/projects/:projectId` | JWT | Toggle backup opt-in/out for project |
| POST | `/api/backups/sync` | JWT | Sync all opted-in projects |

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

**Key limits**: 5 keys (free), 10 keys (supporter). Keys expire if `expiresInDays` is set at creation.

### Admin (`admin.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/stats` | Owner | Dashboard stats |
| GET | `/api/admin/users` | Owner | Paginated user list |
| POST | `/api/admin/users/:userId/badges` | Owner | Assign badge |
| POST | `/api/admin/users/:userId/supporter` | Owner | Grant/revoke supporter |
| DELETE | `/api/admin/users/:userId/badges/:badge` | Owner | Remove badge |

## Quick Reference for API Consumers

### List projects (API key)

```bash
curl -H "Authorization: Bearer bby_..." \
  https://api.bobbinry.com/api/projects
```

### Get dashboard stats

```bash
curl -H "Authorization: Bearer bby_..." \
  https://api.bobbinry.com/api/dashboard/stats
```

Returns: `{"stats":{"projects":{"total":"4","active":"4","archived":"0"},"collections":{"total":"1"},"entities":{"total":"28"},"trashed":{"total":"0"}}}`

### Query entities with search

```bash
curl -H "Authorization: Bearer bby_..." \
  "https://api.bobbinry.com/api/collections/content/entities?projectId=<UUID>&search=chapter&limit=10"
```

### Browse published projects (no auth)

```bash
curl "https://api.bobbinry.com/api/discover/projects?sort=trending&limit=5"
```

### Read a published chapter (no auth)

```bash
# Resolve by slug first
curl "https://api.bobbinry.com/api/public/projects/by-slug/quantum-error"

# Then read TOC
curl "https://api.bobbinry.com/api/public/projects/<projectId>/toc"

# Then read a chapter
curl "https://api.bobbinry.com/api/public/projects/<projectId>/chapters/<chapterId>"
```

### Rate limits

Responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers. When exceeded, returns `429` with `Retry-After`.

### Error format

```json
{
  "error": "Short error type",
  "message": "Human-readable description"
}
```

### Read-only API keys

API keys only support GET/HEAD/OPTIONS. Write operations return:

```json
{"error": "Read-only access", "message": "API keys only support read operations"}
```

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
