-- Add missing indexes to provenanceEvents, publishTargets, and bobbinsInstalled

-- provenanceEvents: index on (projectId, createdAt) for project-scoped timeline queries
CREATE INDEX IF NOT EXISTS "provenance_events_project_created_idx" ON "provenance_events" ("project_id", "created_at");

-- provenanceEvents: index on (actor, createdAt) for actor-scoped timeline queries
CREATE INDEX IF NOT EXISTS "provenance_events_actor_created_idx" ON "provenance_events" ("actor", "created_at");

-- publishTargets: index on projectId for project lookups
CREATE INDEX IF NOT EXISTS "publish_targets_project_idx" ON "publish_targets" ("project_id");

-- bobbinsInstalled: unique index on (projectId, bobbinId) to prevent duplicate installs per project
CREATE UNIQUE INDEX IF NOT EXISTS "bobbins_installed_project_bobbin_idx" ON "bobbins_installed" ("project_id", "bobbin_id");
