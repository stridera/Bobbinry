# Publishing & Community Platform Implementation Plan

## Overview

This document outlines the complete implementation plan for adding publishing, monetization, and community features to Bobbinry. The system enables authors to publish their work with flexible access controls, subscription tiers, and integrations with external platforms.

## Core Features

### Author Monetization
- Define custom subscription tiers with pricing and benefits
- Tier-based early access with configurable delays
- Payment processing via Stripe and/or Patreon
- Beta reader/ARC reader special access lists
- Gift subscriptions and promotional discount codes

### Publishing Destinations
- **Google Drive**: Real-time sync to cloud folders
- **Dropbox**: Alternative cloud storage sync
- **Web Reader**: Native on-platform reading experience
- **Discord**: Webhook announcements for new chapters
- **Cross-posting**: Royal Road, Wattpad, Substack, AO3

### Reader Experience
- Public reader view with customizable fonts/themes
- Reading progress tracking and bookmarks
- Offline reading via PWA
- Comments and reactions per chapter
- Following authors and RSS feeds
- Email notifications for new chapters

### Content Management
- Draft/Published workflow states
- Scheduled releases with embargo dates
- Version history for published content
- Content warnings and tags
- Analytics dashboard (views, completion rates)
- Export formats: ePub, PDF, Markdown

---

## Database Schema

### User-Level Tables

#### `user_profiles`
Extended user information for public profiles and settings.

```typescript
{
  userId: uuid (PK, FK to users)
  username: string (unique, 50 chars)
  displayName: string (100 chars)
  bio: text
  avatarUrl: text
  websiteUrl: text
  twitterHandle: string (50 chars)
  discordHandle: string (100 chars)
  otherSocials: jsonb
  createdAt: timestamp
  updatedAt: timestamp
}
```

**User Settings**: Profile editor in `/settings/account`

---

#### `subscription_tiers`
Author-defined membership levels with pricing and benefits.

```typescript
{
  id: uuid (PK)
  authorId: uuid (FK to users)
  name: string (100 chars)
  description: text
  priceMonthly: string (decimal as string)
  priceYearly: string (decimal as string)
  benefits: jsonb (array of strings)
  chapterDelayDays: string (delay for new content)
  tierLevel: string (ordering: 1, 2, 3...)
  isActive: boolean
  createdAt: timestamp
  updatedAt: timestamp
}
```

**User Settings**: Subscription tier manager in `/settings/monetization`

**Usage**: 
- Free tier: chapterDelayDays = "0" for public content after X days
- Paid tiers: Lower delay for higher tiers (e.g., Tier 3 = 0 days, Tier 2 = 7 days, Tier 1 = 14 days)

---

#### `user_payment_config`
Payment provider integration credentials (encrypted).

```typescript
{
  userId: uuid (PK, FK to users)
  stripeAccountId: string (255 chars)
  stripeOnboardingComplete: boolean
  patreonAccessToken: text (encrypted)
  patreonRefreshToken: text (encrypted)
  patreonCampaignId: string (255 chars)
  paymentProvider: enum ('stripe', 'patreon', 'both')
  createdAt: timestamp
  updatedAt: timestamp
}
```

**User Settings**: Payment setup wizard in `/settings/monetization/payment`

**Security**: Tokens must be encrypted at rest using application-level encryption

---

#### `user_followers`
Following/follower relationships between users.

```typescript
{
  followerId: uuid (FK to users)
  followingId: uuid (FK to users)
  createdAt: timestamp
}
```

**UI**: Follow button on author profiles, followers list in `/profile/followers`

---

#### `user_notification_preferences`
Email and push notification settings per user.

```typescript
{
  userId: uuid (PK, FK to users)
  emailNewChapter: boolean (default: true)
  emailNewFollower: boolean (default: true)
  emailNewSubscriber: boolean (default: true)
  emailNewComment: boolean (default: true)
  emailDigestFrequency: enum ('instant', 'daily', 'weekly', 'never')
  pushNewChapter: boolean (default: false)
  pushNewComment: boolean (default: false)
  createdAt: timestamp
  updatedAt: timestamp
}
```

**User Settings**: Notification preferences in `/settings/notifications`

---

#### `user_reading_preferences`
Reader UI customization settings.

```typescript
{
  userId: uuid (PK, FK to users)
  fontSize: enum ('small', 'medium', 'large', 'xlarge')
  fontFamily: enum ('serif', 'sans-serif', 'monospace')
  lineHeight: enum ('compact', 'normal', 'relaxed')
  theme: enum ('light', 'dark', 'auto', 'sepia')
  readerWidth: enum ('narrow', 'standard', 'wide', 'full')
  createdAt: timestamp
  updatedAt: timestamp
}
```

