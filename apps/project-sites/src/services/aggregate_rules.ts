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
 *
 * @param markdown - Raw retrospective markdown body. Typically the contents
 *   of an R2 object under `retrospectives/YYYY-MM-DD-<slug>.md` written by
 *   the container post-build retrospective step. Format-agnostic — the
 *   parser tolerates whichever shape the LLM emitted that day.
 * @param source   - Stable identifier for the originating retrospective —
 *   used as the R2 object key (e.g. `retrospectives/2026-05-09-njsk.md`).
 *   Propagated into every returned `ExtractedPattern.source` so
 *   {@link clusterPatterns} can later dedupe across retrospectives and
 *   {@link extractDateFromSource} can pull `firstSeen`.
 * @returns Zero or more `ExtractedPattern` records. Pure function — never
 *   throws, never reads I/O. Empty array on unparseable input (the wrong
 *   answer here is a quieter signal than a thrown error, since the
 *   aggregator must keep going across hundreds of retrospectives even
 *   when one is malformed).
 *
 * @remarks
 * Dual-regex strategy with deliberate ordering: the slash-joined form
 * (`**Trigger:** X / **Mitigation:** Y / **Confidence:** Z`) is tried
 * FIRST because retrospectives written by the current prompt template
 * emit that shape — fast path. Only if zero matches surface does the
 * fallback multi-line block regex run (looser `[\s\S]+?` body capture,
 * needed for legacy bullet-list retrospectives written before the
 * template was tightened). The order matters: if the block regex ran
 * first against slash-joined input it would over-capture across multiple
 * triples and collapse them into one (the `[\s\S]+?` lazy quantifier
 * still extends past internal `/` separators).
 *
 * `Number.isFinite` guards reject `NaN` from malformed confidence values
 * (`Confidence: high`, `Confidence: --`) instead of silently emitting
 * `confidence: NaN` that would later poison the mean in
 * {@link clusterPatterns}. Skipped patterns vanish — no logging, no
 * audit trail. If a retrospective produces zero patterns, that's a
 * symptom worth investigating but not a build-breaker.
 *
 * Trim discipline: the slash-joined form trims `.trim()` on each
 * capture; the block form additionally strips leading/trailing `-` and
 * whitespace runs (bullet artifacts) and collapses internal newlines to
 * single spaces (so triggers stay one-line for downstream clustering).
 *
 * @throws Never — pure function over strings.
 *
 * @example
 * ```ts
 * const md = '**Trigger:** missing h1 / **Mitigation:** add semantic h1 in shell / **Confidence:** 0.92';
 * parseRetrospective(md, 'retrospectives/2026-05-09-njsk.md');
 * // → [{ trigger: 'missing h1', mitigation: 'add semantic h1 in shell',
 * //      confidence: 0.92, source: 'retrospectives/2026-05-09-njsk.md' }]
 * ```
 *
 * @see {@link clusterPatterns} — downstream consumer that groups patterns
 *   across retrospectives by semantic similarity.
 * @see {@link ruleIdFromTrigger} — used by `clusterPatterns` to derive
 *   stable IDs from canonical trigger text.
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

