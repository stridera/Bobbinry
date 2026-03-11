-- Add soft-delete (trash) support to projects and collections
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "project_collections" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

-- Indexes for efficient trash queries
CREATE INDEX IF NOT EXISTS "projects_owner_deleted_idx" ON "projects" ("owner_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "project_collections_deleted_idx" ON "project_collections" ("user_id", "deleted_at");
