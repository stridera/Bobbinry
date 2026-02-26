import { pgTable, uuid, text, timestamp, jsonb, boolean, varchar, integer, bigint, decimal, index } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// Users table - authentication and user management
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordHash: text('password_hash'),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// User profiles - extended user information
export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).primaryKey(),
  username: varchar('username', { length: 50 }).unique(),
  displayName: varchar('display_name', { length: 100 }),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  websiteUrl: text('website_url'),
  twitterHandle: varchar('twitter_handle', { length: 50 }),
  discordHandle: varchar('discord_handle', { length: 100 }),
  otherSocials: jsonb('other_socials'), // Flexible JSON for additional social links
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// Subscription tiers - author-defined membership levels
export const subscriptionTiers = pgTable('subscription_tiers', {
  id: uuid('id').defaultRandom().primaryKey(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  priceMonthly: decimal('price_monthly', { precision: 10, scale: 2 }), // Monthly price
  priceYearly: decimal('price_yearly', { precision: 10, scale: 2 }), // Yearly price
  benefits: jsonb('benefits'), // Array of benefit strings
  chapterDelayDays: integer('chapter_delay_days').default(0).notNull(), // Delay in days for new content
  tierLevel: integer('tier_level').notNull(), // For ordering: 1, 2, 3, etc.
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  authorTierIdx: index('subscription_tiers_author_idx').on(table.authorId)
}))

// User payment configuration - integration credentials
export const userPaymentConfig = pgTable('user_payment_config', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).primaryKey(),
  stripeAccountId: varchar('stripe_account_id', { length: 255 }),
  stripeOnboardingComplete: boolean('stripe_onboarding_complete').default(false).notNull(),
  patreonAccessToken: text('patreon_access_token'), // Encrypted
  patreonRefreshToken: text('patreon_refresh_token'), // Encrypted
  patreonCampaignId: varchar('patreon_campaign_id', { length: 255 }),
  paymentProvider: varchar('payment_provider', { length: 50 }).default('stripe').notNull(), // stripe, patreon, both
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// User followers - following relationships
export const userFollowers = pgTable('user_followers', {
  followerId: uuid('follower_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  followingId: uuid('following_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  followerIdx: index('user_followers_follower_idx').on(table.followerId),
  followingIdx: index('user_followers_following_idx').on(table.followingId)
}))

// User notification preferences
export const userNotificationPreferences = pgTable('user_notification_preferences', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).primaryKey(),
  emailNewChapter: boolean('email_new_chapter').default(true).notNull(),
  emailNewFollower: boolean('email_new_follower').default(true).notNull(),
  emailNewSubscriber: boolean('email_new_subscriber').default(true).notNull(),
  emailNewComment: boolean('email_new_comment').default(true).notNull(),
  emailDigestFrequency: varchar('email_digest_frequency', { length: 20 }).default('daily').notNull(), // instant, daily, weekly, never
  pushNewChapter: boolean('push_new_chapter').default(false).notNull(),
  pushNewComment: boolean('push_new_comment').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// User reading preferences
export const userReadingPreferences = pgTable('user_reading_preferences', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).primaryKey(),
  fontSize: varchar('font_size', { length: 20 }).default('medium').notNull(), // small, medium, large, xlarge
  fontFamily: varchar('font_family', { length: 50 }).default('serif').notNull(), // serif, sans-serif, monospace
  lineHeight: varchar('line_height', { length: 20 }).default('normal').notNull(), // compact, normal, relaxed
  theme: varchar('theme', { length: 20 }).default('auto').notNull(), // light, dark, auto, sepia
  readerWidth: varchar('reader_width', { length: 20 }).default('standard').notNull(), // narrow, standard, wide, full
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// User-installed bobbins (reader-side, account-level)
export const userBobbinsInstalled = pgTable('user_bobbins_installed', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  bobbinId: varchar('bobbin_id', { length: 255 }).notNull(),
  bobbinType: varchar('bobbin_type', { length: 50 }).notNull(), // reader_enhancement, delivery_channel
  config: jsonb('config'), // Per-bobbin configuration (e.g. kindle email, preferences)
  isEnabled: boolean('is_enabled').default(true).notNull(),
  installedAt: timestamp('installed_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  userIdx: index('user_bobbins_installed_user_idx').on(table.userId),
  userBobbinIdx: index('user_bobbins_installed_user_bobbin_idx').on(table.userId, table.bobbinId)
}))

