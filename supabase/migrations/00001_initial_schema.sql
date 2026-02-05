-- Project Sites: Initial multi-tenant schema
-- Every table includes org_id, created_at, updated_at, deleted_at (soft delete)
-- RLS enabled on all tables

-- ─── Helper: auto-update updated_at ──────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Orgs ────────────────────────────────────────────────────

CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' AND char_length(slug) BETWEEN 3 AND 63),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_orgs_slug ON orgs (slug) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_orgs_updated_at BEFORE UPDATE ON orgs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;

-- ─── Users ───────────────────────────────────────────────────

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE CHECK (email IS NULL OR char_length(email) <= 254),
  phone TEXT CHECK (phone IS NULL OR phone ~ '^\+[1-9]\d{1,14}$'),
  display_name TEXT CHECK (display_name IS NULL OR char_length(display_name) <= 200),
  avatar_url TEXT CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 2048),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_users_email ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_phone ON users (phone) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ─── Memberships ─────────────────────────────────────────────

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')) DEFAULT 'member',
  billing_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id, user_id)
);
CREATE INDEX idx_memberships_org ON memberships (org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_memberships_user ON memberships (user_id) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_memberships_updated_at BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

-- ─── Sites ───────────────────────────────────────────────────

CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' AND char_length(slug) BETWEEN 3 AND 63),
  business_name TEXT NOT NULL CHECK (char_length(business_name) BETWEEN 1 AND 200),
  business_phone TEXT CHECK (business_phone IS NULL OR char_length(business_phone) <= 20),
  business_email TEXT CHECK (business_email IS NULL OR char_length(business_email) <= 254),
  business_address TEXT CHECK (business_address IS NULL OR char_length(business_address) <= 500),
  google_place_id TEXT CHECK (google_place_id IS NULL OR char_length(google_place_id) <= 255),
  bolt_chat_id TEXT CHECK (bolt_chat_id IS NULL OR char_length(bolt_chat_id) <= 255),
  current_build_version TEXT CHECK (current_build_version IS NULL OR char_length(current_build_version) <= 100),
  status TEXT NOT NULL CHECK (status IN ('draft', 'building', 'published', 'archived')) DEFAULT 'draft',
  lighthouse_score INT CHECK (lighthouse_score IS NULL OR (lighthouse_score >= 0 AND lighthouse_score <= 100)),
  lighthouse_last_run TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_sites_org ON sites (org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sites_slug ON sites (slug) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_sites_updated_at BEFORE UPDATE ON sites FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

-- ─── Hostnames ───────────────────────────────────────────────

CREATE TABLE hostnames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  hostname TEXT NOT NULL UNIQUE CHECK (char_length(hostname) BETWEEN 3 AND 253),
  type TEXT NOT NULL CHECK (type IN ('free_subdomain', 'custom_cname')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'moved', 'deleted', 'pending_deletion', 'verification_failed')) DEFAULT 'pending',
  cf_custom_hostname_id TEXT CHECK (cf_custom_hostname_id IS NULL OR char_length(cf_custom_hostname_id) <= 255),
  ssl_status TEXT NOT NULL CHECK (ssl_status IN ('pending', 'active', 'error', 'unknown')) DEFAULT 'pending',
  verification_errors JSONB,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_hostnames_site ON hostnames (site_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_hostnames_hostname ON hostnames (hostname) WHERE deleted_at IS NULL;
CREATE INDEX idx_hostnames_org ON hostnames (org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_hostnames_pending ON hostnames (status) WHERE status = 'pending' AND deleted_at IS NULL;
CREATE TRIGGER trg_hostnames_updated_at BEFORE UPDATE ON hostnames FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE hostnames ENABLE ROW LEVEL SECURITY;

-- ─── Subscriptions ───────────────────────────────────────────

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) UNIQUE,
  stripe_customer_id TEXT NOT NULL CHECK (char_length(stripe_customer_id) <= 255),
  stripe_subscription_id TEXT CHECK (stripe_subscription_id IS NULL OR char_length(stripe_subscription_id) <= 255),
  plan TEXT NOT NULL CHECK (plan IN ('free', 'paid')) DEFAULT 'free',
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'unpaid', 'trialing', 'incomplete', 'incomplete_expired', 'paused')) DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  retention_offer_applied BOOLEAN NOT NULL DEFAULT false,
  dunning_stage INT NOT NULL DEFAULT 0 CHECK (dunning_stage >= 0 AND dunning_stage <= 60),
  last_payment_at TIMESTAMPTZ,
  last_payment_failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_subscriptions_org ON subscriptions (org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions (stripe_customer_id) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- ─── Sessions ────────────────────────────────────────────────

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL CHECK (char_length(token_hash) <= 128),
  device_info TEXT CHECK (device_info IS NULL OR char_length(device_info) <= 500),
  ip_address TEXT CHECK (ip_address IS NULL OR char_length(ip_address) <= 45),
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_sessions_user ON sessions (user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sessions_token ON sessions (token_hash) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- ─── Magic Links ─────────────────────────────────────────────

CREATE TABLE magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL CHECK (char_length(email) <= 254),
  token_hash TEXT NOT NULL CHECK (char_length(token_hash) <= 128),
  redirect_url TEXT CHECK (redirect_url IS NULL OR char_length(redirect_url) <= 2048),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_magic_links_token ON magic_links (token_hash) WHERE used = false;
CREATE INDEX idx_magic_links_email ON magic_links (email);
CREATE TRIGGER trg_magic_links_updated_at BEFORE UPDATE ON magic_links FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE magic_links ENABLE ROW LEVEL SECURITY;

-- ─── Phone OTPs ──────────────────────────────────────────────

CREATE TABLE phone_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL CHECK (phone ~ '^\+[1-9]\d{1,14}$'),
  otp_hash TEXT NOT NULL CHECK (char_length(otp_hash) <= 128),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_phone_otps_phone ON phone_otps (phone, verified, expires_at);
CREATE TRIGGER trg_phone_otps_updated_at BEFORE UPDATE ON phone_otps FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE phone_otps ENABLE ROW LEVEL SECURITY;

-- ─── OAuth States ────────────────────────────────────────────

CREATE TABLE oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL UNIQUE CHECK (char_length(state) <= 128),
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  redirect_url TEXT CHECK (redirect_url IS NULL OR char_length(redirect_url) <= 2048),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_oauth_states_state ON oauth_states (state);
CREATE TRIGGER trg_oauth_states_updated_at BEFORE UPDATE ON oauth_states FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;

-- ─── Webhook Events ──────────────────────────────────────────

CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id),
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'dub', 'chatwoot', 'novu', 'lago')),
  event_id TEXT NOT NULL CHECK (char_length(event_id) <= 500),
  event_type TEXT NOT NULL CHECK (char_length(event_type) <= 200),
  payload_pointer TEXT CHECK (payload_pointer IS NULL OR char_length(payload_pointer) <= 2048),
  payload_hash TEXT CHECK (payload_hash IS NULL OR char_length(payload_hash) <= 128),
  status TEXT NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'failed', 'quarantined')) DEFAULT 'received',
  error_message TEXT CHECK (error_message IS NULL OR char_length(error_message) <= 2000),
  attempts INT NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (provider, event_id)
);
CREATE INDEX idx_webhook_events_provider_event ON webhook_events (provider, event_id);
CREATE INDEX idx_webhook_events_status ON webhook_events (status) WHERE status IN ('received', 'processing');
CREATE TRIGGER trg_webhook_events_updated_at BEFORE UPDATE ON webhook_events FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- ─── Audit Logs (append-only) ────────────────────────────────

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  target_type TEXT CHECK (target_type IS NULL OR char_length(target_type) <= 100),
  target_id UUID,
  metadata_json JSONB,
  ip_address TEXT CHECK (ip_address IS NULL OR char_length(ip_address) <= 45),
  request_id TEXT CHECK (request_id IS NULL OR char_length(request_id) <= 255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_org ON audit_logs (org_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id) WHERE actor_id IS NOT NULL;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ─── Feature Flags ───────────────────────────────────────────

CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id),
  flag_name TEXT NOT NULL CHECK (char_length(flag_name) BETWEEN 1 AND 100),
  enabled BOOLEAN NOT NULL DEFAULT false,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id, flag_name)
);
CREATE INDEX idx_feature_flags_org ON feature_flags (org_id) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_feature_flags_updated_at BEFORE UPDATE ON feature_flags FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- ─── Admin Settings ──────────────────────────────────────────

