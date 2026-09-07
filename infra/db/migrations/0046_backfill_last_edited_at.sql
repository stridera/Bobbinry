-- entities.last_edited_at was only stamped on create until 7f912fc
-- (2026-08-06) taught the update route to set it, so rows edited before then
-- still carry their creation time and sort as never-edited in the
-- "recently edited" lists. For rows that were never stamped after creation,
-- the last content edit is best approximated by updated_at. Idempotent: rows
-- already stamped after creation are untouched, and a re-run finds nothing.
UPDATE "entities"
SET "last_edited_at" = "updated_at"
WHERE "last_edited_at" < "updated_at"
  AND "last_edited_at" <= "created_at" + interval '1 second';
