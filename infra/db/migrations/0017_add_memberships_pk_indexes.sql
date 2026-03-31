-- Add composite PK and indexes to memberships table
-- Also adds ON DELETE CASCADE to both FK references

-- Remove existing foreign keys (no CASCADE)
ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_user_id_users_id_fk";
ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_project_id_projects_id_fk";

-- Re-add foreign keys with ON DELETE CASCADE
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;

-- Add composite primary key (also enforces uniqueness and indexes user_id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'memberships_user_id_project_id_pk'
    AND conrelid = 'memberships'::regclass
  ) THEN
    ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_project_id_pk" PRIMARY KEY ("user_id", "project_id");
  END IF;
END $$;

-- Index on project_id for lookups by project
CREATE INDEX IF NOT EXISTS "memberships_project_idx" ON "memberships" ("project_id");
