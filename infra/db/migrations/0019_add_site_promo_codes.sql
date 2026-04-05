-- Site promo codes (shared discount codes for site membership)
CREATE TABLE IF NOT EXISTS "site_promo_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(50) UNIQUE NOT NULL,
  "stripe_coupon_id" varchar(255) NOT NULL,
  "discount_type" varchar(50) NOT NULL,
  "discount_value" decimal(10,2) NOT NULL,
  "discount_duration_months" integer,
  "max_redemptions" integer,
  "current_redemptions" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "site_promo_codes_expires_at_idx" ON "site_promo_codes" ("expires_at");

-- Site promo campaigns (HMAC-based gift key batches)
CREATE TABLE IF NOT EXISTS "site_promo_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL,
  "prefix" varchar(20) UNIQUE NOT NULL,
  "secret" varchar(64) NOT NULL,
  "code_count" integer DEFAULT 0 NOT NULL,
  "gift_duration_months" integer NOT NULL,
  "max_redemptions" integer,
  "current_redemptions" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "site_promo_campaigns_expires_at_idx" ON "site_promo_campaigns" ("expires_at");

-- Site promo redemptions (shared audit trail)
CREATE TABLE IF NOT EXISTS "site_promo_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "promo_code_id" uuid REFERENCES "site_promo_codes"("id") ON DELETE CASCADE,
  "campaign_id" uuid REFERENCES "site_promo_campaigns"("id") ON DELETE CASCADE,
  "redeemed_at" timestamp DEFAULT now() NOT NULL,
  "result_type" varchar(50) NOT NULL,
  "metadata" jsonb,
  CONSTRAINT "site_promo_redemptions_check" CHECK (
    (promo_code_id IS NOT NULL AND campaign_id IS NULL) OR
    (promo_code_id IS NULL AND campaign_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "site_promo_redemptions_user_idx" ON "site_promo_redemptions" ("user_id");
CREATE INDEX IF NOT EXISTS "site_promo_redemptions_promo_code_idx" ON "site_promo_redemptions" ("promo_code_id");
CREATE INDEX IF NOT EXISTS "site_promo_redemptions_campaign_idx" ON "site_promo_redemptions" ("campaign_id");
CREATE UNIQUE INDEX IF NOT EXISTS "site_promo_redemptions_code_user_uniq" ON "site_promo_redemptions" ("promo_code_id", "user_id") WHERE promo_code_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "site_promo_redemptions_campaign_user_uniq" ON "site_promo_redemptions" ("campaign_id", "user_id") WHERE campaign_id IS NOT NULL;
