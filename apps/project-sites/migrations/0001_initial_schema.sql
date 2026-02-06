-- Project Sites: D1 (SQLite) schema
-- Ported from Supabase/Postgres. All tables include soft deletes and timestamps.
-- D1 does not support triggers; updated_at is set by application code.

-- ─── Orgs ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 3 AND 63),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orgs_slug ON orgs (slug) WHERE deleted_at IS NULL;

-- ─── Users ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone) WHERE deleted_at IS NULL;

-- ─── Memberships ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  billing_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  UNIQUE (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships (org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships (user_id) WHERE deleted_at IS NULL;

-- ─── Sites ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 3 AND 63),
  business_name TEXT NOT NULL CHECK (length(business_name) BETWEEN 1 AND 200),
  business_phone TEXT,
  business_email TEXT,
  business_address TEXT,
  google_place_id TEXT,
  bolt_chat_id TEXT,
  current_build_version TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'building', 'published', 'archived')),
  lighthouse_score INTEGER CHECK (lighthouse_score IS NULL OR (lighthouse_score >= 0 AND lighthouse_score <= 100)),
  lighthouse_last_run TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sites_org ON sites (org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sites_slug ON sites (slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sites_place_id ON sites (google_place_id) WHERE deleted_at IS NULL;

-- ─── Hostnames ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hostnames (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  hostname TEXT NOT NULL UNIQUE CHECK (length(hostname) BETWEEN 3 AND 253),
  type TEXT NOT NULL CHECK (type IN ('free_subdomain', 'custom_cname')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'moved', 'deleted', 'pending_deletion', 'verification_failed')),
  cf_custom_hostname_id TEXT,
  ssl_status TEXT NOT NULL DEFAULT 'pending' CHECK (ssl_status IN ('pending', 'active', 'error', 'unknown')),
  verification_errors TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hostnames_site ON hostnames (site_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostnames_hostname ON hostnames (hostname) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostnames_org ON hostnames (org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostnames_pending ON hostnames (status) WHERE status = 'pending' AND deleted_at IS NULL;

-- ─── Subscriptions ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'paid')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'unpaid', 'trialing', 'incomplete', 'incomplete_expired', 'paused')),
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  retention_offer_applied INTEGER NOT NULL DEFAULT 0,
  dunning_stage INTEGER NOT NULL DEFAULT 0,
  last_payment_at TEXT,
  last_payment_failed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions (org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions (stripe_customer_id) WHERE deleted_at IS NULL;

-- ─── Sessions ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  device_info TEXT,
  ip_address TEXT,
  expires_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token_hash) WHERE deleted_at IS NULL;

-- ─── Magic Links ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  redirect_url TEXT,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links (token_hash) WHERE used = 0;
CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links (email);

-- ─── Phone OTPs ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS phone_otps (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_phone_otps_phone ON phone_otps (phone, verified, expires_at);

-- ─── OAuth States ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  redirect_url TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states (state);

-- ─── Webhook Events ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES orgs(id),
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'dub', 'chatwoot', 'novu', 'lago')),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_pointer TEXT,
  payload_hash TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'processed', 'failed', 'quarantined')),
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  UNIQUE (provider, event_id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_event ON webhook_events (provider, event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events (status) WHERE status IN ('received', 'processing');

-- ─── Audit Logs (append-only) ────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT,
  ip_address TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id) WHERE actor_id IS NOT NULL;

-- ─── Workflow Jobs ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflow_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  site_id TEXT REFERENCES sites(id),
  job_name TEXT NOT NULL,
  dedupe_key TEXT,
  payload_pointer TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT,
  result_pointer TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workflow_jobs_org ON workflow_jobs (org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_jobs_status ON workflow_jobs (status) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_workflow_jobs_dedupe ON workflow_jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ─── Research Data ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS research_data (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  task_name TEXT NOT NULL,
  raw_output TEXT NOT NULL,
  parsed_output TEXT,
  confidence INTEGER NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  source_urls TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_research_data_site ON research_data (site_id) WHERE deleted_at IS NULL;

-- ─── Feature Flags ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES orgs(id),
  flag_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  UNIQUE (org_id, flag_name)
);
CREATE INDEX IF NOT EXISTS idx_feature_flags_org ON feature_flags (org_id) WHERE deleted_at IS NULL;

-- ─── Confidence Attributes ───────────────────────────────────

CREATE TABLE IF NOT EXISTS confidence_attributes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  attribute_name TEXT NOT NULL,
  attribute_value TEXT NOT NULL,
  confidence INTEGER NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  source TEXT NOT NULL,
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_confidence_attributes_site ON confidence_attributes (site_id) WHERE deleted_at IS NULL;