// Beta readers - special access users per author
export const betaReaders = pgTable('beta_readers', {
  id: uuid('id').defaultRandom().primaryKey(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  readerId: uuid('reader_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }), // Optional: per-project access
  accessLevel: varchar('access_level', { length: 50 }).default('beta').notNull(), // beta, arc, early_access
  notes: text('notes'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  authorReaderIdx: index('beta_readers_author_reader_idx').on(table.authorId, table.readerId),
  projectIdx: index('beta_readers_project_idx').on(table.projectId)
}))

// Project-level tables

// Project publish configuration
export const projectPublishConfig = pgTable('project_publish_config', {
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).primaryKey(),
  publishingMode: varchar('publishing_mode', { length: 50 }).default('draft').notNull(), // draft, scheduled, live
  defaultVisibility: varchar('default_visibility', { length: 50 }).default('public').notNull(), // public, subscribers_only, private
  autoReleaseEnabled: boolean('auto_release_enabled').default(false).notNull(),
  releaseFrequency: varchar('release_frequency', { length: 50 }).default('manual').notNull(), // manual, daily, weekly, biweekly, monthly
  releaseDay: varchar('release_day', { length: 20 }), // Monday, Tuesday, etc.
  releaseTime: varchar('release_time', { length: 10 }), // HH:MM in UTC
  slugPrefix: varchar('slug_prefix', { length: 100 }), // URL-friendly project identifier
  seoDescription: text('seo_description'),
  ogImageUrl: text('og_image_url'),
  enableComments: boolean('enable_comments').default(true).notNull(),
  enableReactions: boolean('enable_reactions').default(true).notNull(),
  moderationMode: varchar('moderation_mode', { length: 50 }).default('open').notNull(), // open, approval_required, disabled
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// Project destinations - external publishing targets
export const projectDestinations = pgTable('project_destinations', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // google_drive, dropbox, onedrive, discord_webhook, custom_webhook
  name: varchar('name', { length: 255 }).notNull(),
  config: jsonb('config').notNull(), // Destination-specific configuration
  isActive: boolean('is_active').default(true).notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
  lastSyncStatus: varchar('last_sync_status', { length: 50 }).default('pending').notNull(), // success, failed, pending
  lastSyncError: text('last_sync_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  projectIdx: index('project_destinations_project_idx').on(table.projectId)
}))

// Content warnings - tags and filters
export const contentWarnings = pgTable('content_warnings', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  warningType: varchar('warning_type', { length: 50 }).notNull(), // violence, sexual_content, profanity, gore, trauma, custom
  customLabel: varchar('custom_label', { length: 100 }),
  severity: varchar('severity', { length: 50 }).default('moderate').notNull(), // mild, moderate, explicit
  displayInSummary: boolean('display_in_summary').default(true).notNull(),
  requireAgeGate: boolean('require_age_gate').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  projectIdx: index('content_warnings_project_idx').on(table.projectId)
}))

// Embargo schedules - timed releases per chapter
export const embargoSchedules = pgTable('embargo_schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  entityId: uuid('entity_id').notNull(), // FK to entities table (the chapter)
  publishMode: varchar('publish_mode', { length: 50 }).default('immediate').notNull(), // immediate, scheduled, tiered
  baseReleaseDate: timestamp('base_release_date'), // When highest tier gets access
  publicReleaseDate: timestamp('public_release_date'), // When it becomes fully public
  tierSchedules: jsonb('tier_schedules'), // Array: [{ tierId, releaseDate }]
  isPublished: boolean('is_published').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  projectEntityIdx: index('embargo_schedules_project_entity_idx').on(table.projectId, table.entityId),
  releaseDateIdx: index('embargo_schedules_release_date_idx').on(table.publicReleaseDate)
}))

// Publish snapshots - version history
export const publishSnapshots = pgTable('publish_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  entityId: uuid('entity_id').notNull(), // FK to entities table
  versionNumber: varchar('version_number', { length: 20 }).notNull(),
  snapshotData: jsonb('snapshot_data').notNull(), // Full entity data at publish time
  publishedBy: uuid('published_by').references(() => users.id).notNull(),
  publishedAt: timestamp('published_at').defaultNow().notNull(),
  notes: text('notes')
}, (table) => ({
  entityVersionIdx: index('publish_snapshots_entity_version_idx').on(table.entityId, table.versionNumber)
}))