**User Settings**: Reading preferences in `/settings/reading`

---

#### `beta_readers`
Special access grants for beta readers, ARC readers, early access.

```typescript
{
  id: uuid (PK)
  authorId: uuid (FK to users)
  readerId: uuid (FK to users)
  projectId: uuid (FK to projects, nullable - for project-specific access)
  accessLevel: enum ('beta', 'arc', 'early_access')
  notes: text
  isActive: boolean
  createdAt: timestamp
  updatedAt: timestamp
}
```

**User Settings**: Beta reader manager in `/settings/beta-readers`

**Usage**: Grants access regardless of subscription tier. Can be global per author or project-specific.

---

### Project-Level Tables

#### `project_publish_config`
Publishing configuration and access rules per project.

```typescript
{
  projectId: uuid (PK, FK to projects)
  publishingMode: enum ('draft', 'scheduled', 'live')
  defaultVisibility: enum ('public', 'subscribers_only', 'private')
  autoReleaseEnabled: boolean
  releaseFrequency: enum ('manual', 'daily', 'weekly', 'biweekly', 'monthly')
  releaseDay: string (e.g., 'Monday', 'Friday')
  releaseTime: string (HH:MM in UTC)
  slugPrefix: string (URL-friendly project identifier)
  seoDescription: text
  ogImageUrl: text
  enableComments: boolean
  enableReactions: boolean
  moderationMode: enum ('open', 'approval_required', 'disabled')
  createdAt: timestamp
  updatedAt: timestamp
}
```

**Project Settings**: Publishing dashboard in `/projects/:id/settings/publishing`

---

#### `project_destinations`
External publishing destinations (Drive, Dropbox, webhooks).

```typescript
{
  id: uuid (PK)
  projectId: uuid (FK to projects)
  type: enum ('google_drive', 'dropbox', 'onedrive', 'discord_webhook', 'custom_webhook')
  name: string (user-friendly label)
  config: jsonb (destination-specific configuration)
  isActive: boolean
  lastSyncedAt: timestamp
  lastSyncStatus: enum ('success', 'failed', 'pending')
  lastSyncError: text
  createdAt: timestamp
  updatedAt: timestamp
}
```

**Project Settings**: Destination manager in `/projects/:id/settings/destinations`

**Config Examples**:
- Google Drive: `{ folderId, accessToken, refreshToken }`
- Discord: `{ webhookUrl, mentionRoles, embedTemplate }`
- Custom Webhook: `{ url, method, headers, bodyTemplate }`

---

#### `content_warnings`
Tags and content warnings for discovery and filtering.

```typescript
{
  id: uuid (PK)
  projectId: uuid (FK to projects)
  warningType: enum ('violence', 'sexual_content', 'profanity', 'gore', 'trauma', 'custom')
  customLabel: string (for custom types)
  severity: enum ('mild', 'moderate', 'explicit')
  displayInSummary: boolean
  requireAgeGate: boolean
  createdAt: timestamp
}
```

**Project Settings**: Content warnings in `/projects/:id/settings/content`

---

#### `embargo_schedules`
Scheduled releases per chapter with tier-based delays.

```typescript
{
  id: uuid (PK)
  projectId: uuid (FK to projects)
  entityId: uuid (FK to entities - the chapter)
  publishMode: enum ('immediate', 'scheduled', 'tiered')
  baseReleaseDate: timestamp (when highest tier gets access)
  publicReleaseDate: timestamp (when it becomes fully public)
  tierSchedules: jsonb (array: [{ tierId, releaseDate }])
  isPublished: boolean
  createdAt: timestamp
  updatedAt: timestamp
}
```

**Project Settings**: Release scheduler in chapter editor or `/projects/:id/schedule`

**Tier Schedule Example**:
```json
{
  "baseReleaseDate": "2025-10-10T00:00:00Z",
  "tierSchedules": [
    { "tierId": "tier-3-uuid", "releaseDate": "2025-10-10T00:00:00Z" },
    { "tierId": "tier-2-uuid", "releaseDate": "2025-10-17T00:00:00Z" },
    { "tierId": "tier-1-uuid", "releaseDate": "2025-10-24T00:00:00Z" }
  ],
  "publicReleaseDate": "2025-10-31T00:00:00Z"
}
```

---

#### `publish_snapshots`
Version history of published content for rollback and auditing.

