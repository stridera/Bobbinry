CREATE TABLE IF NOT EXISTS "user_bobbins_installed" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "bobbin_id" varchar(255) NOT NULL,
  "bobbin_type" varchar(50) NOT NULL,
  "config" jsonb,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "installed_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "user_bobbins_installed_user_idx" ON "user_bobbins_installed" ("user_id");
CREATE INDEX IF NOT EXISTS "user_bobbins_installed_user_bobbin_idx" ON "user_bobbins_installed" ("user_id", "bobbin_id");
