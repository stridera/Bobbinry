CREATE TABLE IF NOT EXISTS "entity_changes" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"collection" varchar(255) NOT NULL,
	"content_type" varchar(32),
	"title" text,
	"action" varchar(20) NOT NULL,
	"fields_changed" text[] DEFAULT '{}'::text[] NOT NULL,
	"word_count_before" integer,
	"word_count_after" integer,
	"actor" varchar(255),
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "entity_changes" ADD CONSTRAINT "entity_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_changes_project_seq_idx" ON "entity_changes" USING btree ("project_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_changes_project_entity_seq_idx" ON "entity_changes" USING btree ("project_id","entity_id","seq");
