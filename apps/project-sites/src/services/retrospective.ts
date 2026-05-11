/**
 * @module services/retrospective
 *
 * @description
 * Generates per-build retrospectives. Diffs the current benchmark against
 * the last 10 builds and asks Claude Haiku to identify 1–3 patterns worth
 * encoding as rules in `RULES.md`.
 *
 * ## Lifecycle
 *
 * 1. Called from `workflows/site-generation.ts` in the `retrospective` step
 *    immediately after `benchmark.ts` writes its row to `site_benchmarks`.
 * 2. {@link shouldGenerate} is the cheap gate — clean builds (mean ≥ 0.85
 *    AND no regression) skip Haiku entirely, saving ~$0.001 + ~3s latency.
 * 3. {@link buildRetrospective} pulls the last N priors from D1, renders a
 *    structured prompt, calls Haiku 4.5, and returns markdown.
 * 4. Caller writes the markdown to R2 (and optionally to a GitHub PR via
 *    `services/git.ts`) and calls {@link recordRetrospectivePath} to link
 *    the file back to the benchmark row.
 *
 * ## Output
 *
 * A markdown file in `apps/project-sites/.claude/skills/learned/retrospectives/`
 * named `YYYY-MM-DD-{slug}.md`. The weekly aggregator (see
 * `scripts/aggregate-retrospectives.mjs`) clusters these into candidate
 * rules in `RULES.md` once a pattern hits the 20-build / 0.85-confidence
 * promotion threshold.
 *
 * ## Cost
 *
 * One Haiku call per build, ~1200 output tokens, ~$0.001. Skipped on
 * healthy builds so total monthly cost stays under $1 even at 1k builds/mo.
 *
 * @example
 * ```ts
 * const retro = await buildRetrospective({ env, current: benchmark });
 * if (retro.generated) {
 *   await env.SITES_BUCKET.put(`retrospectives/${retro.filename}`, retro.markdown);
 *   await recordRetrospectivePath(env, benchmark.id, retro.filename);
 * }
 * ```
 *
 * @see {@link module:services/benchmark}
 * @see {@link module:services/external_llm}
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
 * Decide whether this build needs a retrospective.
 *
 * Skip if mean ≥ 0.85 AND no regression vs. the previous build — there is
 * nothing useful to learn from a clean build, and the Haiku call would be
 * wasted spend.
 *
 * @param current - Benchmark result just produced by `services/benchmark.ts`.
 * @returns `true` if Haiku should be called; `false` if the build is healthy.
 *
 * @remarks
 * Pure function — no I/O, no side effects. Safe to call from any execution
 * context (workflow step, unit test, CLI).
 *
 * @example
 * ```ts
 * if (!shouldGenerate(current)) {
 *   logger.info('Skipping retrospective — build is healthy');
 *   return;
 * }
 * ```
 */
export function shouldGenerate(current: BenchmarkResult): boolean {
  const HEALTHY_THRESHOLD = 0.85;
  if (current.regressedFromPrevious) return true;
  if (current.meanScore < HEALTHY_THRESHOLD) return true;
  return false;
}

/**
 * Build a retrospective from the current benchmark + last N priors.
 *
 * Persists nothing — caller decides where to write the markdown (R2,
 * GitHub PR via `services/git.ts`, or local file via container callback).
 *
 * @param args.env          - Worker bindings; `env.DB` (D1) and any keys
 *   needed by `external_llm` (`ANTHROPIC_API_KEY`) are required.
 * @param args.current      - Just-produced benchmark for this build.
 * @param args.historyLimit - How many prior builds to include in the prompt
 *   (default `10`). Capped at 10 inside {@link renderRetroPrompt}.
 * @returns A {@link RetrospectiveOutput}. When `generated=false` the
 *   markdown is empty and the caller should skip persistence.
 *
 * @remarks
 * Side effects:
 * - 1 D1 read (`SELECT … FROM site_benchmarks` for prior builds).
 * - 1 HTTP call to Anthropic via `callExternalLLM` (Haiku 4.5, ~1200 tok).
 *
 * Failure mode: when the LLM call throws, the retrospective is still
 * produced but the pattern-analysis section embeds the error message
 * verbatim. Callers SHOULD persist the markdown anyway — the structured
 * findings section is still useful for the weekly aggregator.
 *
 * @throws Never — LLM errors are caught and rendered inline. D1 errors
 *   propagate as rejected promises (caller's `error_handler` wraps them).
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

/**
 * Pure prompt builder — extracted so unit tests can assert against the
 * exact wire-format text sent to Haiku without spinning up a workflow.
 *
 * @param current - Current benchmark.
 * @param priors  - Up to 10 prior benchmarks (truncated inside).
 * @returns A multi-line prompt string ready for `callExternalLLM`.
 *
 * @remarks
 * The prompt is structured as: current build stats → specific checklist
 * issues (h1, JSON-LD, title length, etc.) → last-N history rows → request
 * for 1–3 patterns with `Trigger:/Mitigation:/Confidence:` format. Haiku
 * is instructed to only emit patterns supported by 2+ builds to suppress
 * single-build noise.
 */
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

/**
 * Update the `site_benchmarks` row with the retrospective path once the
 * markdown is persisted.
 *
 * @param env         - Worker bindings; `env.DB` (D1) required.
 * @param benchmarkId - PK of the `site_benchmarks` row produced earlier.
 * @param path        - R2 key or relative repo path to the markdown file.
 *
 * @remarks
 * Side effect: 1 D1 UPDATE. Idempotent — overwrites any prior value.
 *
 * @throws {Error} Propagates D1 errors as rejected promises.
 */
export async function recordRetrospectivePath(env: Env, benchmarkId: string, path: string): Promise<void> {
  await dbUpdate(env.DB, 'site_benchmarks', { retrospective_path: path }, 'id = ?', [benchmarkId]);
}
