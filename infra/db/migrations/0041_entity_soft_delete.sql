-- Soft delete (trash) for entities.
--
-- Deleting a chapter previously issued DELETE FROM entities, and deleting a
-- container cascaded that to every chapter under it. Nothing was recoverable.
-- These columns make deletion reversible for 30 days. The row stays in place,
-- so its comments, annotations, publications and slug survive the window and
-- come back on restore -- which a copy-to-a-trash-table design could not offer.
--
-- entity_changes.lifecycle records which transition produced an event
-- (trashed / untrashed / purged / archived / unarchived) without adding a
-- fourth value to `action`, which existing feed consumers branch on
-- exhaustively.

ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "deleted_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "entity_changes" ADD COLUMN IF NOT EXISTS "lifecycle" varchar(20);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "entities" ADD CONSTRAINT "entities_deleted_by_users_id_fk"
    FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_project_deleted_idx" ON "entities" USING btree ("project_id","deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_deleted_batch_idx" ON "entities" USING btree ("deleted_batch_id") WHERE "entities"."deleted_batch_id" IS NOT NULL;