// Export configurations
export const exportConfigs = pgTable('export_configs', {
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).primaryKey(),
  epubEnabled: boolean('epub_enabled').default(true).notNull(),
  epubCoverUrl: text('epub_cover_url'),
  epubMetadata: jsonb('epub_metadata'), // { author, publisher, isbn, language }
  pdfEnabled: boolean('pdf_enabled').default(true).notNull(),
  pdfTemplate: varchar('pdf_template', { length: 50 }).default('classic').notNull(), // minimal, classic, modern
  markdownEnabled: boolean('markdown_enabled').default(true).notNull(),
  htmlEnabled: boolean('html_enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// Content & Engagement tables

// Chapter publications - publication state tracking
export const chapterPublications = pgTable('chapter_publications', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  chapterId: uuid('chapter_id').notNull(), // FK to entities table
  publishStatus: varchar('publish_status', { length: 50 }).default('draft').notNull(), // draft, scheduled, published, archived
  isPublished: boolean('is_published').default(false).notNull(),
  publishedVersion: varchar('published_version', { length: 20 }),
  publishedAt: timestamp('published_at'),
  publicReleaseDate: timestamp('public_release_date'),
  firstPublishedAt: timestamp('first_published_at'),
  lastPublishedAt: timestamp('last_published_at'),
  viewCount: bigint('view_count', { mode: 'number' }).default(0).notNull(),
  uniqueViewCount: bigint('unique_view_count', { mode: 'number' }).default(0).notNull(),
  completionCount: bigint('completion_count', { mode: 'number' }).default(0).notNull(),
  avgReadTimeSeconds: integer('avg_read_time_seconds'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  projectChapterIdx: index('chapter_publications_project_chapter_idx').on(table.projectId, table.chapterId),
  statusIdx: index('chapter_publications_status_idx').on(table.publishStatus)
}))

// Chapter views - analytics and progress tracking
export const chapterViews = pgTable('chapter_views', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id').notNull(), // FK to entities table
  readerId: uuid('reader_id').references(() => users.id, { onDelete: 'cascade' }), // Nullable for anonymous
  sessionId: varchar('session_id', { length: 255 }), // For anonymous tracking
  startedAt: timestamp('started_at').defaultNow().notNull(),
  lastPositionPercent: integer('last_position_percent').default(0).notNull(),
  completedAt: timestamp('completed_at'),
  readTimeSeconds: integer('read_time_seconds').default(0).notNull(),
  deviceType: varchar('device_type', { length: 20 }), // desktop, mobile, tablet
  referrer: text('referrer')
}, (table) => ({
  chapterIdx: index('chapter_views_chapter_idx').on(table.chapterId),
  chapterReaderIdx: index('chapter_views_chapter_reader_idx').on(table.chapterId, table.readerId),
  readerStartedIdx: index('chapter_views_reader_started_idx').on(table.readerId, table.startedAt),
  sessionIdx: index('chapter_views_session_idx').on(table.sessionId),
  startedAtIdx: index('chapter_views_started_at_idx').on(table.startedAt)
}))

// Comments - chapter discussions
export const comments = pgTable('comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id').notNull(), // FK to entities table
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  parentId: uuid('parent_id').references((): any => comments.id, { onDelete: 'cascade' }), // For nested replies
  content: text('content').notNull(),
  moderationStatus: varchar('moderation_status', { length: 50 }).default('approved').notNull(), // approved, pending, hidden, deleted
  moderatedBy: uuid('moderated_by').references(() => users.id),
  moderatedAt: timestamp('moderated_at'),
  likeCount: bigint('like_count', { mode: 'number' }).default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  chapterIdx: index('comments_chapter_idx').on(table.chapterId),
  authorIdx: index('comments_author_idx').on(table.authorId),
  parentIdx: index('comments_parent_idx').on(table.parentId),
  statusIdx: index('comments_status_idx').on(table.moderationStatus)
}))

// Reactions - emoji reactions to chapters
export const reactions = pgTable('reactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id').notNull(), // FK to entities table
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  reactionType: varchar('reaction_type', { length: 50 }).notNull(), // heart, laugh, wow, sad, fire, clap
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  chapterUserIdx: index('reactions_chapter_user_idx').on(table.chapterId, table.userId),
  typeIdx: index('reactions_type_idx').on(table.reactionType)
}))

