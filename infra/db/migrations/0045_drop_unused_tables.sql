-- export_configs, author_notes and publish_targets were created in 0000 and
-- never referenced by any route, job, bobbin or package. Idempotent so a
-- re-run (or an environment where they were already dropped) is a no-op.
DROP TABLE IF EXISTS "author_notes" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "export_configs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "publish_targets" CASCADE;
