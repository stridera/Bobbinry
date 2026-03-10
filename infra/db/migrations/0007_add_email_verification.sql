ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(128) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "email_verification_tokens"
		ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Backfill: mark OAuth users (no password) as verified
UPDATE "users" SET "email_verified" = "created_at" WHERE "password_hash" IS NULL AND "email_verified" IS NULL;