```typescript
{
  id: uuid (PK)
  projectId: uuid (FK to projects)
  entityId: uuid (FK to entities)
  versionNumber: integer
  snapshotData: jsonb (full entity data at time of publish)
  publishedBy: uuid (FK to users)
  publishedAt: timestamp
  notes: text
}
```

**UI**: Version history viewer in chapter editor sidebar

---

#### `export_configs`
Per-project export format preferences.

```typescript
{
  projectId: uuid (PK, FK to projects)
  epubEnabled: boolean
  epubCoverUrl: text
  epubMetadata: jsonb ({ author, publisher, isbn, language })
  pdfEnabled: boolean
  pdfTemplate: enum ('minimal', 'classic', 'modern')
  markdownEnabled: boolean
  htmlEnabled: boolean
  createdAt: timestamp
  updatedAt: timestamp
}
```

**Project Settings**: Export configuration in `/projects/:id/settings/export`

---

### Content & Engagement Tables

#### `chapter_publications`
Tracks publication state and metadata per chapter.

```typescript
{
  id: uuid (PK)
  projectId: uuid (FK to projects)
  chapterId: uuid (FK to entities)
  publishStatus: enum ('draft', 'scheduled', 'published', 'archived')
  publishedVersion: integer (links to publish_snapshots)
  firstPublishedAt: timestamp
  lastPublishedAt: timestamp
  viewCount: integer
  uniqueViewCount: integer
  completionCount: integer (readers who finished the chapter)
  avgReadTime: integer (seconds)
  createdAt: timestamp
  updatedAt: timestamp
}
```

**UI**: Publication status badge in chapter list, analytics in dashboard

---

#### `chapter_views`
Analytics and reading progress tracking.

```typescript
{
  id: uuid (PK)
  chapterId: uuid (FK to entities)
  readerId: uuid (FK to users, nullable for anonymous)
  sessionId: string (for anonymous tracking)
  startedAt: timestamp
  lastPositionPercent: integer (0-100)
  completedAt: timestamp (nullable)
  readTimeSeconds: integer
  deviceType: enum ('desktop', 'mobile', 'tablet')
  referrer: text
}
```

**Privacy**: Anonymous readers tracked by session ID, deleted after 90 days

---

#### `comments`
Per-chapter discussion with moderation.

```typescript
{
  id: uuid (PK)
  chapterId: uuid (FK to entities)
  authorId: uuid (FK to users)
  parentId: uuid (FK to comments, for nested replies)
  content: text
  moderationStatus: enum ('approved', 'pending', 'hidden', 'deleted')
  moderatedBy: uuid (FK to users, nullable)
  moderatedAt: timestamp
  likeCount: integer
  createdAt: timestamp
  updatedAt: timestamp
}
```

**UI**: Comment section at end of chapter reader view

---

#### `reactions`
Simple emoji reactions to chapters.

```typescript
{
  id: uuid (PK)
  chapterId: uuid (FK to entities)
  userId: uuid (FK to users)
  reactionType: enum ('heart', 'laugh', 'wow', 'sad', 'fire', 'clap')
  createdAt: timestamp
}
```

**UI**: Reaction bar at top of chapter, aggregated counts displayed

---

#### `author_notes`
Author commentary attached to chapters.

```typescript
{
  id: uuid (PK)
  chapterId: uuid (FK to entities)
  noteType: enum ('preface', 'postscript', 'content_warning')
  content: text
  displayOrder: integer
  isPublished: boolean
  createdAt: timestamp
  updatedAt: timestamp
}
```

**UI**: Notes displayed in reader view before/after chapter content

---

#### `content_tags`
Genre, theme, and metadata tags for discovery.

```typescript
{
  id: uuid (PK)
  projectId: uuid (FK to projects)
  tagCategory: enum ('genre', 'theme', 'trope', 'setting', 'custom')
  tagName: string
  createdAt: timestamp
}
```

**Project Settings**: Tag editor in `/projects/:id/settings/tags`

**Discovery**: Powers browse/filter UI and search

---

### Subscription & Access Tables

#### `subscriptions`
Active subscriptions linking readers to authors.

```typescript
{
  id: uuid (PK)
  subscriberId: uuid (FK to users)
  authorId: uuid (FK to users)
  tierId: uuid (FK to subscription_tiers)
  status: enum ('active', 'past_due', 'canceled', 'expired')
  currentPeriodStart: timestamp
  currentPeriodEnd: timestamp
  cancelAtPeriodEnd: boolean
  stripeSubscriptionId: string (nullable)
  patreonMemberId: string (nullable)
  createdAt: timestamp
  updatedAt: timestamp
}
```

**UI**: Subscriber list for authors in `/dashboard/subscribers`

