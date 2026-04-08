-- Add optional projectId to discount_codes for per-project scoping
ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS discount_codes_author_project_idx ON discount_codes (author_id, project_id);
