ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "content_type" varchar(32);--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;--> statement-breakpoint
UPDATE "entities"
SET "content_type" = 'chapter'
WHERE "collection_name" = 'content' AND "content_type" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_project_archived_idx" ON "entities" USING btree ("project_id","collection_name","archived_at");