/**
 * Slug-ish id from trigger text — lowercase alphanumerics + hyphens, max 60 chars.
 *
 * @param trigger - Canonical trigger description (already-clustered, after
 *   the LLM has merged synonyms). Caller is responsible for picking the
 *   canonical text; this function only normalizes formatting.
 * @returns Filesystem/URL-safe slug. Always non-empty: falls back to
 *   `'unnamed-rule'` when the trigger collapses to zero characters
 *   (e.g. punctuation-only input).
 *
 * @remarks
 * 60-char cap rationale: rule IDs surface in `RULES.md` headings
 * (`### <id>`), R2 keys (potentially), and PR titles. 60 chars keeps
 * headings on a single line in standard GitHub rendering and well under
 * filesystem limits. Truncation is silent — a trigger with two
 * semantically-distinct prefixes that share a 60-char slug will produce
 * an ID collision; rely on `evidence desc` sort in {@link clusterPatterns}
 * to surface the more-cited duplicate first. This is acceptable because
 * collisions are rare and visible in the rendered RULES.md output.
 *
 * Character-class normalization: every run of non-alphanumeric chars
 * collapses to a single hyphen (Unicode-naive — emoji and CJK
 * characters get scrubbed entirely). Leading/trailing hyphens stripped
 * after the slice so a trigger like `"H1 missing!"` doesn't yield
 * `h1-missing-` with a trailing dangler.
 *
 * @throws Never — pure string transform.
 *
 * @example
 * ```ts
 * ruleIdFromTrigger('Missing H1 in shell');           // → 'missing-h1-in-shell'
 * ruleIdFromTrigger('  ***!!! ***  ');                // → 'unnamed-rule'
 * ruleIdFromTrigger('a'.repeat(100));                 // → 'a' × 60 (truncated)
 * ```
 *
 * @see {@link clusterPatterns} — sole caller; assigns the returned slug
 *   to `CandidateRule.id`.
 */
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
 *
 * @param env      - Worker bindings, plumbed through to `callExternalLLM`
 *   for credential lookup and rate-limit accounting.
 * @param patterns - Flat list of patterns extracted across ALL
 *   retrospectives in this aggregation cycle. Already deduped at the
 *   `(trigger, source)` level by {@link parseRetrospective} but NOT
 *   yet deduped semantically — that's this function's job.
 * @returns Sorted `CandidateRule[]` (evidence desc, confidence desc as
 *   tiebreaker). Empty array on: zero input patterns, Haiku JSON parse
 *   failure, or zero clusters meeting the size-2 floor. Failures are
 *   silent because aggregation is a scheduled background job — a noisy
 *   throw here would only spam logs without changing the outcome
 *   (next week's run gets a fresh shot).
 *
 * @remarks
 * Model choice — `claude-haiku-4-5-20251001`: Haiku is the cheapest
 * frontier model that handles structured JSON output reliably at this
 * task size. ~$0.005 per run with batched retrospectives (target: ≤2K
 * output tokens, which `maxTokens: 2000` caps). Sonnet/Opus would burn
 * 5-10× the cost for no measurable lift on this semantic-similarity
 * task — clustering is not where intelligence headroom helps.
 *
 * Cluster-size floor: clusters with `indices.length < 2` are dropped
 * (`continue`). Single-pattern clusters are by definition not evidence
 * of a recurring issue — they're noise that hasn't been seen twice yet.
 * Promoting a size-1 cluster would turn the entire learned-rules system
 * into an anecdote engine.
 *
 * JSON fence stripping: the Haiku response sometimes wraps JSON in
 * ` ```json ... ``` ` fences despite the "Output ONLY JSON" instruction.
 * `.replace(/```json\s*|\s*```/g, '').trim()` handles both directions
 * (prefix and suffix fence) without breaking unfenced output. JSON.parse
 * failure → empty array, NOT throw — same silent-failure rationale as
 * above.
 *
 * Index validation: `patternIndices` from the LLM are 1-based (per the
 * prompt instructions) and filtered through
 * `Number.isInteger(i) && i >= 1 && i <= patterns.length` before
 * indexing. Defensive against off-by-one hallucinations and stray
 * 0-based indices.
 *
 * `firstSeen` is derived from the FIRST source's filename via
 * {@link extractDateFromSource}. The first source is whichever the LLM
 * happened to list first in `patternIndices` — NOT necessarily the
 * earliest-dated retrospective. Fall back to today's date if the source
 * filename has no `YYYY-MM-DD` substring. Acceptable imprecision because
 * `firstSeen` is informational, not gating.
 *
 * Sort order: `evidence desc, confidence desc`. Evidence dominates
 * confidence because evidence floor is the promotion bar — a 21-evidence
 * 0.85-confidence cluster outranks a 2-evidence 0.99-confidence
 * cluster in surfacing priority.
 *
 * @throws Propagates errors from `callExternalLLM` (auth failure, network
 *   outage, provider 5xx). Parse failures and zero-cluster outputs
 *   resolve to empty array instead of throwing.
 *
 * @example
 * ```ts
 * const patterns = [
 *   { trigger: 'missing h1', mitigation: 'add semantic h1', confidence: 0.9, source: 'retro-a.md' },
 *   { trigger: 'no h1 tag', mitigation: 'add semantic h1', confidence: 0.92, source: 'retro-b.md' },
 *   { trigger: 'page lacks h1', mitigation: 'add semantic h1', confidence: 0.88, source: 'retro-c.md' },
 * ];
 * const candidates = await clusterPatterns(env, patterns);
 * // → [{ id: 'h1-missing-in-shell', evidence: 3, confidence: 0.9, ... }]
 * ```
 *
 * @see {@link aggregateRules} — sole caller; partitions the returned
 *   candidates into promoted vs. accumulating by the promotion bar.
 * @see {@link ruleIdFromTrigger} — produces the `id` field from the
 *   LLM-chosen canonical trigger text.
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
 *
 * @param args.env           - Worker bindings (SITES_BUCKET + LLM credentials).
 * @param args.prefix        - R2 object-key prefix to scan. Defaults to
 *   `'retrospectives/'` matching the path the container writes to
 *   post-build. Override for test fixtures or staging buckets.
 * @param args.minEvidence   - Promotion-bar evidence floor. Defaults to
 *   `MIN_EVIDENCE` (20). Override only for testing — lowering in prod
 *   would defeat the entire "accumulate evidence before promoting"
 *   premise.
 * @param args.minConfidence - Promotion-bar mean-confidence floor.
 *   Defaults to `MIN_CONFIDENCE` (0.85). Same override caveat.
 * @returns Materialized `AggregateResult` with promoted vs.
 *   accumulating split, total counts, and a human-readable summary
 *   line suitable for dropping into a PR description or Slack post.
 *
 * @remarks
 * R2 listing cap = 1000 objects per `env.SITES_BUCKET.list({ limit })`.
 * This is the Workers R2 API hard cap per call — no pagination is
 * performed here. At one retrospective per build and a few hundred
 * builds per week, the cap should not bind for ≥3 years of operation.
 * If retrospective volume crosses ~800/week, switch to paginated
 * listing with cursor (`list({ cursor })`) — until then, the simpler
 * single-call path stays.
 *
 * `.md` filter on listed objects (`o.key.endsWith('.md')`) excludes
 * incidental non-retrospective files that might land under
 * `retrospectives/` (e.g. a stray `_index.json` or a `.gitkeep`
 * placeholder). The container only ever writes `.md` retrospectives,
 * so this is defense-in-depth rather than load-bearing.
 *
 * Early return on zero patterns: when `parseRetrospective` produced
 * nothing across ALL retrospectives, skip the Haiku call entirely
 * (~$0.005 saved per zero-pattern run, but more importantly avoids a
 * spurious Haiku call with empty input that would otherwise log as a
 * "successful" LLM call in observability). Returns a deterministic
 * empty result with a `summary` line explaining what happened.
 *
 * Promotion-bar split: `allCandidates` returned by
 * {@link clusterPatterns} is partitioned ONCE into two arrays. Both
 * branches use the same `(evidence >= minEvidence && confidence >=
 * minConfidence)` condition. The negated filter for `accumulating`
 * uses De Morgan-equivalent `!(A && B)` rather than `(!A || !B)` so
 * the predicate stays visually identical to the promotion check —
 * easier for a future reader to verify they're inverses.
 *
 * `retired: []` is hard-coded for now. The schema supports retirement
 * but the comparison-with-previous-cycle logic isn't built yet —
 * retiring a rule requires diffing against last week's `RULES.md` and
 * spotting clusters that were promoted but are no longer surfacing.
 * Tracked as a TODO in the aggregator skill spec.
 *
 * @throws Propagates errors from `clusterPatterns` (Haiku auth/network).
 *   R2 listing failures and per-object `get()` failures propagate as
 *   well — they indicate a genuine binding misconfiguration, not
 *   transient noise.
 *
 * @example
 * ```ts
 * const result = await aggregateRules({ env });
 * // result.summary === '47 retrospectives → 312 patterns → 28 clusters
 * //                     → 3 promoted, 25 accumulating (need 20+ evidence,
 * //                     0.85+ confidence).'
 * const md = renderRulesMarkdown(result);
 * await env.SITES_BUCKET.put('learned-rules/RULES.md', md);
 * ```
 *
 * @see {@link renderRulesMarkdown} — typical follow-up call to format
 *   the result for `learned-rules/RULES.md`.
 * @see `scripts/aggregate-retrospectives.mjs` — local CLI wrapper that
 *   syncs the R2 output back into the repo for PR.
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
 *
 * @param result - Materialized aggregator output from {@link aggregateRules}.
 *   Both `candidates` and `retired` arrays are rendered; empty arrays
 *   produce italicized "no rules yet" placeholders rather than missing
 *   sections (preserves consistent file structure across cycles for
 *   stable PR diffs).
 * @returns Full `RULES.md` body, frontmatter included. Caller writes
 *   directly to R2 at `learned-rules/RULES.md` or via PR through
 *   `scripts/aggregate-retrospectives.mjs`.
 *
 * @remarks
 * Frontmatter shape mirrors the convention used across the rest of the
 * `.claude/` ecosystem (`name` / `description` / `type` / metadata).
 * The `last_aggregated: YYYY-MM-DD` field is the single most useful
 * field for humans reading the file — it answers "is this stale?" at a
 * glance.
 *
 * Active-rules block: emits a `###` heading per rule with a bullet list
 * of metadata fields. `sources` is capped to 3 with a "+N more"
 * indicator to keep rule entries scannable — the full source list is
 * recoverable from R2 retrospectives if a deep-dive is needed.
 *
 * Empty-state copy: italicized one-liners (`_No promoted rules yet ..._`
 * / `_No rules retired this cycle._`) instead of missing sections. The
 * structural stability means a git diff between weekly RULES.md
 * versions only shows real rule changes, not section appearance/
 * disappearance noise.
 *
 * Today's date: derived from `new Date().toISOString().slice(0, 10)` at
 * call time, NOT from the result. If `aggregateRules` ran at 23:59 UTC
 * and `renderRulesMarkdown` ran at 00:01 UTC the next day, the rendered
 * `last_aggregated` would show the later date. Acceptable drift —
 * `last_aggregated` is informational and "the aggregator ran around
 * this date" is the load-bearing claim.
 *
 * Confidence formatting: `c.confidence.toFixed(2)` (e.g. `0.87`). Two
 * decimal places is the precision level retrospectives produce; more
 * digits would suggest false precision.
 *
 * @throws Never — pure string composition.
 *
 * @example
 * ```ts
 * const md = renderRulesMarkdown(await aggregateRules({ env }));
 * await env.SITES_BUCKET.put('learned-rules/RULES.md', md, {
 *   httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
 * });
 * ```
 *
 * @see {@link aggregateRules} — the producer of the `AggregateResult` input.
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
