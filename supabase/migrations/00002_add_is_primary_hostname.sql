-- Migration: Add is_primary column to hostnames table
-- Purpose: Allow users to designate one hostname as the primary domain for each site
-- The primary domain is used as the default URL wherever the site is referenced

ALTER TABLE hostnames ADD COLUMN is_primary INTEGER DEFAULT 0;

-- Create index for efficient primary lookup per site
CREATE INDEX IF NOT EXISTS idx_hostnames_primary ON hostnames (site_id, is_primary) WHERE deleted_at IS NULL;
