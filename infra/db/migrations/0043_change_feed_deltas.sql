-- Semantic deltas on the change feed.
--
-- words_added / words_removed are churn, so a consumer can distinguish a
-- revision pass from new writing without polling the feed twice and summing
-- abs(after - before). 0 and NULL differ and the distinction matters: 0 means
-- "computed, nothing changed"; NULL means "not computed" (non-content entity,
-- oversized body, or a row predating this). Historical rows stay NULL forever
-- -- the before-bodies needed to backfill them are gone.
--
-- revision_id points at the restore point holding the pre-edit state, which is
-- the handle for GET /entities/:id/diff?from=...&to=live -- the endpoint that
-- returns the actual prose that changed.
--
-- source distinguishes a restore, import or search-replace from an ordinary
-- edit. Without it a restore is an `updated` event with fieldsChanged ['body']
-- and a large delta, indistinguishable from a big paste.

ALTER TABLE "entity_changes" ADD COLUMN IF NOT EXISTS "words_added" integer;--> statement-breakpoint
ALTER TABLE "entity_changes" ADD COLUMN IF NOT EXISTS "words_removed" integer;--> statement-breakpoint
ALTER TABLE "entity_changes" ADD COLUMN IF NOT EXISTS "revision_id" uuid;--> statement-breakpoint
ALTER TABLE "entity_changes" ADD COLUMN IF NOT EXISTS "source" varchar(16);