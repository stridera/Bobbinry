-- Shell layout preferences that follow the user (panel widths, rail state,
-- view choices, last-visited targets) as one JSONB blob of namespaces.
-- Idempotent: safe to re-run where the table already exists.
CREATE TABLE IF NOT EXISTS "user_shell_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_shell_preferences" ADD CONSTRAINT "user_shell_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
