-- 0008_add_site_benchmarks.sql
-- Per-build quantitative benchmark scores. One row per build attempt.
-- Powers the project-local learning loop (apps/project-sites/.claude/skills/learned/).
-- Default cost per row = $0 (Tiers 1-4 are free). Tier 5 (gpt-4o-mini) only fires when mean<0.7.

CREATE TABLE IF NOT EXISTS site_benchmarks (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  run_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Tier 1: programmatic DOM/CSS heuristics (free, ~5s)
  score_programmatic REAL,
  programmatic_findings_json TEXT,

  -- Tier 2: PageSpeed Insights API (free, 25k/day, ~30s)
  score_perf REAL,
  score_a11y REAL,
  score_seo REAL,
  score_best_practices REAL,
  psi_raw_json TEXT,

  -- Tier 3: axe-core 6 breakpoints (free, ~20s)
  axe_violations_count INTEGER,
  axe_violations_json TEXT,

  -- Tier 4: Workers AI LLaVA visual sanity (free tier, ~10s)
  score_visual_llava REAL,
  llava_findings_json TEXT,

  -- Tier 5: gpt-4o-mini OPTIONAL (~$0.0005/run, only if mean<0.7)
  score_visual_gpt4o REAL,
  gpt4o_findings_json TEXT,
  gpt4o_cost_cents REAL DEFAULT 0,

  -- Aggregated
  mean_score REAL,
  regressed_from_previous INTEGER DEFAULT 0,
  retrospective_path TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_site_benchmarks_site_id ON site_benchmarks(site_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_benchmarks_slug ON site_benchmarks(slug, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_benchmarks_mean ON site_benchmarks(mean_score);
