-- Per-site structured data tables (Airtable-like data layer)
-- Stores all editable business data: services, team, hours, menu, FAQ, etc.
-- Uses a flexible JSON column (data_json) so schemas vary by business type.
-- The generated website bakes this data into static HTML at build time,
-- then polls /api/public-data/{table} for live updates.
CREATE TABLE IF NOT EXISTS site_data (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  table_name TEXT NOT NULL,           -- e.g., 'services', 'menu_items', 'team_members'
  data_json TEXT NOT NULL DEFAULT '{}', -- flexible JSON: {"name":"Haircut","price":"$25","duration":"30min"}
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  UNIQUE(id)
);

CREATE INDEX IF NOT EXISTS idx_site_data_lookup ON site_data(site_id, table_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_site_data_sort ON site_data(site_id, table_name, sort_order) WHERE deleted_at IS NULL;
