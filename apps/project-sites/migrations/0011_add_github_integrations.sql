-- ─── GitHub Backup Integrations ──────────────────────────────
--
-- Per-site GitHub OAuth backup. Each site can be connected to ONE GitHub
-- account; the connection persists an `access_token` + auto-derived repo
-- `{slug}-projectsites-dev` (no user-supplied repo name). Triggering a
-- backup pulls the published R2 build (`sites/{slug}/{current_build_version}/`)
-- and commits it to the repo via the GitHub REST API.
--
-- The OAuth init flow uses a dedicated `github_backup_states` table rather
-- than reusing `oauth_states` because the existing CHECK constraint locks
-- `oauth_states.provider` to `('google')` and per-site state needs a
-- `site_id` foreign key that doesn't fit the user-auth model.

CREATE TABLE IF NOT EXISTS github_backup_states (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  state TEXT NOT NULL UNIQUE,
  return_url TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_github_backup_states_state ON github_backup_states (state);
CREATE INDEX IF NOT EXISTS idx_github_backup_states_site ON github_backup_states (site_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS github_integrations (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL UNIQUE REFERENCES sites(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  access_token_encrypted TEXT NOT NULL,
  github_user TEXT NOT NULL,
  github_user_id INTEGER NOT NULL,
  github_avatar_url TEXT,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  repo_html_url TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  last_backup_at TEXT,
  last_commit_sha TEXT,
  commit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_github_integrations_site ON github_integrations (site_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_github_integrations_org ON github_integrations (org_id) WHERE deleted_at IS NULL;
