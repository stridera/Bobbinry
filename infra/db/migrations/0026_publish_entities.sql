ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "is_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "published_at" timestamp;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "publish_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "minimum_tier_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_public_idx" ON "entities" USING btree ("project_id","collection_name","is_published","publish_order");
