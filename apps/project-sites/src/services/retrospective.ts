/**
 * @module services/retrospective
 * @description Generates per-build retrospectives. Diffs current benchmark
 * against the last 10 builds and asks Claude Haiku to identify patterns worth
 * encoding as rules.
 *
 * Cost: one Haiku call (~$0.001) per build. Skipped entirely if mean score is
 * healthy (>=0.85) and no regression — no learning to do when everything works.
 *
 * Output: a markdown file in `apps/project-sites/.claude/skills/learned/retrospectives/`
 * named `YYYY-MM-DD-{slug}.md`. The weekly aggregator clusters these into
 * candidate rules in RULES.md.
 */

import { dbQuery, dbUpdate } from './db.js';
import { callExternalLLM } from './external_llm.js';
import type { Env } from '../types/env.js';
import type { BenchmarkResult } from './benchmark.js';

interface PriorBenchmark {
  id: string;
  slug: string;
  run_at: string;
  mean_score: number | null;
  score_programmatic: number | null;
  score_perf: number | null;
  score_a11y: number | null;
  score_seo: number | null;
  programmatic_findings_json: string | null;
}

export interface RetrospectiveOutput {
  /** Markdown body for the retrospective file. */
  markdown: string;
  /** Suggested filename relative to retrospectives/. */
  filename: string;
  /** Whether the retrospective was actually generated (vs. skipped as healthy). */
  generated: boolean;
  /** Reason for skipping, if applicable. */
  skipReason?: string;
}

/**
 * Decide whether this build needs a retrospective. Skip if mean is high AND
 * no regression — there's nothing useful to learn from a clean build.
 */
export function shouldGenerate(current: BenchmarkResult): boolean {
  const HEALTHY_THRESHOLD = 0.85;
  if (current.regressedFromPrevious) return true;
  if (current.meanScore < HEALTHY_THRESHOLD) return true;
  return false;
}

/**
 * Build a retrospective from the current benchmark + last N priors.
 * Persists nothing — caller decides where to write the markdown
 * (R2, GitHub PR, local file via container callback).
 */
export async function buildRetrospective(args: {
  env: Env;
  current: BenchmarkResult;
  historyLimit?: number;
}): Promise<RetrospectiveOutput> {
  const { env, current, historyLimit = 10 } = args;

  if (!shouldGenerate(current)) {
    return {
      markdown: '',
      filename: '',
      generated: false,
      skipReason: `Healthy build (mean=${current.meanScore.toFixed(2)}, no regression). No retrospective needed.`,
    };
  }

  const priors = await dbQuery<PriorBenchmark>(
    env.DB,
    `SELECT id, slug, run_at, mean_score, score_programmatic, score_perf, score_a11y, score_seo, programmatic_findings_json
     FROM site_benchmarks
     WHERE site_id != ?
     ORDER BY run_at DESC
     LIMIT ?`,
    [current.siteId, historyLimit],
  );

  const today = new Date().toISOString().slice(0, 10);
  const filename = `${today}-${current.slug}.md`;

  const prompt = renderRetroPrompt(current, priors.data);

  let llmFindings = '';
  try {
    const llm = await callExternalLLM(env, {
      system: 'You are a senior web engineer reviewing a site build. Identify 1-3 specific, actionable patterns worth encoding as rules. Be concrete. No fluff.',
      user: prompt,
      maxTokens: 1200,
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
    });
    llmFindings = llm.output;
  } catch (err) {
    llmFindings = `_LLM call failed: ${err instanceof Error ? err.message : String(err)}_`;
  }

  const markdown = renderMarkdown({ current, priors: priors.data, llmFindings, today });

  return { markdown, filename, generated: true };
}