**Stripe Integration**: Synced via webhooks on subscription events

---

#### `subscription_payments`
Payment history and transaction records.

```typescript
{
  id: uuid (PK)
  subscriptionId: uuid (FK to subscriptions)
  amount: string (decimal as string)
  currency: string (3-letter code)
  status: enum ('pending', 'succeeded', 'failed', 'refunded')
  stripePaymentIntentId: string (nullable)
  patreonChargeId: string (nullable)
  paidAt: timestamp
  refundedAt: timestamp
  failureReason: text
  createdAt: timestamp
}
```

**UI**: Transaction history in `/settings/billing`

---

#### `access_grants`
Special access overrides (gifts, comps, beta access).

```typescript
{
  id: uuid (PK)
  grantedTo: uuid (FK to users)
  authorId: uuid (FK to users)
  projectId: uuid (FK to projects, nullable - global if null)
  grantType: enum ('gift', 'comp', 'beta', 'promotional')
  expiresAt: timestamp (nullable for permanent)
  grantedBy: uuid (FK to users)
  reason: text
  isActive: boolean
  createdAt: timestamp
}
```

**User Settings**: Grant access in `/settings/access-grants`

---

#### `discount_codes`
Promotional codes with usage tracking.

```typescript
{
  id: uuid (PK)
  authorId: uuid (FK to users)
  code: string (unique)
  discountType: enum ('percent', 'fixed_amount', 'free_trial')
  discountValue: string
  maxUses: integer (nullable for unlimited)
  currentUses: integer
  expiresAt: timestamp (nullable)
  isActive: boolean
  createdAt: timestamp
  updatedAt: timestamp
}
```

**User Settings**: Discount code manager in `/settings/promotions`

---

## Bobbin Manifests

### `google-drive-publisher` Bobbin

```yaml
id: google-drive-publisher
name: Google Drive Publisher
version: 1.0.0
author: Bobbins Core
description: Sync chapters to Google Drive folders in real-time
tags: [publishing, integration, cloud-storage]
license: MIT

capabilities:
  publishable: true
  external: true  # Requires Drive API access
  ai: false
  customViews: false

execution:
  mode: sandboxed
  signature: dev_mode_skip

data:
  collections:
    - name: DriveConnection
      fields:
        - { name: folder_id, type: text, required: true }
        - { name: folder_name, type: text }
        - { name: access_token, type: text, required: true }  # Encrypted
        - { name: refresh_token, type: text, required: true }  # Encrypted
        - { name: token_expires_at, type: timestamp }
        - { name: is_active, type: boolean }
        
    - name: SyncLog
      fields:
        - { name: chapter_id, type: text, required: true }
        - { name: drive_file_id, type: text }
        - { name: sync_status, type: text }  # success, failed, pending
        - { name: synced_at, type: timestamp }
        - { name: error_message, type: text }

ui:
  views:
    - id: drive-settings
      name: Drive Settings
      type: form
      source: DriveConnection
      
interactions:
  triggers:
    - id: on_chapter_update
      event: update
      target: Chapter  # From manuscript bobbin
      actions:
        - sync_to_drive
        
  actions:
    - id: sync_to_drive
      name: Sync to Drive
      type: custom
      handler: syncChapterToDrive

external:
  apis:
    - domain: googleapis.com
      endpoints:
        - /drive/v3/files
      rateLimits:
        requests_per_minute: 100
```

---

### `web-publisher` Bobbin

```yaml
id: web-publisher
name: Web Publisher
version: 1.0.0
author: Bobbins Core
description: Native on-platform reader with subscriptions and analytics
tags: [publishing, reader, monetization]
license: MIT

capabilities:
  publishable: true
  external: false
  ai: false
  customViews: true

execution:
  mode: native
  signature: dev_mode_skip

data:
  collections:
    - name: PublishedChapter
      fields:
        - { name: chapter_id, type: text, required: true }
        - { name: slug, type: text, required: true, unique: true }
        - { name: published_version, type: number }
        - { name: is_published, type: boolean }
        - { name: published_at, type: timestamp }
        
    - name: ReaderProgress
      fields:
        - { name: reader_id, type: text, required: true }
        - { name: chapter_id, type: text, required: true }
        - { name: position_percent, type: number }
        - { name: completed, type: boolean }
        - { name: last_read_at, type: timestamp }
        
    - name: AccessPolicy
      fields:
        - { name: chapter_id, type: text, required: true }
        - { name: access_level, type: text }  # public, subscribers, tier_3, tier_2, tier_1
        - { name: embargo_until, type: timestamp }

ui:
  views:
    - id: reader
      name: Reader
      type: custom
      source: PublishedChapter
      template: reader
      
    - id: analytics-dashboard
      name: Analytics
      type: dashboard
      source: PublishedChapter
      widgets:
        - view_count_chart
        - completion_rate
        - subscriber_growth
        
    - id: subscription-manager
      name: Subscriptions
      type: table
      source: subscription_tiers  # From core schema

interactions:
  actions:
    - id: publish_chapter
      name: Publish Chapter
      type: custom
      target: Chapter
      
    - id: schedule_release
      name: Schedule Release
      type: custom
      target: Chapter
```

