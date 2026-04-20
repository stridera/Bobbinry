ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "variant_access_levels" jsonb DEFAULT '{}'::jsonb NOT NULL;
