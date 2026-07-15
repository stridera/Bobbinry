ALTER TABLE "project_publish_config" ADD COLUMN IF NOT EXISTS "project_visibility" varchar(20) DEFAULT 'public' NOT NULL;