---

### Extended `manuscript` Bobbin

Add these fields to the existing Chapter collection:

```yaml
# Add to Chapter fields:
- { name: publish_status, type: text }  # draft, scheduled, published, archived
- { name: published_at, type: timestamp }
- { name: embargo_until, type: timestamp }
- { name: version_number, type: number }
- { name: slug, type: text, unique: true }
- { name: seo_description, type: text }
- { name: content_warnings, type: json }  # Array of warning IDs
```

---

## API Routes

### User Management

#### `POST /api/users/:userId/profile`
Update user profile information.

**Request Body**:
```json
{
  "username": "janeauthor",
  "displayName": "Jane Author",
  "bio": "Fantasy writer...",
  "avatarUrl": "https://...",
  "socialLinks": { ... }
}
```

**Response**: Updated profile object

---

#### `GET /api/users/:userId/subscription-tiers`
List all tiers for an author.

**Response**:
```json
{
  "tiers": [
    {
      "id": "uuid",
      "name": "Bronze",
      "priceMonthly": "3.00",
      "chapterDelayDays": "14",
      ...
    }
  ]
}
```

---

#### `POST /api/users/:userId/subscription-tiers`
Create a new subscription tier.

**Request Body**:
```json
{
  "name": "Gold Tier",
  "description": "Immediate access to all chapters",
  "priceMonthly": "10.00",
  "chapterDelayDays": "0",
  "benefits": ["Early access", "Discord role", "Monthly Q&A"]
}
```

---

#### `POST /api/users/:userId/payment/stripe`
Connect Stripe account.

**Request Body**:
```json
{
  "authorizationCode": "ac_xxx"
}
```

**Flow**: OAuth with Stripe Connect

---

#### `POST /api/users/:userId/follow`
Follow another user.

**Request Body**:
```json
{
  "followingId": "author-uuid"
}
```

---

### Project Publishing

#### `PUT /api/projects/:projectId/publish-config`
Update project publishing configuration.

**Request Body**:
```json
{
  "publishingMode": "live",
  "autoReleaseEnabled": true,
  "releaseFrequency": "weekly",
  "releaseDay": "Friday",
  "enableComments": true
}
```

---

#### `POST /api/projects/:projectId/destinations`
Add publishing destination.

**Request Body**:
```json
{
  "type": "google_drive",
  "name": "My Drive Backup",
  "config": {
    "folderId": "1ABC...",
    "accessToken": "ya29...",
    "refreshToken": "1//..."
  }
}
```

---

#### `POST /api/projects/:projectId/chapters/:chapterId/publish`
Publish a chapter immediately or schedule.

**Request Body**:
```json
{
  "mode": "scheduled",
  "baseReleaseDate": "2025-10-15T00:00:00Z",
  "tierSchedules": [
    { "tierId": "uuid", "delayDays": 0 },
    { "tierId": "uuid", "delayDays": 7 }
  ]
}
```

---

#### `GET /api/projects/:projectId/analytics`
Get project-level analytics.

**Query Params**: `?startDate=2025-01-01&endDate=2025-10-05`

**Response**:
```json
{
  "totalViews": 15000,
  "uniqueReaders": 3200,
  "avgCompletionRate": 0.78,
  "subscriberCount": 450,
  "chartData": { ... }
}
```

---

### Content Access

#### `GET /api/read/:authorUsername/:projectSlug/:chapterSlug`
Public reader endpoint.

**Headers**: `Authorization: Bearer <jwt>` (optional for logged-in users)

**Response**:
```json
{
  "chapter": {
    "title": "Chapter 1",
    "body": "...",
    "publishedAt": "..."
  },
  "hasAccess": true,
  "accessReason": "subscriber_tier_3",
  "nextChapter": { "slug": "chapter-2" }
}
```

**Access Control**: Check subscription tier, beta reader status, embargo dates

---

#### `POST /api/chapters/:chapterId/comments`
Add a comment to a chapter.

**Request Body**:
```json
{
  "content": "Great chapter!",
  "parentId": "uuid-if-reply"
}
```

