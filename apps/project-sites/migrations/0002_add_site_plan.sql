-- Add per-site plan column (free by default, paid after Stripe checkout)
ALTER TABLE sites ADD COLUMN plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'paid'));
