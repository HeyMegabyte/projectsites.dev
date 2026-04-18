-- Performance indexes for common query patterns at scale
CREATE INDEX IF NOT EXISTS idx_sites_org_id ON sites(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sites_slug ON sites(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memberships_org_id ON memberships(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostnames_site_id ON hostnames(site_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostnames_hostname ON hostnames(hostname, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_org_id ON subscriptions(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON audit_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_workflow_jobs_site_id ON workflow_jobs(site_id);
