-- Site snapshots: frozen versions of published sites accessible via {slug}-{snapshot}.projectsites.dev
-- Each snapshot points to a specific R2 build version, enabling A/B testing, rollback, and client review.
CREATE TABLE IF NOT EXISTS site_snapshots (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  snapshot_name TEXT NOT NULL,          -- e.g., 'v1', 'draft', 'before-redesign', 'a', 'b'
  build_version TEXT NOT NULL,          -- R2 version path (e.g., '2026-04-15T12-00-00-000Z')
  description TEXT,                     -- Optional human-readable description
  created_by TEXT,                      -- userId who created the snapshot
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  UNIQUE(site_id, snapshot_name)
);

CREATE INDEX IF NOT EXISTS idx_site_snapshots_site_id ON site_snapshots(site_id);
CREATE INDEX IF NOT EXISTS idx_site_snapshots_lookup ON site_snapshots(site_id, snapshot_name) WHERE deleted_at IS NULL;
