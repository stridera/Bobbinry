-- Add admin-controlled configuration fields to bobbins_installed
-- These fields control execution and storage decisions and are NOT set from manifests

ALTER TABLE bobbins_installed 
  ADD COLUMN execution_mode VARCHAR(50) DEFAULT 'sandboxed' NOT NULL,
  ADD COLUMN trust_level VARCHAR(50) DEFAULT 'community' NOT NULL,
  ADD COLUMN storage_tier VARCHAR(50) DEFAULT 'tier1' NOT NULL,
  ADD COLUMN config_updated_by UUID REFERENCES users(id),
  ADD COLUMN config_updated_at TIMESTAMPTZ;

-- Add check constraints for valid values
ALTER TABLE bobbins_installed
  ADD CONSTRAINT execution_mode_check CHECK (execution_mode IN ('sandboxed', 'native'));

ALTER TABLE bobbins_installed
  ADD CONSTRAINT trust_level_check CHECK (trust_level IN ('first-party', 'verified', 'community'));

ALTER TABLE bobbins_installed
  ADD CONSTRAINT storage_tier_check CHECK (storage_tier IN ('tier1', 'tier2'));

-- Update existing rows to have default values (already handled by DEFAULT clause)
-- But let's explicitly set first-party bobbins if we can identify them
UPDATE bobbins_installed 
SET 
  execution_mode = 'native',
  trust_level = 'first-party',
  storage_tier = 'tier2'
WHERE bobbin_id = 'manuscript';

-- Add index for querying by execution mode and trust level
CREATE INDEX idx_bobbins_installed_config ON bobbins_installed(execution_mode, trust_level, storage_tier);