---

#### `POST /api/chapters/:chapterId/reactions`
React to a chapter.

**Request Body**:
```json
{
  "reactionType": "heart"
}
```

---

#### `GET /api/chapters/:chapterId/export`
Generate export file.

**Query Params**: `?format=epub` or `pdf` or `markdown`

**Response**: File download or job ID for async generation

---

### Subscription Operations

#### `POST /api/subscribe/:authorId`
Create a subscription.

**Request Body**:
```json
{
  "tierId": "uuid",
  "paymentMethodId": "pm_xxx"  // Stripe payment method
}
```

**Flow**: Creates Stripe subscription, records in database

---

#### `POST /api/stripe/webhook`
Stripe webhook handler.

**Events**:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

**Security**: Verify webhook signature

---

#### `POST /api/gift/:authorId`
Gift a subscription.

**Request Body**:
```json
{
  "recipientEmail": "reader@example.com",
  "tierId": "uuid",
  "durationMonths": 3
}
```

---

#### `POST /api/redeem/:code`
Redeem discount code.

**Request Body**:
```json
{
  "code": "WELCOME2025"
}
```

**Response**: Applied discount details

---

## UI Components

### User Settings (`/settings/*`)

1. **Profile Editor** (`/settings/profile`)
   - Form fields: username, display name, bio, avatar upload
   - Social links: Twitter, Discord, website
   - Preview card showing public profile

2. **Monetization Setup** (`/settings/monetization`)
   - Stripe Connect onboarding flow
   - Patreon OAuth connection
   - Current earnings dashboard
   - Payout history

3. **Subscription Tier Manager** (`/settings/tiers`)
   - List of tiers with edit/delete
   - Create tier modal: name, price, benefits, delay
   - Drag-to-reorder tier levels
   - Preview subscriber view

4. **Beta Reader Manager** (`/settings/beta-readers`)
   - Add by email or user search
   - Per-project or global access toggle
   - Access level dropdown (beta, ARC, early)
   - Notes field for tracking

5. **Notification Center** (`/settings/notifications`)
   - Toggle switches for each notification type
   - Email digest frequency selector
   - Push notification opt-in (with browser permission)
   - Test notification button

6. **Reading Preferences** (`/settings/reading`)
   - Live preview panel
   - Font size slider
   - Font family dropdown
   - Line height selector
   - Theme picker (light, dark, sepia, auto)
   - Reader width selector

---

### Project Settings (`/projects/:id/settings/*`)

1. **Publishing Dashboard** (`/projects/:id/settings/publishing`)
   - Publishing mode toggle (draft/scheduled/live)
   - Default visibility selector
   - Auto-release scheduler
   - SEO metadata: description, OG image
   - Comment/reaction toggles

2. **Destination Manager** (`/projects/:id/settings/destinations`)
   - Cards for each destination type
   - "Connect Google Drive" button → OAuth flow
   - Sync status indicators
   - Manual sync trigger buttons
   - Destination-specific settings

3. **Access Rules Builder** (`/projects/:id/settings/access`)
   - Matrix view: Chapters (rows) × Tiers (columns)
   - Click cells to set access level
   - Bulk actions: "Make all public", "Tier 3 only"
   - Per-chapter embargo date picker

4. **Content Tagging** (`/projects/:id/settings/content`)
   - Content warning checkboxes
   - Custom warning input
   - Genre/theme tag selector (autocomplete)
   - Age gate toggle
   - Display options

5. **Analytics Dashboard** (`/projects/:id/analytics`)
   - Date range selector
   - KPI cards: Total views, Unique readers, Avg. completion
   - Line chart: Views over time
   - Table: Top chapters by views
   - Subscriber growth chart
   - Geographic distribution map

6. **Comment Moderation** (`/projects/:id/moderation`)
   - Queue of pending comments
   - Approve/hide/delete actions
   - Bulk moderation
   - Commenter profiles with history
   - Auto-moderation rules

---

### Public Reader App (`apps/reader`)

New package for public-facing reader experience.

**Routes**:
- `/read/:username/:project/:chapter` - Main reader view
- `/read/:username/:project` - Project landing page
- `/read/:username` - Author profile page

**Reader View Components**:

1. **ReaderLayout**
   - Top nav: Author name, project title, chapter navigation
   - Side panel: Chapter list (collapsible)
   - Bottom: Comment section
   - Floating: Reading progress bar, scroll-to-top

2. **ChapterReader**
   - Markdown/HTML rendering with TipTap viewer
   - Inline footnotes
   - Image lightbox
   - Author notes sections
   - Reaction bar at top
   - Reading time estimate

