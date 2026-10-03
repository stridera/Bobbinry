ALTER TABLE "chapter_publications" ADD COLUMN IF NOT EXISTS "beta_shared" boolean DEFAULT false NOT NULL;
