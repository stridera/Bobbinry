CREATE TABLE "access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"granted_to" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"project_id" uuid,
	"chapter_id" uuid,
	"grant_type" varchar(50) NOT NULL,
	"expires_at" timestamp,
	"granted_by" uuid NOT NULL,
	"reason" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "author_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"note_type" varchar(50) DEFAULT 'postscript' NOT NULL,
	"content" text NOT NULL,
	"display_order" varchar(10) DEFAULT '1' NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beta_readers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"reader_id" uuid NOT NULL,
	"project_id" uuid,
	"access_level" varchar(50) DEFAULT 'beta' NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bobbins_installed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"bobbin_id" varchar(255) NOT NULL,
	"version" varchar(50) NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"execution_mode" varchar(50) DEFAULT 'sandboxed' NOT NULL,
	"trust_level" varchar(50) DEFAULT 'community' NOT NULL,
	"storage_tier" varchar(50) DEFAULT 'tier1' NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"config_updated_by" uuid,
	"config_updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "chapter_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"publish_status" varchar(50) DEFAULT 'draft' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_version" varchar(20),
	"published_at" timestamp,
	"public_release_date" timestamp,
	"first_published_at" timestamp,
	"last_published_at" timestamp,
	"view_count" bigint DEFAULT 0 NOT NULL,
	"unique_view_count" bigint DEFAULT 0 NOT NULL,
	"completion_count" bigint DEFAULT 0 NOT NULL,
	"avg_read_time_seconds" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"reader_id" uuid,
	"session_id" varchar(255),
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_position_percent" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp,
	"read_time_seconds" integer DEFAULT 0 NOT NULL,
	"device_type" varchar(20),
	"referrer" text
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"content" text NOT NULL,
	"moderation_status" varchar(50) DEFAULT 'approved' NOT NULL,
	"moderated_by" uuid,
	"moderated_at" timestamp,
	"like_count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"tag_category" varchar(50) NOT NULL,
	"tag_name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_warnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"warning_type" varchar(50) NOT NULL,
	"custom_label" varchar(100),
	"severity" varchar(50) DEFAULT 'moderate' NOT NULL,
	"display_in_summary" boolean DEFAULT true NOT NULL,
	"require_age_gate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"discount_type" varchar(50) NOT NULL,
	"discount_value" numeric(10, 2) NOT NULL,
	"max_uses" integer,
	"current_uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discount_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "embargo_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"publish_mode" varchar(50) DEFAULT 'immediate' NOT NULL,
	"base_release_date" timestamp,
	"public_release_date" timestamp,
	"tier_schedules" jsonb,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"bobbin_id" varchar(255) NOT NULL,
	"collection_name" varchar(255) NOT NULL,
	"entity_data" jsonb NOT NULL,
	"last_edited_at" timestamp DEFAULT now(),
	"last_edited_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_configs" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"epub_enabled" boolean DEFAULT true NOT NULL,
	"epub_cover_url" text,
	"epub_metadata" jsonb,
	"pdf_enabled" boolean DEFAULT true NOT NULL,
	"pdf_template" varchar(50) DEFAULT 'classic' NOT NULL,
	"markdown_enabled" boolean DEFAULT true NOT NULL,
	"html_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifests_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bobbin_id" varchar(255) NOT NULL,
	"version" varchar(50) NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"signature" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_collection_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"short_url" varchar(12),
	"cover_image" varchar(500),
	"color_theme" varchar(20),
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_collections_short_url_unique" UNIQUE("short_url")
);
--> statement-breakpoint
CREATE TABLE "project_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"config" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp,
	"last_sync_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"last_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_publish_config" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"publishing_mode" varchar(50) DEFAULT 'draft' NOT NULL,
	"default_visibility" varchar(50) DEFAULT 'public' NOT NULL,
	"auto_release_enabled" boolean DEFAULT false NOT NULL,
	"release_frequency" varchar(50) DEFAULT 'manual' NOT NULL,
	"release_day" varchar(20),
	"release_time" varchar(10),
	"slug_prefix" varchar(100),
	"seo_description" text,
	"og_image_url" text,
	"enable_comments" boolean DEFAULT true NOT NULL,
	"enable_reactions" boolean DEFAULT true NOT NULL,
	"moderation_mode" varchar(50) DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"short_url" varchar(12),
	"short_url_claimed_at" timestamp,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_short_url_unique" UNIQUE("short_url")
);
--> statement-breakpoint
CREATE TABLE "provenance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_ref" varchar(512),
	"actor" varchar(255) NOT NULL,
	"action" varchar(100) NOT NULL,
	"meta_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"version_number" varchar(20) NOT NULL,
	"snapshot_data" jsonb NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "publish_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"url" text,
	"version_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction_type" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"patreon_charge_id" varchar(255),
	"paid_at" timestamp,
	"refunded_at" timestamp,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"price_monthly" numeric(10, 2),
	"price_yearly" numeric(10, 2),
	"benefits" jsonb,
	"chapter_delay_days" integer DEFAULT 0 NOT NULL,
	"tier_level" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp NOT NULL,
	"current_period_end" timestamp NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"stripe_subscription_id" varchar(255),
	"patreon_member_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_followers" (
	"follower_id" uuid NOT NULL,
	"following_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email_new_chapter" boolean DEFAULT true NOT NULL,
	"email_new_follower" boolean DEFAULT true NOT NULL,
	"email_new_subscriber" boolean DEFAULT true NOT NULL,
	"email_new_comment" boolean DEFAULT true NOT NULL,
	"email_digest_frequency" varchar(20) DEFAULT 'daily' NOT NULL,
	"push_new_chapter" boolean DEFAULT false NOT NULL,
	"push_new_comment" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_payment_config" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"stripe_account_id" varchar(255),
	"stripe_onboarding_complete" boolean DEFAULT false NOT NULL,
	"patreon_access_token" text,
	"patreon_refresh_token" text,
	"patreon_campaign_id" varchar(255),
	"payment_provider" varchar(50) DEFAULT 'stripe' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"username" varchar(50),
	"display_name" varchar(100),
	"bio" text,
	"avatar_url" text,
	"website_url" text,
	"twitter_handle" varchar(50),
	"discord_handle" varchar(100),
	"other_socials" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "user_reading_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"font_size" varchar(20) DEFAULT 'medium' NOT NULL,
	"font_family" varchar(50) DEFAULT 'serif' NOT NULL,
	"line_height" varchar(20) DEFAULT 'normal' NOT NULL,
	"theme" varchar(20) DEFAULT 'auto' NOT NULL,
	"reader_width" varchar(20) DEFAULT 'standard' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text,
	"name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_granted_to_users_id_fk" FOREIGN KEY ("granted_to") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beta_readers" ADD CONSTRAINT "beta_readers_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beta_readers" ADD CONSTRAINT "beta_readers_reader_id_users_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beta_readers" ADD CONSTRAINT "beta_readers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bobbins_installed" ADD CONSTRAINT "bobbins_installed_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bobbins_installed" ADD CONSTRAINT "bobbins_installed_config_updated_by_users_id_fk" FOREIGN KEY ("config_updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_publications" ADD CONSTRAINT "chapter_publications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_views" ADD CONSTRAINT "chapter_views_reader_id_users_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_tags" ADD CONSTRAINT "content_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_warnings" ADD CONSTRAINT "content_warnings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embargo_schedules" ADD CONSTRAINT "embargo_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_configs" ADD CONSTRAINT "export_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collection_memberships" ADD CONSTRAINT "project_collection_memberships_collection_id_project_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."project_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collection_memberships" ADD CONSTRAINT "project_collection_memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collections" ADD CONSTRAINT "project_collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_destinations" ADD CONSTRAINT "project_destinations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_publish_config" ADD CONSTRAINT "project_publish_config_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_events" ADD CONSTRAINT "provenance_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_snapshots" ADD CONSTRAINT "publish_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_snapshots" ADD CONSTRAINT "publish_snapshots_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_targets" ADD CONSTRAINT "publish_targets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_tiers" ADD CONSTRAINT "subscription_tiers_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_subscriber_id_users_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tier_id_subscription_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."subscription_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_followers" ADD CONSTRAINT "user_followers_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_followers" ADD CONSTRAINT "user_followers_following_id_users_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_payment_config" ADD CONSTRAINT "user_payment_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reading_preferences" ADD CONSTRAINT "user_reading_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_grants_granted_to_author_idx" ON "access_grants" USING btree ("granted_to","author_id");--> statement-breakpoint
CREATE INDEX "access_grants_project_idx" ON "access_grants" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "access_grants_expires_at_idx" ON "access_grants" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "author_notes_chapter_idx" ON "author_notes" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "beta_readers_author_reader_idx" ON "beta_readers" USING btree ("author_id","reader_id");--> statement-breakpoint
CREATE INDEX "beta_readers_project_idx" ON "beta_readers" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "chapter_publications_project_chapter_idx" ON "chapter_publications" USING btree ("project_id","chapter_id");--> statement-breakpoint
CREATE INDEX "chapter_publications_status_idx" ON "chapter_publications" USING btree ("publish_status");--> statement-breakpoint
CREATE INDEX "chapter_views_chapter_idx" ON "chapter_views" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "chapter_views_chapter_reader_idx" ON "chapter_views" USING btree ("chapter_id","reader_id");--> statement-breakpoint
CREATE INDEX "chapter_views_reader_started_idx" ON "chapter_views" USING btree ("reader_id","started_at");--> statement-breakpoint
CREATE INDEX "chapter_views_session_idx" ON "chapter_views" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "chapter_views_started_at_idx" ON "chapter_views" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "comments_chapter_idx" ON "comments" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_status_idx" ON "comments" USING btree ("moderation_status");--> statement-breakpoint
CREATE INDEX "content_tags_project_category_idx" ON "content_tags" USING btree ("project_id","tag_category");--> statement-breakpoint
CREATE INDEX "content_tags_name_idx" ON "content_tags" USING btree ("tag_name");--> statement-breakpoint
CREATE INDEX "content_warnings_project_idx" ON "content_warnings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "discount_codes_author_idx" ON "discount_codes" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "discount_codes_code_idx" ON "discount_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "discount_codes_expires_at_idx" ON "discount_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "embargo_schedules_project_entity_idx" ON "embargo_schedules" USING btree ("project_id","entity_id");--> statement-breakpoint
CREATE INDEX "embargo_schedules_release_date_idx" ON "embargo_schedules" USING btree ("public_release_date");--> statement-breakpoint
CREATE INDEX "entities_project_collection_idx" ON "entities" USING btree ("project_id","collection_name");--> statement-breakpoint
CREATE INDEX "entities_search_idx" ON "entities" USING gin ("entity_data");--> statement-breakpoint
CREATE INDEX "entities_order_idx" ON "entities" USING btree ("project_id","collection_name","entity_data");--> statement-breakpoint
CREATE INDEX "entities_last_edited_idx" ON "entities" USING btree ("last_edited_at");--> statement-breakpoint
CREATE INDEX "entities_project_edited_idx" ON "entities" USING btree ("project_id","last_edited_at");--> statement-breakpoint
CREATE INDEX "project_collection_memberships_collection_idx" ON "project_collection_memberships" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "project_collection_memberships_project_idx" ON "project_collection_memberships" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_collection_memberships_order_idx" ON "project_collection_memberships" USING btree ("collection_id","order_index");--> statement-breakpoint
CREATE INDEX "project_collections_user_idx" ON "project_collections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_collections_short_url_idx" ON "project_collections" USING btree ("short_url");--> statement-breakpoint
CREATE INDEX "project_destinations_project_idx" ON "project_destinations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_owner_archived_idx" ON "projects" USING btree ("owner_id","is_archived");--> statement-breakpoint
CREATE INDEX "projects_short_url_idx" ON "projects" USING btree ("short_url");--> statement-breakpoint
CREATE INDEX "publish_snapshots_entity_version_idx" ON "publish_snapshots" USING btree ("entity_id","version_number");--> statement-breakpoint
CREATE INDEX "reactions_chapter_user_idx" ON "reactions" USING btree ("chapter_id","user_id");--> statement-breakpoint
CREATE INDEX "reactions_type_idx" ON "reactions" USING btree ("reaction_type");--> statement-breakpoint
CREATE INDEX "subscription_payments_subscription_idx" ON "subscription_payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_payments_status_idx" ON "subscription_payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscription_payments_paid_at_idx" ON "subscription_payments" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "subscription_tiers_author_idx" ON "subscription_tiers" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "subscriptions_subscriber_author_idx" ON "subscriptions" USING btree ("subscriber_id","author_id");--> statement-breakpoint
CREATE INDEX "subscriptions_author_tier_idx" ON "subscriptions" USING btree ("author_id","tier_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_stripe_idx" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "user_followers_follower_idx" ON "user_followers" USING btree ("follower_id");--> statement-breakpoint
CREATE INDEX "user_followers_following_idx" ON "user_followers" USING btree ("following_id");