3. **PaywallModal**
   - Triggered when chapter is locked
   - Shows tier comparison table
   - "Subscribe Now" CTA
   - "Sign in" option if not logged in
   - Preview of first N paragraphs

4. **CommentSection**
   - Threaded comments
   - Reply/like/flag actions
   - Sort: Newest, Oldest, Top
   - Load more pagination
   - Moderation status indicators

5. **ReaderSettings**
   - Floating gear icon
   - Font/theme controls
   - Reading width slider
   - Bookmark current position
   - Report issue link

---

## Implementation Phases

### Phase 1: Database Foundation (Week 1-2)
- [ ] Add all schema tables to `apps/api/src/db/schema.ts`
- [ ] Generate Drizzle migrations
- [ ] Test migrations on local Postgres
- [ ] Add TypeScript types and Zod schemas
- [ ] Document schema in this file

### Phase 2: User Backend (Week 3-4)
- [ ] User profile CRUD routes
- [ ] Subscription tier CRUD routes
- [ ] Follower system routes
- [ ] Notification preference routes
- [ ] Reading preference routes
- [ ] Beta reader management routes

### Phase 3: Payment Integration (Week 5-6)
- [ ] Stripe Connect onboarding flow
- [ ] Create subscription endpoint
- [ ] Stripe webhook handler
- [ ] Subscription status sync
- [ ] Payment history tracking
- [ ] Discount code system

### Phase 4: Project Publishing Backend (Week 7-8)
- [ ] Publish config CRUD routes
- [ ] Chapter publication workflow
- [ ] Embargo scheduling system
- [ ] Access control middleware
- [ ] Version snapshot system
- [ ] Analytics data collection

### Phase 5: Google Drive Bobbin (Week 9-10)
- [ ] Create bobbin manifest
- [ ] OAuth flow for Drive
- [ ] Chapter sync handler
- [ ] Conflict resolution
- [ ] Sync status UI
- [ ] Error handling and retries

### Phase 6: Web Publisher Bobbin (Week 11-12)
- [ ] Create bobbin manifest
- [ ] Public reader view
- [ ] Access control checks
- [ ] Reading progress tracking
- [ ] Paywall implementation
- [ ] Analytics integration

### Phase 7: Engagement Features (Week 13-14)
- [ ] Comment system backend
- [ ] Reaction system backend
- [ ] Author notes backend
- [ ] Comment moderation UI
- [ ] Notification system
- [ ] Email templates

### Phase 8: Export Formats (Week 15-16)
- [ ] ePub generator
- [ ] PDF generator
- [ ] Markdown export
- [ ] AO3-compatible HTML
- [ ] Export queue system
- [ ] Download management

### Phase 9: Discovery & Community (Week 17-18)
- [ ] Browse page with filters
- [ ] Full-text search
- [ ] Author directory
- [ ] Recommendation algorithm
- [ ] Following feed
- [ ] RSS feed generation

### Phase 10: User Settings UI (Week 19-20)
- [ ] Profile editor component
- [ ] Tier manager component
- [ ] Payment setup wizard
- [ ] Beta reader manager
- [ ] Notification preferences
- [ ] Reading preferences

### Phase 11: Additional Integrations (Week 21-22)
- [ ] Dropbox publisher bobbin
- [ ] Discord webhook bobbin
- [ ] Patreon integration
- [ ] Royal Road cross-post
- [ ] Wattpad export
- [ ] Substack integration

### Phase 12: Polish & Security (Week 23-24)
- [ ] Security audit
- [ ] Rate limiting
- [ ] Anti-scraping measures
- [ ] GDPR compliance
- [ ] Performance optimization
- [ ] Load testing
- [ ] Documentation
- [ ] Tutorial videos

---

## User vs Project Configuration

### User Settings (`/settings/*`)
Configuration that applies globally to the user across all their projects.

- **Profile**: Bio, avatar, social links → `user_profiles`
- **Subscription Tiers**: Pricing, benefits, delays → `subscription_tiers`
- **Payment**: Stripe/Patreon credentials → `user_payment_config`
- **Beta Readers**: Special access grants → `beta_readers`
- **Notifications**: Email/push preferences → `user_notification_preferences`
- **Reading**: Font, theme, width → `user_reading_preferences`
- **Followers**: Following list → `user_followers`
- **Billing**: Earnings, payouts → (Stripe Dashboard)

### Project Settings (`/projects/:id/settings/*`)
Configuration specific to a single writing project.

