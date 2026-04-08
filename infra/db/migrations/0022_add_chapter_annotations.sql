-- Chapter annotations - reader feedback anchored to text
CREATE TABLE IF NOT EXISTS "chapter_annotations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "chapter_id" uuid NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "anchor_paragraph_index" integer,
  "anchor_quote" text NOT NULL,
  "anchor_char_offset" integer,
  "anchor_char_length" integer,
  "annotation_type" varchar(50) NOT NULL,
  "error_category" varchar(50),
  "content" text NOT NULL,
  "suggested_text" text,
  "status" varchar(50) DEFAULT 'open' NOT NULL,
  "author_response" text,
  "resolved_at" timestamp,
  "resolved_by" uuid REFERENCES "users"("id"),
  "chapter_version" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "chapter_annotations_chapter_idx" ON "chapter_annotations" ("chapter_id");
CREATE INDEX IF NOT EXISTS "chapter_annotations_project_idx" ON "chapter_annotations" ("project_id");
CREATE INDEX IF NOT EXISTS "chapter_annotations_author_idx" ON "chapter_annotations" ("author_id");
CREATE INDEX IF NOT EXISTS "chapter_annotations_status_idx" ON "chapter_annotations" ("status");
CREATE INDEX IF NOT EXISTS "chapter_annotations_project_status_idx" ON "chapter_annotations" ("project_id", "status");

-- Add annotation config to project_publish_config
ALTER TABLE "project_publish_config" ADD COLUMN IF NOT EXISTS "enable_annotations" boolean DEFAULT false NOT NULL;
ALTER TABLE "project_publish_config" ADD COLUMN IF NOT EXISTS "annotation_access" varchar(50) DEFAULT 'beta_only' NOT NULL;