/** Pure prompt builder — extracted for testing. */
export function renderRetroPrompt(current: BenchmarkResult, priors: PriorBenchmark[]): string {
  const priorRows = priors
    .slice(0, 10)
    .map((p) => `- ${p.run_at} ${p.slug}: mean=${(p.mean_score ?? 0).toFixed(2)} prog=${(p.score_programmatic ?? 0).toFixed(2)} perf=${(p.score_perf ?? 0).toFixed(2)} a11y=${(p.score_a11y ?? 0).toFixed(2)} seo=${(p.score_seo ?? 0).toFixed(2)}`)
    .join('\n');

  const findings = current.programmatic;
  const issues: string[] = [];
  if (findings.h1Count !== 1) issues.push(`h1Count=${findings.h1Count} (target: 1)`);
  if (findings.jsonLdBlocks < 4) issues.push(`jsonLdBlocks=${findings.jsonLdBlocks} (target: >=4)`);
  if (findings.titleLength < 50 || findings.titleLength > 60) issues.push(`titleLength=${findings.titleLength} (target: 50-60)`);
  if (findings.metaDescriptionLength < 120 || findings.metaDescriptionLength > 156) issues.push(`metaDescriptionLength=${findings.metaDescriptionLength} (target: 120-156)`);
  if (!findings.hasColorScheme) issues.push('color-scheme meta missing');
  if (findings.imagesMissingAlt > 0) issues.push(`imagesMissingAlt=${findings.imagesMissingAlt}`);
  if (findings.imageCount < 10) issues.push(`imageCount=${findings.imageCount} (target: >=10)`);
  if (findings.bannedWordHits.length) issues.push(`bannedWords: ${findings.bannedWordHits.join(', ')}`);

  return [
    `Current build: ${current.slug}`,
    `Mean score: ${current.meanScore.toFixed(2)}`,
    `Regressed: ${current.regressedFromPrevious}`,
    '',
    'Specific issues this build:',
    issues.length ? issues.map((i) => `- ${i}`).join('\n') : '- (none — score low for non-checklist reasons)',
    '',
    'Last 10 builds:',
    priorRows || '- (no history)',
    '',
    'Identify 1-3 patterns. Each as: "**Trigger:** when X / **Mitigation:** do Y / **Confidence:** 0.NN". Only include patterns supported by 2+ builds.',
  ].join('\n');
}

function renderMarkdown(args: {
  current: BenchmarkResult;
  priors: PriorBenchmark[];
  llmFindings: string;
  today: string;
}): string {
  const { current, priors, llmFindings, today } = args;
  const findings = current.programmatic;

  return `---
date: ${today}
slug: ${current.slug}
site_id: ${current.siteId}
mean_score: ${current.meanScore.toFixed(2)}
regressed: ${current.regressedFromPrevious}
---

# Retrospective: ${current.slug} (${today})

## Scores
- **Mean:** ${current.meanScore.toFixed(2)}
- **Programmatic:** ${findings.score.toFixed(2)}
- **PSI Perf:** ${current.psi?.performance ?? 'n/a'}
- **PSI A11y:** ${current.psi?.accessibility ?? 'n/a'}
- **PSI SEO:** ${current.psi?.seo ?? 'n/a'}
- **PSI Best Practices:** ${current.psi?.bestPractices ?? 'n/a'}

## Specific Findings
- imageCount: ${findings.imageCount} (missing alt: ${findings.imagesMissingAlt})
- h1Count: ${findings.h1Count}
- jsonLdBlocks: ${findings.jsonLdBlocks}
- titleLength: ${findings.titleLength}
- metaDescriptionLength: ${findings.metaDescriptionLength}
- hasColorScheme: ${findings.hasColorScheme}
- internal/external links: ${findings.internalLinks}/${findings.externalLinks}
- banned words: ${findings.bannedWordHits.length ? findings.bannedWordHits.join(', ') : '(none)'}

## Last ${priors.length} Builds
${priors.map((p) => `- ${p.run_at} \`${p.slug}\`: mean=${(p.mean_score ?? 0).toFixed(2)}`).join('\n') || '_(no history)_'}

## Pattern Analysis (Claude Haiku)
${llmFindings}

## Promotion Status
- [ ] Observed in 20+ builds (currently 1)
- [ ] Confidence >= 0.85
- [ ] Not domain-specific
- [ ] Reviewed by maintainer
`;
}

/** Update the site_benchmarks row with the retrospective path once written. */
export async function recordRetrospectivePath(env: Env, benchmarkId: string, path: string): Promise<void> {
  await dbUpdate(env.DB, 'site_benchmarks', { retrospective_path: path }, 'id = ?', [benchmarkId]);
}
