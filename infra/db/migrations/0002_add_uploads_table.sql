CREATE TABLE IF NOT EXISTS "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"s3_key" text NOT NULL,
	"filename" text,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"context" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_bobbins_installed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bobbin_id" varchar(255) NOT NULL,
	"bobbin_type" varchar(50) NOT NULL,
	"config" jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "entities_order_idx";--> statement-breakpoint
ALTER TABLE "project_collections" ALTER COLUMN "short_url" SET DATA TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "short_url" SET DATA TYPE varchar(120);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "uploads" ADD CONSTRAINT "uploads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_bobbins_installed" ADD CONSTRAINT "user_bobbins_installed_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uploads_project_idx" ON "uploads" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uploads_user_idx" ON "uploads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uploads_status_idx" ON "uploads" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_bobbins_installed_user_idx" ON "user_bobbins_installed" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_bobbins_installed_user_bobbin_idx" ON "user_bobbins_installed" USING btree ("user_id","bobbin_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_order_idx" ON "entities" USING btree ("project_id","collection_name",(entity_data->>'order'));
