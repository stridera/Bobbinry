ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "publish_base" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "published_variant_ids" text[] DEFAULT '{}'::text[] NOT NULL;
