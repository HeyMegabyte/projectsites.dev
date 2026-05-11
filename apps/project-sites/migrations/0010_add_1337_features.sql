-- Migration 0010: 1337 feature layer
-- Adds iteration snapshots, terminal sessions, build stream state, diff artworks, changelog audio.
-- Driven by: Brian 2026-05-10 "implement all top recommendations" 1337 brainstorm.

-- ----------------------------------------------------------------------------
-- iteration_snapshots — historical per-iteration screenshot + lighthouse trace
-- Powers /showcase/:slug/replay scrubber (1337 LAYER #3).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iteration_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  screenshot_r2_key TEXT NOT NULL,
  thumb_r2_key TEXT,
  taken_at TEXT NOT NULL DEFAULT (datetime('now')),
  lighthouse_perf INTEGER,
  lighthouse_a11y INTEGER,
  lighthouse_seo INTEGER,
  lighthouse_best_practices INTEGER,
  delight_count INTEGER NOT NULL DEFAULT 0,
  applied_goodies_json TEXT,
  changelog_audio_r2_key TEXT,
  changelog_script_r2_key TEXT,
  diff_art_phone_r2_key TEXT,
  diff_art_desktop_r2_key TEXT,
  diff_art_og_r2_key TEXT,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  UNIQUE(site_id, iteration)
);

CREATE INDEX IF NOT EXISTS idx_iteration_snapshots_site
  ON iteration_snapshots(site_id, iteration DESC);

-- ----------------------------------------------------------------------------
-- terminal_sessions — owner-only WebContainer shell audit trail
-- Powers /_terminal route (1337 LAYER #6).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS terminal_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  session_token_hash TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_command_at TEXT,
  ended_at TEXT,
  command_count INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT,
  user_agent_hash TEXT,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  UNIQUE(session_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_terminal_sessions_site
  ON terminal_sessions(site_id, started_at DESC);

CREATE TABLE IF NOT EXISTS terminal_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  command TEXT NOT NULL,
  exit_code INTEGER,
  output_truncated TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES terminal_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_terminal_commands_session
  ON terminal_commands(session_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- build_stream_state — denormalized in-flight progress for /build/:slug/live SSE
-- Powers live SSE build stream (1337 LAYER #2). Source of truth is audit_logs;
-- this row is a fast-path cache so SSE doesn't full-scan the audit table.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS build_stream_state (
  site_id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  step TEXT,
  percent INTEGER NOT NULL DEFAULT 0,
  current_subagent TEXT,
  current_skill_id TEXT,
  log_tail TEXT,
  delight_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  terminal_at TEXT,
  terminal_status TEXT,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------------------------
-- diff_artworks — per-iteration deterministic generative art outputs
-- Powers diff-as-art generative artwork (1337 LAYER #5). R2 keys stored on
-- iteration_snapshots; this table holds metadata + share counters.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diff_artworks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  seed_hash TEXT NOT NULL,
  brand_primary TEXT NOT NULL,
  files_changed INTEGER NOT NULL DEFAULT 0,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  churn_score REAL NOT NULL DEFAULT 0,
  share_count INTEGER NOT NULL DEFAULT 0,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  UNIQUE(site_id, iteration)
);

-- ----------------------------------------------------------------------------
-- experience_sessions — visitor-facing immersive AI experience usage log
-- Powers 8 immersive experiences (Ask the Founder, Generate Infographic, etc).
-- Codified alongside 1337 features since they share budget_remaining_cents.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS experience_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  experience_name TEXT NOT NULL,
  visitor_ip_hash TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  output_r2_key TEXT,
  upvote_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_experience_sessions_site
  ON experience_sessions(site_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- sites table additions — iteration tracking + gamification surface
-- ----------------------------------------------------------------------------
ALTER TABLE sites ADD COLUMN last_build_started_at TEXT;
ALTER TABLE sites ADD COLUMN audio_changelog_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sites ADD COLUMN diff_art_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sites ADD COLUMN audio_reactive_hero_enabled INTEGER NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------------
-- builds table additions — per-build feature flags
-- ----------------------------------------------------------------------------
ALTER TABLE builds ADD COLUMN experiences_enabled TEXT;
ALTER TABLE builds ADD COLUMN server_timing_emitted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE builds ADD COLUMN konami_console_shipped INTEGER NOT NULL DEFAULT 0;
