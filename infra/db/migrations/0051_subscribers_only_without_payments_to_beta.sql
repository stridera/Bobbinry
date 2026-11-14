-- Access model rework: a subscribers-only project is only valid while its
-- author can take subscriptions (Stripe onboarding complete AND at least one
-- active tier). Projects that fail that rule move to "beta readers only"
-- (project_visibility = 'private', default_visibility = 'public'), which keeps
-- the existing beta readers / access grantees in and everyone else out.
-- default_visibility = 'private' was never enforced anywhere; it maps to the
-- same state. Idempotent: re-running matches no rows.

UPDATE "project_publish_config" AS c
SET "project_visibility" = 'private',
    "default_visibility" = 'public',
    "updated_at" = NOW()
FROM "projects" AS p
WHERE p."id" = c."project_id"
  AND c."default_visibility" = 'subscribers_only'
  AND NOT EXISTS (
    SELECT 1
    FROM "user_payment_config" AS upc
    WHERE upc."user_id" = p."owner_id"
      AND upc."stripe_account_id" IS NOT NULL
      AND upc."stripe_account_id" <> ''
      AND upc."stripe_onboarding_complete" = true
      AND EXISTS (
        SELECT 1 FROM "subscription_tiers" AS t
        WHERE t."author_id" = upc."user_id" AND t."is_active" = true
      )
  );
--> statement-breakpoint
UPDATE "project_publish_config"
SET "project_visibility" = 'private',
    "default_visibility" = 'public',
    "updated_at" = NOW()
WHERE "default_visibility" = 'private';
