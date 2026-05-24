ALTER TABLE "cron_runs" ADD COLUMN IF NOT EXISTS "last_sent_at" timestamp;
--> statement-breakpoint
UPDATE "cron_runs"
SET "last_sent_at" = date_trunc('day', NOW()) + INTERVAL '14 hours' - INTERVAL '24 hours'
WHERE "job_name" = 'admin_daily_report' AND "last_sent_at" IS NULL;
--> statement-breakpoint
UPDATE "chapter_publications"
SET "first_published_at" = COALESCE("published_at", "last_published_at", "created_at")
WHERE "first_published_at" IS NULL AND "publish_status" = 'published';
