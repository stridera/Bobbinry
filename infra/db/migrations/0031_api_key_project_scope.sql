ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "project_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_project_idx" ON "api_keys" USING btree ("project_id");--> statement-breakpoint
UPDATE "api_keys"
SET "scopes" = "scopes" || '["manuscript:read"]'::jsonb
WHERE "scopes" ? 'entities:read' AND NOT ("scopes" ? 'manuscript:read');--> statement-breakpoint
UPDATE "api_keys"
SET "scopes" = "scopes" || '["manuscript:write"]'::jsonb
WHERE "scopes" ? 'entities:write' AND NOT ("scopes" ? 'manuscript:write');
