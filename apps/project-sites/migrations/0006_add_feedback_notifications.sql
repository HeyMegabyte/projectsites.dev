-- Feedback table for in-app user feedback and testimonials
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id TEXT,
  user_id TEXT,
  page_url TEXT,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Notifications table for in-app notification bell
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  org_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('site_published', 'billing_reminder', 'feedback_received', 'domain_verified', 'build_failed', 'announcement')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

-- Indexes for feedback
CREATE INDEX IF NOT EXISTS idx_feedback_org_id ON feedback(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating) WHERE deleted_at IS NULL;

-- Indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
