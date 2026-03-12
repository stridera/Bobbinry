-- Add muted column to project_follows for per-project notification suppression
ALTER TABLE "project_follows" ADD COLUMN IF NOT EXISTS "muted" boolean DEFAULT false NOT NULL;
