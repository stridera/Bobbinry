CREATE TABLE "project_follows" (
	"follower_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_follows" ADD CONSTRAINT "project_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_follows" ADD CONSTRAINT "project_follows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_follows_follower_idx" ON "project_follows" USING btree ("follower_id");--> statement-breakpoint
CREATE INDEX "project_follows_project_idx" ON "project_follows" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_follows_follower_project_idx" ON "project_follows" USING btree ("follower_id","project_id");