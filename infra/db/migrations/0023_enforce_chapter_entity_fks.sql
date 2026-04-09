-- Enforce chapter/entity FKs at the database level.
--
-- Several tables had `chapter_id` / `entity_id` columns that were commented in
-- the schema as "FK to entities table" but had no actual `REFERENCES` clause,
-- so orphan rows were possible and `DELETE FROM entities` did not cascade.
-- This migration cleans up any orphans, adds the missing FK constraints with
-- ON DELETE CASCADE, and adds single-column indexes where lookups by the FK
-- column alone are common (the existing composite indexes only cover lookups
-- where the leading column is also filtered).
--
-- Idempotent — uses IF NOT EXISTS for indexes and DO/EXCEPTION blocks for
-- ADD CONSTRAINT, per infra/db/migrations/README.md and CLAUDE.md.

-- ─── Orphan cleanup ──────────────────────────────────────────────────
-- Delete rows referencing entity ids that no longer exist. These rows are
-- already broken (the chapter they point at is gone) and serve no purpose.
DELETE FROM "embargo_schedules"   WHERE "entity_id"  NOT IN (SELECT "id" FROM "entities");
DELETE FROM "publish_snapshots"   WHERE "entity_id"  NOT IN (SELECT "id" FROM "entities");
DELETE FROM "chapter_publications" WHERE "chapter_id" NOT IN (SELECT "id" FROM "entities");
DELETE FROM "chapter_views"       WHERE "chapter_id" NOT IN (SELECT "id" FROM "entities");
DELETE FROM "comments"            WHERE "chapter_id" NOT IN (SELECT "id" FROM "entities");
DELETE FROM "reactions"           WHERE "chapter_id" NOT IN (SELECT "id" FROM "entities");
DELETE FROM "author_notes"        WHERE "chapter_id" NOT IN (SELECT "id" FROM "entities");
DELETE FROM "chapter_annotations" WHERE "chapter_id" NOT IN (SELECT "id" FROM "entities");
DELETE FROM "access_grants"       WHERE "chapter_id" IS NOT NULL AND "chapter_id" NOT IN (SELECT "id" FROM "entities");

-- ─── Add FK constraints ──────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "embargo_schedules"
    ADD CONSTRAINT "embargo_schedules_entity_id_entities_id_fk"
    FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "publish_snapshots"
    ADD CONSTRAINT "publish_snapshots_entity_id_entities_id_fk"
    FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chapter_publications"
    ADD CONSTRAINT "chapter_publications_chapter_id_entities_id_fk"
    FOREIGN KEY ("chapter_id") REFERENCES "entities"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chapter_views"
    ADD CONSTRAINT "chapter_views_chapter_id_entities_id_fk"
    FOREIGN KEY ("chapter_id") REFERENCES "entities"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "comments"
    ADD CONSTRAINT "comments_chapter_id_entities_id_fk"
    FOREIGN KEY ("chapter_id") REFERENCES "entities"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reactions"
    ADD CONSTRAINT "reactions_chapter_id_entities_id_fk"
    FOREIGN KEY ("chapter_id") REFERENCES "entities"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "author_notes"
    ADD CONSTRAINT "author_notes_chapter_id_entities_id_fk"
    FOREIGN KEY ("chapter_id") REFERENCES "entities"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chapter_annotations"
    ADD CONSTRAINT "chapter_annotations_chapter_id_entities_id_fk"
    FOREIGN KEY ("chapter_id") REFERENCES "entities"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "access_grants"
    ADD CONSTRAINT "access_grants_chapter_id_entities_id_fk"
    FOREIGN KEY ("chapter_id") REFERENCES "entities"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Add missing single-column indexes ───────────────────────────────
-- These tables already have composite indexes that lead with project_id,
-- so lookups by chapter_id / entity_id alone fall back to a sequential
-- scan. Add covering single-column indexes for the FK lookups that the
-- new constraints rely on (and which `reader.ts` queries hit per chapter).
CREATE INDEX IF NOT EXISTS "embargo_schedules_entity_idx"  ON "embargo_schedules"   ("entity_id");
CREATE INDEX IF NOT EXISTS "chapter_publications_chapter_idx" ON "chapter_publications" ("chapter_id");
CREATE INDEX IF NOT EXISTS "access_grants_chapter_idx"     ON "access_grants"       ("chapter_id");
