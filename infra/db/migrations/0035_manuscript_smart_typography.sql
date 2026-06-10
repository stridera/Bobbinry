ALTER TABLE "user_manuscript_display_settings" ADD COLUMN IF NOT EXISTS "smart_dashes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_manuscript_display_settings" ADD COLUMN IF NOT EXISTS "smart_ellipsis" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_manuscript_display_settings" ADD COLUMN IF NOT EXISTS "smart_dashes" boolean;--> statement-breakpoint
ALTER TABLE "project_manuscript_display_settings" ADD COLUMN IF NOT EXISTS "smart_ellipsis" boolean;
