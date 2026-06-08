CREATE TABLE IF NOT EXISTS "project_manuscript_display_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"paragraph_spacing" varchar(20),
	"paragraph_indent" varchar(20),
	"code_block_wrap" boolean,
	"scene_break_style" varchar(20),
	"drop_caps" boolean,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_manuscript_display_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"paragraph_spacing" varchar(20) DEFAULT 'standard' NOT NULL,
	"paragraph_indent" varchar(20) DEFAULT 'none' NOT NULL,
	"code_block_wrap" boolean DEFAULT false NOT NULL,
	"scene_break_style" varchar(20) DEFAULT 'asterism' NOT NULL,
	"drop_caps" boolean DEFAULT false NOT NULL,
	"show_formatting_marks" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_manuscript_display_settings" ADD CONSTRAINT "project_manuscript_display_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_manuscript_display_settings" ADD CONSTRAINT "user_manuscript_display_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