- **Publishing Mode**: Draft/live state → `project_publish_config`
- **Access Rules**: Per-chapter tier access → `embargo_schedules`
- **Destinations**: Drive, Dropbox, webhooks → `project_destinations`
- **Content Warnings**: Tags and filters → `content_warnings`
- **Comments**: Enable/moderation → `project_publish_config.moderationMode`
- **Export**: ePub/PDF settings → `export_configs`
- **SEO**: Description, OG image → `project_publish_config`
- **Tags**: Genre, themes → `content_tags`
- **Analytics**: View tracking → `chapter_views`, `chapter_publications`

---

## Security Considerations

### Token Encryption
- All OAuth tokens (Drive, Dropbox, Patreon) must be encrypted at rest
- Use application-level encryption with key rotation
- Never expose tokens in API responses
- Consider using a secrets manager (AWS Secrets Manager, HashiCorp Vault)

### Payment Security
- Never store full credit card numbers
- Use Stripe's tokenization
- Verify webhook signatures
- Rate limit payment endpoints
- Log all payment events for audit

### Content Protection
- Rate limit public reader endpoints (10 req/min per IP)
- Implement CAPTCHA for anonymous access
- Add invisible watermarks to exports (optional)
- DMCA takedown workflow
- Report abuse functionality

### Privacy
- Anonymous view tracking: Session ID only, purge after 90 days
- GDPR data export: Include all user data in downloadable format
- Right to be forgotten: Cascade delete all user data
- Content warning age gates: Verify age with birthday or credit card
- Reading history: User can opt out of tracking

---

## Performance Optimization

### Caching Strategy
- CDN for public reader content (Cloudflare)
- Redis for view counts (batch write to DB every 5 min)
- Edge caching for published chapters (invalidate on update)
- Browser caching for static assets (long TTL)

### Database Optimization
- Indexes on frequently queried fields (already in schema)
- Partition `chapter_views` by month
- Archive old analytics data to cold storage
- Connection pooling (Drizzle default)

### Async Processing
- Export generation: Queue with Bull/BullMQ
- Email notifications: Batch and queue
- Webhook deliveries: Retry with exponential backoff
- Analytics aggregation: Cron job nightly

---

## Testing Strategy

### Unit Tests
- Payment calculations (tier pricing, discounts)
- Access control logic (embargo dates, tier checks)
- Export generators (ePub, PDF validation)
- Webhook signature verification

### Integration Tests
- Stripe webhook flow (mocked)
- OAuth flows (Drive, Patreon)
- Chapter publication workflow
- Subscription lifecycle

### E2E Tests
- User signs up, subscribes, reads chapter
- Author creates tier, publishes chapter
- Beta reader gets early access
- Comment moderation flow

---

## Monitoring & Alerts

### Key Metrics
- Payment success rate
- Webhook processing time
- Reader view latency
- Export generation time
- Email delivery rate

### Alerts
- Failed payments (> 5% failure rate)
- Webhook errors (> 1% error rate)
- Reader 500 errors (> 0.1%)
- Export queue backlog (> 100 jobs)
- Stripe API downtime

---

## Future Enhancements

### Phase 2 Features (Post-MVP)
- Mobile apps (React Native)
- Audiobook integration
- Translation/localization
- Collaborative writing
- AI writing assistant
- Advanced analytics (funnel, cohorts)
- Referral program
- Merchandise integration
- Live reading events
- Author interviews/podcasts

### Integrations
- Goodreads sync
- BookBub ads
- Amazon KDP export
- Kobo Writing Life
- Draft2Digital
- IngramSpark

---

## Success Metrics

### Author Adoption
- % of users who create subscription tiers
- % of projects with published chapters
- Avg. subscribers per author
- Avg. monthly earnings

### Reader Engagement
- Avg. chapters read per session
- Comment rate (comments per 100 views)
- Subscription conversion rate
- Subscriber retention rate

### Platform Health
- Uptime (target: 99.9%)
- Reader latency (target: < 500ms p95)
- Payment success rate (target: > 98%)
- Email delivery rate (target: > 99%)

---

## Conclusion

This plan provides a comprehensive roadmap for implementing publishing, monetization, and community features in Bobbinry. The phased approach ensures we build a solid foundation before adding advanced features.

**Next Steps**:
1. Review and approve this plan
2. Begin Phase 1: Database schema implementation
3. Set up project tracking (GitHub Projects or similar)
4. Assign tasks and timeline
5. Begin weekly progress reviews

**Estimated Timeline**: 24 weeks for full implementation
**Team Size**: 2-3 developers recommended
**MVP Scope**: Phases 1-6 (12 weeks) for core publishing functionality