// Author notes - commentary attached to chapters
export const authorNotes = pgTable('author_notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id').notNull(), // FK to entities table
  noteType: varchar('note_type', { length: 50 }).default('postscript').notNull(), // preface, postscript, content_warning
  content: text('content').notNull(),
  displayOrder: varchar('display_order', { length: 10 }).default('1').notNull(),
  isPublished: boolean('is_published').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  chapterIdx: index('author_notes_chapter_idx').on(table.chapterId)
}))

// Content tags - genre, theme, metadata
export const contentTags = pgTable('content_tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  tagCategory: varchar('tag_category', { length: 50 }).notNull(), // genre, theme, trope, setting, custom
  tagName: varchar('tag_name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  projectCategoryIdx: index('content_tags_project_category_idx').on(table.projectId, table.tagCategory),
  nameIdx: index('content_tags_name_idx').on(table.tagName)
}))

// Subscription & Access tables

// Subscriptions - active reader subscriptions to authors
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  subscriberId: uuid('subscriber_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tierId: uuid('tier_id').references(() => subscriptionTiers.id).notNull(),
  status: varchar('status', { length: 50 }).default('active').notNull(), // active, past_due, canceled, expired
  currentPeriodStart: timestamp('current_period_start').notNull(),
  currentPeriodEnd: timestamp('current_period_end').notNull(),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  patreonMemberId: varchar('patreon_member_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  subscriberAuthorIdx: index('subscriptions_subscriber_author_idx').on(table.subscriberId, table.authorId),
  authorTierIdx: index('subscriptions_author_tier_idx').on(table.authorId, table.tierId),
  statusIdx: index('subscriptions_status_idx').on(table.status),
  stripeIdx: index('subscriptions_stripe_idx').on(table.stripeSubscriptionId)
}))

// Subscription payments - payment history
export const subscriptionPayments = pgTable('subscription_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'cascade' }).notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(), // Payment amount
  currency: varchar('currency', { length: 3 }).default('USD').notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(), // pending, succeeded, failed, refunded
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
  patreonChargeId: varchar('patreon_charge_id', { length: 255 }),
  paidAt: timestamp('paid_at'),
  refundedAt: timestamp('refunded_at'),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  subscriptionIdx: index('subscription_payments_subscription_idx').on(table.subscriptionId),
  statusIdx: index('subscription_payments_status_idx').on(table.status),
  paidAtIdx: index('subscription_payments_paid_at_idx').on(table.paidAt)
}))

// Access grants - special access overrides
export const accessGrants = pgTable('access_grants', {
  id: uuid('id').defaultRandom().primaryKey(),
  grantedTo: uuid('granted_to').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }), // Nullable - global if null
  chapterId: uuid('chapter_id'), // Nullable - chapter-specific access
  grantType: varchar('grant_type', { length: 50 }).notNull(), // gift, comp, beta, promotional
  expiresAt: timestamp('expires_at'), // Nullable for permanent
  grantedBy: uuid('granted_by').references(() => users.id).notNull(),
  reason: text('reason'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  grantedToAuthorIdx: index('access_grants_granted_to_author_idx').on(table.grantedTo, table.authorId),
  projectIdx: index('access_grants_project_idx').on(table.projectId),
  expiresAtIdx: index('access_grants_expires_at_idx').on(table.expiresAt)
}))

// Discount codes - promotional codes
export const discountCodes = pgTable('discount_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  code: varchar('code', { length: 50 }).unique().notNull(),
  discountType: varchar('discount_type', { length: 50 }).notNull(), // percent, fixed_amount, free_trial
  discountValue: decimal('discount_value', { precision: 10, scale: 2 }).notNull(),
  maxUses: integer('max_uses'), // Nullable for unlimited
  currentUses: integer('current_uses').default(0).notNull(),
  expiresAt: timestamp('expires_at'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  authorIdx: index('discount_codes_author_idx').on(table.authorId),
  codeIdx: index('discount_codes_code_idx').on(table.code),
  expiresAtIdx: index('discount_codes_expires_at_idx').on(table.expiresAt)
}))

