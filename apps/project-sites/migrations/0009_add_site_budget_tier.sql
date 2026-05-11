-- Add per-site budget tier column.
-- Drives premium media gating in the site-generation workflow:
--   free     → 2 generated images, no video/podcast/immersive
--   standard → 5 generated images, no video/podcast/immersive
--   plus     → 10 generated images + Sora hero video                ($29 one-time)
--   premium  → 15 generated images + Sora + NotebookLM podcast      ($79 one-time)
--                                  + immersive infographics
ALTER TABLE sites ADD COLUMN budget_tier TEXT NOT NULL DEFAULT 'free'
  CHECK (budget_tier IN ('free', 'standard', 'plus', 'premium'));
