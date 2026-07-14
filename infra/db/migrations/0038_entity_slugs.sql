CREATE TABLE IF NOT EXISTS "entity_slugs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"slug" varchar(160) NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "entity_slugs" ADD CONSTRAINT "entity_slugs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "entity_slugs" ADD CONSTRAINT "entity_slugs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_slugs_project_slug_unique" ON "entity_slugs" USING btree ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_slugs_entity_current_unique" ON "entity_slugs" USING btree ("project_id","entity_id") WHERE is_current;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_slugs_entity_idx" ON "entity_slugs" USING btree ("entity_id");