// Project collections - series/grouping of related projects
export const projectCollections = pgTable('project_collections', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  shortUrl: varchar('short_url', { length: 120 }).unique(),
  coverImage: varchar('cover_image', { length: 500 }),
  colorTheme: varchar('color_theme', { length: 20 }),
  isPublic: boolean('is_public').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  userIdx: index('project_collections_user_idx').on(table.userId),
  shortUrlIdx: index('project_collections_short_url_idx').on(table.shortUrl)
}))

// Project collection memberships - many-to-many relationship between projects and collections
export const projectCollectionMemberships = pgTable('project_collection_memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  collectionId: uuid('collection_id').references(() => projectCollections.id, { onDelete: 'cascade' }).notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  orderIndex: integer('order_index').default(0).notNull(),
  addedAt: timestamp('added_at').defaultNow().notNull()
}, (table) => ({
  collectionIdx: index('project_collection_memberships_collection_idx').on(table.collectionId),
  projectIdx: index('project_collection_memberships_project_idx').on(table.projectId),
  orderIdx: index('project_collection_memberships_order_idx').on(table.collectionId, table.orderIndex)
}))

// Projects table - main workspace containers
export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  coverImage: text('cover_image'),
  shortUrl: varchar('short_url', { length: 120 }).unique(),
  shortUrlClaimedAt: timestamp('short_url_claimed_at'),
  isArchived: boolean('is_archived').default(false).notNull(),
  archivedAt: timestamp('archived_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  ownerArchivedIdx: index('projects_owner_archived_idx').on(table.ownerId, table.isArchived),
  shortUrlIdx: index('projects_short_url_idx').on(table.shortUrl)
}))

// Project memberships - user access to projects
export const memberships = pgTable('memberships', {
  userId: uuid('user_id').references(() => users.id).notNull(),
  projectId: uuid('project_id').references(() => projects.id).notNull(),
  role: varchar('role', { length: 50 }).notNull().default('member'), // owner, admin, member, viewer
  createdAt: timestamp('created_at').defaultNow().notNull()
})

// Installed bobbins per project
export const bobbinsInstalled = pgTable('bobbins_installed', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id).notNull(),
  bobbinId: varchar('bobbin_id', { length: 255 }).notNull(),
  version: varchar('version', { length: 50 }).notNull(),
  manifestJson: jsonb('manifest_json').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  
  // Admin-controlled configuration (NOT from manifest)
  executionMode: varchar('execution_mode', { length: 50 }).default('sandboxed').notNull(), // 'sandboxed' | 'native'
  trustLevel: varchar('trust_level', { length: 50 }).default('community').notNull(), // 'first-party' | 'verified' | 'community'
  storageTier: varchar('storage_tier', { length: 50 }).default('tier1').notNull(), // 'tier1' | 'tier2'
  
  installedAt: timestamp('installed_at').defaultNow().notNull(),
  configUpdatedBy: uuid('config_updated_by').references(() => users.id),
  configUpdatedAt: timestamp('config_updated_at')
})

// Manifest versions registry
export const manifestsVersions = pgTable('manifests_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  bobbinId: varchar('bobbin_id', { length: 255 }).notNull(),
  version: varchar('version', { length: 50 }).notNull(),
  manifestJson: jsonb('manifest_json').notNull(),
  signature: text('signature'), // For future validation/integrity
  createdAt: timestamp('created_at').defaultNow().notNull()
})

// Publish targets - static site generation results
export const publishTargets = pgTable('publish_targets', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // snapshot, live, preview
  status: varchar('status', { length: 50 }).notNull().default('pending'), // pending, building, ready, failed
  url: text('url'),
  versionId: varchar('version_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// Entities table - Tier 1 JSONB storage for all collections
export const entities = pgTable('entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  bobbinId: varchar('bobbin_id', { length: 255 }).notNull(),
  collectionName: varchar('collection_name', { length: 255 }).notNull(),
  entityData: jsonb('entity_data').notNull(),
  lastEditedAt: timestamp('last_edited_at').defaultNow(),
  lastEditedBy: uuid('last_edited_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  projectCollectionIdx: index('entities_project_collection_idx').on(table.projectId, table.collectionName),
  searchIdx: index('entities_search_idx').using('gin', table.entityData),
  orderIdx: index('entities_order_idx').using('btree', table.projectId, table.collectionName, sql`(entity_data->>'order')`),
  lastEditedIdx: index('entities_last_edited_idx').on(table.lastEditedAt),
  projectEditedIdx: index('entities_project_edited_idx').on(table.projectId, table.lastEditedAt)
}))

// Uploads - audit trail for file uploads
export const uploads = pgTable('uploads', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  s3Key: text('s3_key').notNull(),
  filename: text('filename'),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  context: text('context').notNull(), // 'cover' | 'entity' | 'editor' | 'avatar' | 'map'
  status: text('status').default('active').notNull(), // 'active' | 'reported' | 'removed'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  projectIdx: index('uploads_project_idx').on(table.projectId),
  userIdx: index('uploads_user_idx').on(table.userId),
  statusIdx: index('uploads_status_idx').on(table.status)
}))

