/**
 * @module services/aggregate_rules
 * @description Weekly aggregator: scans per-build retrospectives in R2, clusters
 * recurring patterns, and emits candidate rules for `apps/project-sites/.claude/skills/learned/RULES.md`.
 *
 * Promotion bar: a pattern must be observed in `MIN_EVIDENCE` retrospectives with
 * `meanConfidence >= MIN_CONFIDENCE` before it becomes a candidate rule. Retired
 * rules (disproven by later evidence) are moved to a "Recently retired" section.
 *
 * Cost: one Haiku call per run (~$0.005 with batched retrospectives in context).
 * Output is written to R2 at `learned-rules/RULES.md`; the local CLI script
 * `scripts/aggregate-retrospectives.mjs` syncs it back into the repo for PR.
 */

import { callExternalLLM } from './external_llm.js';
import type { Env } from '../types/env.js';

export interface ExtractedPattern {
  trigger: string;
  mitigation: string;
  confidence: number;
  source: string;
}

export interface CandidateRule {
  id: string;
  trigger: string;
  mitigation: string;
  evidence: number;
  confidence: number;
  firstSeen: string;
  sources: string[];
}

export interface AggregateResult {
  candidates: CandidateRule[];
  retired: CandidateRule[];
  totalRetrospectives: number;
  totalPatterns: number;
  summary: string;
}

const MIN_EVIDENCE = 20;
const MIN_CONFIDENCE = 0.85;

/**
 * Pure parser. Extracts Trigger/Mitigation/Confidence triples from a single
 * retrospective markdown body. Handles both slash-joined ("X / Y / Z") and
 * multi-line bullet formats.
 */
export function parseRetrospective(markdown: string, source: string): ExtractedPattern[] {
  const patterns: ExtractedPattern[] = [];

  const slashRe = /\*\*Trigger:\*\*\s*([^/\n]+?)\s*\/\s*\*\*Mitigation:\*\*\s*([^/\n]+?)\s*\/\s*\*\*Confidence:\*\*\s*([0-9.]+)/gi;
  let m;
  while ((m = slashRe.exec(markdown)) !== null) {
    const conf = Number.parseFloat(m[3]);
    if (Number.isFinite(conf)) {
      patterns.push({
        trigger: m[1].trim(),
        mitigation: m[2].trim(),
        confidence: conf,
        source,
      });
    }
  }

  if (patterns.length === 0) {
    const blockRe = /\*\*Trigger:\*\*\s*([\s\S]+?)\s*\*\*Mitigation:\*\*\s*([\s\S]+?)\s*\*\*Confidence:\*\*\s*([0-9.]+)/gi;
    while ((m = blockRe.exec(markdown)) !== null) {
      const conf = Number.parseFloat(m[3]);
      if (Number.isFinite(conf)) {
        patterns.push({
          trigger: m[1].replace(/\n+/g, ' ').replace(/^[-\s]+|[-\s]+$/g, '').trim(),
          mitigation: m[2].replace(/\n+/g, ' ').replace(/^[-\s]+|[-\s]+$/g, '').trim(),
          confidence: conf,
          source,
        });
      }
    }
  }

  return patterns;
}

/** Slug-ish id from trigger text — lowercase alphanumerics + hyphens, max 60 chars. */
export function ruleIdFromTrigger(trigger: string): string {
  return trigger
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'unnamed-rule';
}

/**
 * Cluster patterns by trigger similarity. Uses Claude Haiku to group near-duplicate
 * triggers (e.g. "h1 missing" + "no h1 tag" + "page lacks h1") into one cluster
 * with a canonical trigger description.
 *
 * Returns one CandidateRule per cluster meeting promotion bar.
 */
