-- Form submissions captured from any *.projectsites.dev site via the standard forms.js drop-in.
CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  site_id TEXT NOT NULL REFERENCES sites(id),
  org_id TEXT NOT NULL,
  form_name TEXT NOT NULL DEFAULT 'default',
  email TEXT,
  payload TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  origin_url TEXT,
  forwarded_to TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'forwarded', 'partial', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES sites(id),
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_site ON form_submissions(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_org ON form_submissions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_email ON form_submissions(email) WHERE email IS NOT NULL;

-- Newsletter integrations: per-site connection to a third-party provider (Mailchimp, SendGrid, Resend, etc.)
-- or a generic webhook. api_key_encrypted holds an opaque encrypted token for the provider; never returned in API responses.
CREATE TABLE IF NOT EXISTS newsletter_integrations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  site_id TEXT NOT NULL REFERENCES sites(id),
  org_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('mailchimp', 'webhook', 'resend', 'sendgrid', 'convertkit', 'klaviyo')),
  api_key_encrypted TEXT,
  api_key_preview TEXT,
  list_id TEXT,
  webhook_url TEXT,
  config TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_dispatch_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  FOREIGN KEY (site_id) REFERENCES sites(id),
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_integrations_site ON newsletter_integrations(site_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_newsletter_integrations_org ON newsletter_integrations(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_newsletter_integrations_active ON newsletter_integrations(site_id, active) WHERE deleted_at IS NULL AND active = 1;
