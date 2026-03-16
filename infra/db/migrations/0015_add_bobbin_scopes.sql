-- bobbins_installed: add scope support
ALTER TABLE "bobbins_installed" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "bobbins_installed" ADD COLUMN IF NOT EXISTS "collection_id" uuid REFERENCES "project_collections"("id") ON DELETE CASCADE;
ALTER TABLE "bobbins_installed" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "bobbins_installed" ADD COLUMN IF NOT EXISTS "scope" varchar(20) NOT NULL DEFAULT 'project';
CREATE UNIQUE INDEX IF NOT EXISTS "bobbins_installed_collection_bobbin_idx" ON "bobbins_installed" ("collection_id", "bobbin_id") WHERE "collection_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "bobbins_installed_global_bobbin_idx" ON "bobbins_installed" ("user_id", "bobbin_id") WHERE "user_id" IS NOT NULL;

-- entities: add scope support
ALTER TABLE "entities" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "collection_id" uuid REFERENCES "project_collections"("id") ON DELETE CASCADE;
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "scope" varchar(20) NOT NULL DEFAULT 'project';
CREATE INDEX IF NOT EXISTS "entities_coll_collection_idx" ON "entities" ("collection_id", "collection_name");
CREATE INDEX IF NOT EXISTS "entities_user_collection_idx" ON "entities" ("user_id", "collection_name");
