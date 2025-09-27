CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"bobbin_id" varchar(255) NOT NULL,
	"collection_name" varchar(255) NOT NULL,
	"entity_data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_project_collection_idx" ON "entities" USING btree ("project_id","collection_name");--> statement-breakpoint
CREATE INDEX "entities_search_idx" ON "entities" USING gin ("entity_data");--> statement-breakpoint
CREATE INDEX "entities_order_idx" ON "entities" USING btree ("project_id","collection_name","entity_data");