// Provenance events - audit trail for security and compliance
export const provenanceEvents = pgTable('provenance_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id).notNull(),
  entityRef: varchar('entity_ref', { length: 512 }), // project_id:bobbin_id:collection:entity_id format
  actor: varchar('actor', { length: 255 }).notNull(), // user_id or system
  action: varchar('action', { length: 100 }).notNull(), // create, update, delete, publish, ai_assist, external_call
  metaJson: jsonb('meta_json'), // Additional context data
  createdAt: timestamp('created_at').defaultNow().notNull()
})

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  memberships: many(memberships)
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id]
  }),
  memberships: many(memberships),
  bobbinsInstalled: many(bobbinsInstalled),
  entities: many(entities),
  publishTargets: many(publishTargets),
  provenanceEvents: many(provenanceEvents),
  collectionMemberships: many(projectCollectionMemberships)
}))

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id]
  }),
  project: one(projects, {
    fields: [memberships.projectId],
    references: [projects.id]
  })
}))

export const bobbinsInstalledRelations = relations(bobbinsInstalled, ({ one }) => ({
  project: one(projects, {
    fields: [bobbinsInstalled.projectId],
    references: [projects.id]
  })
}))

export const publishTargetsRelations = relations(publishTargets, ({ one }) => ({
  project: one(projects, {
    fields: [publishTargets.projectId],
    references: [projects.id]
  })
}))

export const entitiesRelations = relations(entities, ({ one }) => ({
  project: one(projects, {
    fields: [entities.projectId],
    references: [projects.id]
  })
}))

export const provenanceEventsRelations = relations(provenanceEvents, ({ one }) => ({
  project: one(projects, {
    fields: [provenanceEvents.projectId],
    references: [projects.id]
  })
}))


// New table relations

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id]
  })
}))

export const subscriptionTiersRelations = relations(subscriptionTiers, ({ one, many }) => ({
  author: one(users, {
    fields: [subscriptionTiers.authorId],
    references: [users.id]
  }),
  subscriptions: many(subscriptions)
}))

export const userPaymentConfigRelations = relations(userPaymentConfig, ({ one }) => ({
  user: one(users, {
    fields: [userPaymentConfig.userId],
    references: [users.id]
  })
}))

export const userFollowersRelations = relations(userFollowers, ({ one }) => ({
  follower: one(users, {
    fields: [userFollowers.followerId],
    references: [users.id]
  }),
  following: one(users, {
    fields: [userFollowers.followingId],
    references: [users.id]
  })
}))

export const userNotificationPreferencesRelations = relations(userNotificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [userNotificationPreferences.userId],
    references: [users.id]
  })
}))

export const userReadingPreferencesRelations = relations(userReadingPreferences, ({ one }) => ({
  user: one(users, {
    fields: [userReadingPreferences.userId],
    references: [users.id]
  })
}))

export const userBobbinsInstalledRelations = relations(userBobbinsInstalled, ({ one }) => ({
  user: one(users, {
    fields: [userBobbinsInstalled.userId],
    references: [users.id]
  })
}))

export const betaReadersRelations = relations(betaReaders, ({ one }) => ({
  author: one(users, {
    fields: [betaReaders.authorId],
    references: [users.id]
  }),
  reader: one(users, {
    fields: [betaReaders.readerId],
    references: [users.id]
  }),
  project: one(projects, {
    fields: [betaReaders.projectId],
    references: [projects.id]
  })
}))

