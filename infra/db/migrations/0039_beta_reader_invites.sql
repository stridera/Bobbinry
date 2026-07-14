CREATE TABLE IF NOT EXISTS "beta_reader_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"project_id" uuid,
	"token" varchar(128) NOT NULL,
	"access_level" varchar(50) DEFAULT 'beta' NOT NULL,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"notify_on_use" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "beta_reader_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD COLUMN IF NOT EXISTS "email_beta_reader_joined" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "beta_reader_invites" ADD CONSTRAINT "beta_reader_invites_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "beta_reader_invites" ADD CONSTRAINT "beta_reader_invites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beta_reader_invites_author_idx" ON "beta_reader_invites" USING btree ("author_id");
