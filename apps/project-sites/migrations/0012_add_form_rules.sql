-- Migration 0012: Form Rules (AI engine) + Form API Keys (generic integration credentials)
--
-- Two tables:
--   - form_rules:    AI prompts that evaluate every form_submissions row and emit actions
--                    (forward to slack, create notion page, call generic webhook, send email, etc.)
--   - form_api_keys: Generic API credential vault for any third-party integration the AI engine
--                    may invoke (broader than newsletter_integrations, which is locked to a 6-provider CHECK).
--
-- Both tables are org-scoped, soft-deletable, and indexed by site_id with a deleted_at filter.

CREATE TABLE IF NOT EXISTS form_rules (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '@cf/meta/llama-3.1-8b-instruct',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  trigger_form_name TEXT,
  last_evaluated_at TEXT,
  last_actions_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  total_evaluations INTEGER NOT NULL DEFAULT 0,
  total_actions INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_form_rules_site_id
  ON form_rules(site_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_form_rules_org_id
  ON form_rules(org_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_form_rules_enabled
  ON form_rules(site_id, enabled, priority)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS form_api_keys (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  api_key_preview TEXT NOT NULL,
  config TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  last_error TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_form_api_keys_site_id
  ON form_api_keys(site_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_form_api_keys_org_id
  ON form_api_keys(org_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_form_api_keys_provider
  ON form_api_keys(site_id, provider)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS form_rule_evaluations (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES form_rules(id),
  submission_id TEXT NOT NULL REFERENCES form_submissions(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'skipped')),
  actions_planned INTEGER NOT NULL DEFAULT 0,
  actions_executed INTEGER NOT NULL DEFAULT 0,
  actions_failed INTEGER NOT NULL DEFAULT 0,
  actions_json TEXT,
  reasoning TEXT,
  error TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_form_rule_evaluations_rule_id
  ON form_rule_evaluations(rule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_form_rule_evaluations_submission_id
  ON form_rule_evaluations(submission_id);

CREATE INDEX IF NOT EXISTS idx_form_rule_evaluations_site_id
  ON form_rule_evaluations(site_id, created_at DESC);