export const projectPublishConfigRelations = relations(projectPublishConfig, ({ one }) => ({
  project: one(projects, {
    fields: [projectPublishConfig.projectId],
    references: [projects.id]
  })
}))

export const projectDestinationsRelations = relations(projectDestinations, ({ one }) => ({
  project: one(projects, {
    fields: [projectDestinations.projectId],
    references: [projects.id]
  })
}))

export const contentWarningsRelations = relations(contentWarnings, ({ one }) => ({
  project: one(projects, {
    fields: [contentWarnings.projectId],
    references: [projects.id]
  })
}))

export const embargoSchedulesRelations = relations(embargoSchedules, ({ one }) => ({
  project: one(projects, {
    fields: [embargoSchedules.projectId],
    references: [projects.id]
  })
}))

export const publishSnapshotsRelations = relations(publishSnapshots, ({ one }) => ({
  project: one(projects, {
    fields: [publishSnapshots.projectId],
    references: [projects.id]
  }),
  publisher: one(users, {
    fields: [publishSnapshots.publishedBy],
    references: [users.id]
  })
}))

export const exportConfigsRelations = relations(exportConfigs, ({ one }) => ({
  project: one(projects, {
    fields: [exportConfigs.projectId],
    references: [projects.id]
  })
}))

export const chapterPublicationsRelations = relations(chapterPublications, ({ one }) => ({
  project: one(projects, {
    fields: [chapterPublications.projectId],
    references: [projects.id]
  })
}))

export const chapterViewsRelations = relations(chapterViews, ({ one }) => ({
  reader: one(users, {
    fields: [chapterViews.readerId],
    references: [users.id]
  })
}))

export const commentsRelations = relations(comments, ({ one, many }) => ({
  author: one(users, {
    fields: [comments.authorId],
    references: [users.id]
  }),
  moderator: one(users, {
    fields: [comments.moderatedBy],
    references: [users.id]
  }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id]
  }),
  replies: many(comments)
}))

export const reactionsRelations = relations(reactions, ({ one }) => ({
  user: one(users, {
    fields: [reactions.userId],
    references: [users.id]
  })
}))

export const contentTagsRelations = relations(contentTags, ({ one }) => ({
  project: one(projects, {
    fields: [contentTags.projectId],
    references: [projects.id]
  })
}))

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  subscriber: one(users, {
    fields: [subscriptions.subscriberId],
    references: [users.id]
  }),
  author: one(users, {
    fields: [subscriptions.authorId],
    references: [users.id]
  }),
  tier: one(subscriptionTiers, {
    fields: [subscriptions.tierId],
    references: [subscriptionTiers.id]
  }),
  payments: many(subscriptionPayments)
}))

export const subscriptionPaymentsRelations = relations(subscriptionPayments, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [subscriptionPayments.subscriptionId],
    references: [subscriptions.id]
  })
}))

export const accessGrantsRelations = relations(accessGrants, ({ one }) => ({
  grantee: one(users, {
    fields: [accessGrants.grantedTo],
    references: [users.id]
  }),
  author: one(users, {
    fields: [accessGrants.authorId],
    references: [users.id]
  }),
  grantor: one(users, {
    fields: [accessGrants.grantedBy],
    references: [users.id]
  }),
  project: one(projects, {
    fields: [accessGrants.projectId],
    references: [projects.id]
  })
}))

export const discountCodesRelations = relations(discountCodes, ({ one }) => ({
  author: one(users, {
    fields: [discountCodes.authorId],
    references: [users.id]
  })
}))

export const projectCollectionsRelations = relations(projectCollections, ({ one, many }) => ({
  user: one(users, {
    fields: [projectCollections.userId],
    references: [users.id]
  }),
  memberships: many(projectCollectionMemberships)
}))

export const projectCollectionMembershipsRelations = relations(projectCollectionMemberships, ({ one }) => ({
  collection: one(projectCollections, {
    fields: [projectCollectionMemberships.collectionId],
    references: [projectCollections.id]
  }),
  project: one(projects, {
    fields: [projectCollectionMemberships.projectId],
    references: [projects.id]
  })
}))

export const uploadsRelations = relations(uploads, ({ one }) => ({
  user: one(users, {
    fields: [uploads.userId],
    references: [users.id]
  }),
  project: one(projects, {
    fields: [uploads.projectId],
    references: [projects.id]
  })
}))
