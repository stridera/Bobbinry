-- Add stripe_account_type column to user_payment_config
ALTER TABLE "user_payment_config" ADD COLUMN IF NOT EXISTS "stripe_account_type" varchar(20);