CREATE TABLE admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE CHECK (char_length(key) BETWEEN 1 AND 100),
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE TRIGGER trg_admin_settings_updated_at BEFORE UPDATE ON admin_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

-- ─── Confidence Attributes ───────────────────────────────────

CREATE TABLE confidence_attributes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  attribute_name TEXT NOT NULL CHECK (char_length(attribute_name) <= 100),
  attribute_value TEXT NOT NULL CHECK (char_length(attribute_value) <= 2000),
  confidence INT NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  source TEXT NOT NULL CHECK (char_length(source) <= 500),
  rationale TEXT CHECK (rationale IS NULL OR char_length(rationale) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_confidence_attributes_site ON confidence_attributes (site_id) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_confidence_attributes_updated_at BEFORE UPDATE ON confidence_attributes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE confidence_attributes ENABLE ROW LEVEL SECURITY;

-- ─── Research Data ───────────────────────────────────────────

CREATE TABLE research_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  task_name TEXT NOT NULL CHECK (char_length(task_name) <= 100),
  raw_output TEXT NOT NULL CHECK (char_length(raw_output) <= 65536),
  parsed_output JSONB,
  confidence INT NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  source_urls JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_research_data_site ON research_data (site_id) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_research_data_updated_at BEFORE UPDATE ON research_data FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE research_data ENABLE ROW LEVEL SECURITY;

-- ─── Lighthouse Runs ─────────────────────────────────────────

CREATE TABLE lighthouse_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  score INT NOT NULL CHECK (score >= 0 AND score <= 100),
  performance_score INT CHECK (performance_score IS NULL OR (performance_score >= 0 AND performance_score <= 100)),
  accessibility_score INT CHECK (accessibility_score IS NULL OR (accessibility_score >= 0 AND accessibility_score <= 100)),
  best_practices_score INT CHECK (best_practices_score IS NULL OR (best_practices_score >= 0 AND best_practices_score <= 100)),
  seo_score INT CHECK (seo_score IS NULL OR (seo_score >= 0 AND seo_score <= 100)),
  result_json JSONB,
  build_version TEXT CHECK (build_version IS NULL OR char_length(build_version) <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_lighthouse_runs_site ON lighthouse_runs (site_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_lighthouse_runs_updated_at BEFORE UPDATE ON lighthouse_runs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE lighthouse_runs ENABLE ROW LEVEL SECURITY;

-- ─── Analytics Daily ─────────────────────────────────────────

CREATE TABLE analytics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  date DATE NOT NULL,
  page_views INT NOT NULL DEFAULT 0,
  unique_visitors INT NOT NULL DEFAULT 0,
  bandwidth_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (site_id, date)
);
CREATE INDEX idx_analytics_daily_site_date ON analytics_daily (site_id, date DESC);
CREATE TRIGGER trg_analytics_daily_updated_at BEFORE UPDATE ON analytics_daily FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE analytics_daily ENABLE ROW LEVEL SECURITY;

-- ─── Funnel Events ───────────────────────────────────────────

CREATE TABLE funnel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  user_id UUID REFERENCES users(id),
  site_id UUID REFERENCES sites(id),
  event_name TEXT NOT NULL CHECK (event_name IN ('signup_started', 'signup_completed', 'site_created', 'first_publish', 'first_payment', 'invite_sent', 'invite_accepted', 'churned')),
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_funnel_events_org ON funnel_events (org_id, created_at DESC);
CREATE INDEX idx_funnel_events_event ON funnel_events (event_name, created_at DESC);
ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;

-- ─── Usage Events (internal metering) ────────────────────────

CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  event_type TEXT NOT NULL CHECK (char_length(event_type) <= 100),
  quantity INT NOT NULL DEFAULT 0,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_events_org ON usage_events (org_id, created_at DESC);
CREATE INDEX idx_usage_events_type ON usage_events (event_type, created_at DESC);
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- ─── Workflow Jobs ───────────────────────────────────────────

CREATE TABLE workflow_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  site_id UUID REFERENCES sites(id),
  job_name TEXT NOT NULL CHECK (char_length(job_name) BETWEEN 1 AND 100),
  dedupe_key TEXT CHECK (dedupe_key IS NULL OR char_length(dedupe_key) <= 500),
  payload_pointer TEXT CHECK (payload_pointer IS NULL OR char_length(payload_pointer) <= 2048),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed')) DEFAULT 'queued',
  attempt INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts >= 1 AND max_attempts <= 10),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT CHECK (error_message IS NULL OR char_length(error_message) <= 2000),
  result_pointer TEXT CHECK (result_pointer IS NULL OR char_length(result_pointer) <= 2048),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_workflow_jobs_org ON workflow_jobs (org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_workflow_jobs_status ON workflow_jobs (status) WHERE status IN ('queued', 'running');
CREATE INDEX idx_workflow_jobs_dedupe ON workflow_jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE TRIGGER trg_workflow_jobs_updated_at BEFORE UPDATE ON workflow_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE workflow_jobs ENABLE ROW LEVEL SECURITY;

-- ─── RLS Policies ────────────────────────────────────────────
-- NOTE: In production, these would be more granular.
-- Service role bypasses RLS. Anon users get no access by default.
-- Actual policies will be based on the user's membership in the org.

-- Default: deny all for anon
-- Service role key bypasses RLS automatically in Supabase.

-- Example policy pattern (to be expanded per table):
CREATE POLICY "Users can view their own org data" ON orgs
  FOR SELECT USING (
    id IN (
      SELECT org_id FROM memberships
      WHERE user_id = auth.uid()
      AND deleted_at IS NULL
    )
  );

CREATE POLICY "Users can view their memberships" ON memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR org_id IN (
      SELECT org_id FROM memberships
      WHERE user_id = auth.uid()
      AND deleted_at IS NULL
    )
  );

CREATE POLICY "Users can view their org sites" ON sites
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM memberships
      WHERE user_id = auth.uid()
      AND deleted_at IS NULL
    )
  );

CREATE POLICY "Users can view their org hostnames" ON hostnames
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM memberships
      WHERE user_id = auth.uid()
      AND deleted_at IS NULL
    )
  );

CREATE POLICY "Users can view their org subscriptions" ON subscriptions
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM memberships
      WHERE user_id = auth.uid()
      AND deleted_at IS NULL
    )
  );

CREATE POLICY "Users can view their own sessions" ON sessions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can view their org audit logs" ON audit_logs
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM memberships
      WHERE user_id = auth.uid()
      AND deleted_at IS NULL
    )
  );
