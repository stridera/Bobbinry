-- Revision history for entity content.
--
-- Each row stores entity_data as it was BEFORE a writing session, not after.
-- That direction is load-bearing: the expensive toasted write then happens once
-- per session window while every other autosave is a cheap HOT update to inline
-- columns, the first save an entity ever receives becomes recoverable, and
-- diff(revision -> live) is exactly "what changed since then".
--
-- session_bucket is a wall-clock bucket (date_bin, computed in SQL so clock
-- drift between machines cannot split one session across two rows). The partial
-- unique index collapses every save in a bucket by one actor onto one row. A
-- time-relative predicate would be illegal here -- partial index predicates must
-- be IMMUTABLE and now() is only STABLE -- which is why the window is a stored
-- value rather than a query.
--
-- Labeled checkpoints carry a NULL bucket, so they fall outside that index and
-- always insert. entity_revisions_bucket_chk enforces that pairing in the schema
-- rather than trusting every call site.

CREATE TABLE IF NOT EXISTS "entity_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"entity_id" uuid NOT NULL,
	"collection" varchar(255) NOT NULL,
	"content_type" varchar(32),
	"snapshot" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"word_count" integer,
	"entity_version" integer NOT NULL,
	"entity_version_end" integer NOT NULL,
	"label" varchar(24),
	"label_note" text,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"actor_key" text NOT NULL,
	"session_bucket" timestamp with time zone,
	"session_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"save_count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "entity_revisions_label_chk" CHECK ("entity_revisions"."label" IS NULL OR "entity_revisions"."label" IN ('publish','import','search_replace','pre_restore','manual','system')),
	CONSTRAINT "entity_revisions_bucket_chk" CHECK (("entity_revisions"."label" IS NULL) = ("entity_revisions"."session_bucket" IS NOT NULL))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "entity_revisions" ADD CONSTRAINT "entity_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "entity_revisions" ADD CONSTRAINT "entity_revisions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_revisions_session_uidx" ON "entity_revisions" USING btree ("entity_id","actor_key","session_bucket") WHERE "entity_revisions"."session_bucket" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_revisions_entity_started_idx" ON "entity_revisions" USING btree ("entity_id","session_started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_revisions_thin_idx" ON "entity_revisions" USING btree ("entity_id","session_started_at") WHERE "entity_revisions"."label" IS NULL AND "entity_revisions"."is_pinned" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_revisions_project_started_idx" ON "entity_revisions" USING btree ("project_id","session_started_at");