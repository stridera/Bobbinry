CREATE TABLE IF NOT EXISTS "cron_runs" (
	"job_name" varchar(100) PRIMARY KEY NOT NULL,
	"last_run_at" timestamp DEFAULT now() NOT NULL,
	"last_status" varchar(20) NOT NULL,
	"last_error" text,
	"forced" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "cron_runs" ("job_name", "last_run_at", "last_status")
	VALUES ('admin_daily_report', '1970-01-01 00:00:00', 'success')
	ON CONFLICT ("job_name") DO NOTHING;
