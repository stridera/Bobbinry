ALTER TABLE "project_manuscript_display_settings" ADD COLUMN IF NOT EXISTS "chapter_numbering" varchar(20);--> statement-breakpoint
ALTER TABLE "user_manuscript_display_settings" ADD COLUMN IF NOT EXISTS "chapter_numbering" varchar(20) DEFAULT 'off' NOT NULL;