export async function clusterPatterns(
  env: Env,
  patterns: ExtractedPattern[],
): Promise<CandidateRule[]> {
  if (patterns.length === 0) return [];

  const lines = patterns.map((p, i) =>
    `${i + 1}. trigger="${p.trigger}" mitigation="${p.mitigation}" confidence=${p.confidence.toFixed(2)} source=${p.source}`,
  ).join('\n');

  const prompt = [
    'Below are extracted Trigger/Mitigation pairs from per-build retrospectives.',
    'Cluster patterns whose triggers describe the same underlying issue (treat synonyms and rephrasings as one cluster).',
    '',
    'For each cluster, return JSON in this exact shape:',
    '{ "clusters": [{ "trigger": "canonical trigger", "mitigation": "canonical mitigation", "patternIndices": [1, 4, 7] }] }',
    '',
    'Rules: skip clusters with only 1 pattern. Keep canonical text concise (<=80 chars). Output ONLY JSON, no prose.',
    '',
    'Patterns:',
    lines,
  ].join('\n');

  const llm = await callExternalLLM(env, {
    system: 'You cluster retrospective patterns by semantic similarity. Output compact JSON only.',
    user: prompt,
    maxTokens: 2000,
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
  });

  const cleaned = llm.output.replace(/```json\s*|\s*```/g, '').trim();
  let parsed: { clusters: { trigger: string; mitigation: string; patternIndices: number[] }[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!parsed?.clusters) return [];

  const candidates: CandidateRule[] = [];
  for (const cluster of parsed.clusters) {
    const indices = (cluster.patternIndices || []).filter((i): i is number => Number.isInteger(i) && i >= 1 && i <= patterns.length);
    if (indices.length < 2) continue;

    const matched = indices.map((i) => patterns[i - 1]);
    const meanConf = matched.reduce((s, p) => s + p.confidence, 0) / matched.length;
    const sources = Array.from(new Set(matched.map((p) => p.source)));

    candidates.push({
      id: ruleIdFromTrigger(cluster.trigger),
      trigger: cluster.trigger,
      mitigation: cluster.mitigation,
      evidence: matched.length,
      confidence: meanConf,
      firstSeen: extractDateFromSource(sources[0]) || new Date().toISOString().slice(0, 10),
      sources,
    });
  }

  candidates.sort((a, b) => b.evidence - a.evidence || b.confidence - a.confidence);
  return candidates;
}

function extractDateFromSource(source: string): string | null {
  const m = source.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Top-level aggregator. Lists retrospectives in R2, parses each, clusters patterns,
 * splits into promotion-eligible candidates vs. below-bar (still accumulating).
 */
export async function aggregateRules(args: {
  env: Env;
  prefix?: string;
  minEvidence?: number;
  minConfidence?: number;
}): Promise<AggregateResult> {
  const {
    env,
    prefix = 'retrospectives/',
    minEvidence = MIN_EVIDENCE,
    minConfidence = MIN_CONFIDENCE,
  } = args;

  const listing = await env.SITES_BUCKET.list({ prefix, limit: 1000 });
  const objects = listing.objects.filter((o) => o.key.endsWith('.md'));

  const allPatterns: ExtractedPattern[] = [];
  for (const obj of objects) {
    const body = await env.SITES_BUCKET.get(obj.key);
    if (!body) continue;
    const text = await body.text();
    const found = parseRetrospective(text, obj.key);
    allPatterns.push(...found);
  }

  if (allPatterns.length === 0) {
    return {
      candidates: [],
      retired: [],
      totalRetrospectives: objects.length,
      totalPatterns: 0,
      summary: `No patterns extracted from ${objects.length} retrospectives.`,
    };
  }

  const allCandidates = await clusterPatterns(env, allPatterns);
  const promoted = allCandidates.filter((c) => c.evidence >= minEvidence && c.confidence >= minConfidence);
  const accumulating = allCandidates.filter((c) => !(c.evidence >= minEvidence && c.confidence >= minConfidence));

  return {
    candidates: promoted,
    retired: [],
    totalRetrospectives: objects.length,
    totalPatterns: allPatterns.length,
    summary: `${objects.length} retrospectives → ${allPatterns.length} patterns → ${allCandidates.length} clusters → ${promoted.length} promoted, ${accumulating.length} accumulating (need ${minEvidence}+ evidence, ${minConfidence}+ confidence).`,
  };
}

/**
 * Render the active-rules block as markdown — replaces the placeholder body in
 * `RULES.md`. Caller decides whether to overwrite the file directly or PR it.
 */
export function renderRulesMarkdown(result: AggregateResult): string {
  const today = new Date().toISOString().slice(0, 10);

  const activeBlock = result.candidates.length === 0
    ? '_No promoted rules yet. Patterns are still accumulating evidence._'
    : result.candidates.map((c) => [
        `### ${c.id}`,
        `- **Trigger:** ${c.trigger}`,
        `- **Mitigation:** ${c.mitigation}`,
        `- **Evidence:** ${c.evidence} retrospectives`,
        `- **Confidence:** ${c.confidence.toFixed(2)}`,
        `- **First seen:** ${c.firstSeen}`,
        `- **Sources:** ${c.sources.slice(0, 3).join(', ')}${c.sources.length > 3 ? ` (+${c.sources.length - 3} more)` : ''}`,
      ].join('\n')).join('\n\n');

  const retiredBlock = result.retired.length === 0
    ? '_No rules retired this cycle._'
    : result.retired.map((c) => `### ${c.id}\n- **Trigger:** ${c.trigger}\n- **Reason retired:** Disproven by later evidence`).join('\n\n');

  return [
    '---',
    'name: Learned Rules — Project Sites',
    'description: Active rules accumulated from past builds. Loaded into every container build via @-import. Auto-generated by services/aggregate_rules.ts.',
    'type: project',
    `last_aggregated: ${today}`,
    '---',
    '',
    '# Learned Rules (auto-evolving)',
    '',
    `**Last aggregated:** ${today}. ${result.summary}`,
    '',
    'Rules accumulate from per-build retrospectives in R2. The weekly aggregator clusters patterns; once a cluster has `evidence >= 20` and `confidence >= 0.85`, it gets promoted into the Active Rules section below. The CLI script `scripts/aggregate-retrospectives.mjs` syncs this file from R2 → repo for PR.',
    '',
    '## Active Rules (apply on every build)',
    '',
    activeBlock,
    '',
    '## Recently Retired',
    '',
    retiredBlock,
    '',
  ].join('\n');
}
