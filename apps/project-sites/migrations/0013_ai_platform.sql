-- 0013_ai_platform.sql
-- Single migration for the AI platform layer:
--   • AI form router + trace logs + chat context files + per-site settings
--   • User-defined AI endpoints (/api/ai/:slug/:endpoint) — prompt OR worker code
--   • AI credits (purchasable bundles, debited per call) + spend alerts
--   • MCP OAuth connections (MailChimp, Stripe, Resend, HubSpot, more)
--   • Team invites + members for Settings → Team

CREATE TABLE IF NOT EXISTS ai_form_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  submission_id TEXT,           -- nullable for chat/endpoint traces
  trace_kind TEXT NOT NULL,     -- 'form' | 'chat' | 'endpoint' | 'search'
  endpoint_slug TEXT,           -- when trace_kind='endpoint'
  prompt_template TEXT,
  input_json TEXT,
  output_text TEXT,
  output_json TEXT,             -- parsed tool envelope if present
  tool_name TEXT,               -- send_email | add_to_mailchimp | charge_stripe | …
  tool_args_json TEXT,
  tool_result_json TEXT,
  tool_status TEXT,             -- ok | error | skipped
  model TEXT,
  status TEXT NOT NULL,         -- ok | error | rate_limited
  error_message TEXT,
  latency_ms INTEGER,
  tokens_input INTEGER,
  tokens_output INTEGER,
  credits_debited INTEGER,      -- 1 credit per AI call by default
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_logs_site ON ai_form_logs(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_kind ON ai_form_logs(site_id, trace_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_sub ON ai_form_logs(submission_id);

CREATE TABLE IF NOT EXISTS ai_chat_context_files (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  r2_key TEXT NOT NULL,
  extracted_text TEXT,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_files_site ON ai_chat_context_files(site_id, enabled);

CREATE TABLE IF NOT EXISTS ai_site_settings (
  site_id TEXT PRIMARY KEY,
  chat_persona TEXT,
  chat_system_prompt TEXT,
  form_router_prompt TEXT,
  reply_email TEXT,             -- where contact-form messages go
  contact_email TEXT,           -- public-facing contact email (moved from old settings)
  brand_tone TEXT,
  search_synonyms_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User-defined endpoints. kind='prompt' runs an AI prompt over the request
-- body/query. kind='worker' uploads JS/TS/Python code to Workers for
-- Platforms (dispatch namespace) and dispatches the request to it.
CREATE TABLE IF NOT EXISTS ai_endpoints (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  endpoint_slug TEXT NOT NULL,  -- url path component
  display_name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL,           -- 'prompt' | 'worker'
  method TEXT NOT NULL DEFAULT 'POST',  -- 'GET' | 'POST' | 'BOTH'
  prompt_template TEXT,         -- when kind='prompt'
  worker_language TEXT,         -- 'javascript' | 'typescript' | 'python' | 'rust-wasm'
  worker_code TEXT,             -- raw user code, when kind='worker'
  wfp_script_name TEXT,         -- generated WFP script name (after upload)
  enabled INTEGER NOT NULL DEFAULT 1,
  mcp_tools_json TEXT,          -- JSON array of MCP tool names the prompt may invoke
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, endpoint_slug)
);
CREATE INDEX IF NOT EXISTS idx_ai_endpoints_site ON ai_endpoints(site_id, enabled);

-- AI Credits ledger. Topups credit +N; AI calls debit -1 (or more for big models).
CREATE TABLE IF NOT EXISTS ai_credits_balance (
  org_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  lifetime_purchased INTEGER NOT NULL DEFAULT 0,
  lifetime_consumed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_credits_ledger (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  site_id TEXT,
  delta INTEGER NOT NULL,       -- positive=topup, negative=spend
  reason TEXT NOT NULL,         -- 'topup' | 'form_router' | 'endpoint' | 'chat' | 'refund'
  stripe_session_id TEXT,
  ai_log_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credits_ledger_org ON ai_credits_ledger(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS spend_alerts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  threshold_credits INTEGER NOT NULL,  -- alert when remaining balance < this OR daily burn > this
  alert_kind TEXT NOT NULL,            -- 'balance_low' | 'daily_burn'
  notify_email TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_triggered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spend_alerts_org ON spend_alerts(org_id, enabled);

-- MCP OAuth connections. One row per (site, provider).
-- Token is encrypted at rest by the worker before insert.
CREATE TABLE IF NOT EXISTS mcp_connections (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  provider TEXT NOT NULL,       -- 'mailchimp' | 'stripe' | 'resend' | 'hubspot'
  display_name TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_expires_at TEXT,
  account_metadata_json TEXT,   -- provider-specific (e.g. mailchimp dc, hubspot portalId)
  scopes_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'revoked' | 'expired'
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_mcp_site ON mcp_connections(site_id, status);

-- OAuth state for CSRF in the MCP flow.
CREATE TABLE IF NOT EXISTS mcp_oauth_states (
  state TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  code_verifier TEXT,           -- PKCE
  return_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Team management (Settings → Team).
CREATE TABLE IF NOT EXISTS team_invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,           -- 'owner' | 'editor' | 'viewer'
  invite_token TEXT NOT NULL UNIQUE,
  invited_by_user_id TEXT,
  accepted_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_team_invites_org ON team_invites(org_id, accepted_at);

-- Per-site cost rollup (denormalized view, refreshed by cron).
CREATE TABLE IF NOT EXISTS site_cost_daily (
  site_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  day TEXT NOT NULL,            -- YYYY-MM-DD
  ai_credits INTEGER NOT NULL DEFAULT 0,
  ai_calls INTEGER NOT NULL DEFAULT 0,
  bandwidth_bytes INTEGER NOT NULL DEFAULT 0,
  storage_bytes INTEGER NOT NULL DEFAULT 0,
  estimated_cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, day)
);
CREATE INDEX IF NOT EXISTS idx_site_cost_org_day ON site_cost_daily(org_id, day DESC);
