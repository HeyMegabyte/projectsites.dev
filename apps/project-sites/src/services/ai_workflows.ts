/**
 * @module services/ai_workflows
 *
 * @description
 * Central AI workflow orchestrator — every Workers-AI inference in the codebase routes
 * through this module's {@link runPrompt} wrapper. Sits between the route handlers
 * (`src/routes/api.ts`, `src/routes/search.ts`) and the prompt infrastructure
 * (`src/prompts/*`), keeping LLM call sites uniform, observable, and doctrine-injected.
 *
 * @remarks
 * Five-step pipeline applied to every call:
 * 1. {@link registry.resolve} the {@link PromptSpec} (with optional A/B variant via
 *    weighted seed-hashing or forced variant name).
 * 2. {@link validatePromptInput} against the prompt's Zod input schema — boundary
 *    validation rejects malformed callers before any token is spent.
 * 3. {@link renderPromptWithDoctrine} renders the system + user templates with
 *    `safeDelimit:true` (escapes `{{...}}` in untrusted input) AND prepends the
 *    HOLIEST / HIGHEST B-ORDER Mission Doctrine preamble + Creativity + Love + Stars
 *    preamble. See `src/prompts/renderer.ts::buildDoctrinePrefix` — the doctrine
 *    flows into every LLM call automatically, no caller can opt out.
 * 4. {@link withObservability} wraps the actual `env.AI.run` invocation — emits
 *    `{ prompt_id, version, variant, input_hash (SHA-256), model, latency_ms, outcome,
 *    token_count, retry_count }` to D1 `audit_logs` for every call. This is the audit
 *    trail for both cost accounting and prompt-version A/B analysis.
 * 5. Return {@link LlmCallResult} with raw output text + metadata for downstream
 *    JSON extraction ({@link extractJsonFromText}) and Zod output validation
 *    ({@link validatePromptOutput}).
 *
 * Two pipelines coexist:
 * - **Legacy v1** (`researchBusiness` → `generateSiteHtml` → `scoreQuality`):
 *   single-pass, single-page HTML, ~30–90 s, kept for `/api/sites/improve-prompt`
 *   and `/api/sites/generate-prompt` lightweight paths.
 * - **V2 inline-LLM** ({@link runSiteGenerationWorkflowV2}): four-phase, parallelized
 *   research (profile → social/brand/selling-points/images in parallel), single
 *   `generate_website` HTML pass, parallel legal pages + quality scoring. ~75 s
 *   wall-clock. **NOT the production pipeline** — production runs the container
 *   orchestrator in `src/workflows/site-generation.ts::build-orchestrator` with full
 *   subagent fan-out producing multi-page Vite+React+Tailwind+shadcn output. V2
 *   here is the inline-LLM fallback path and the integration-test harness.
 *
 * Centralization is the whole point — it prevents three classes of bug that bit us
 * historically: (a) silent prompt-version drift across services (mismatched versions
 * silently degrading output quality), (b) untracked LLM cost bleed (every call logged
 * with token estimate so finance can attribute spend per site), (c) prompt-injection
 * via unescaped user input (renderer escapes `{{...}}` delimiters by default).
 *
 * Registry hot-patching: any `prompt:{id}@{version}` key in the `PROMPT_STORE` KV
 * namespace overrides the inline spec at resolve-time. Push corrected prompts via
 * `wrangler kv key put` without redeploying — see `src/prompts/registry.ts`.
 *
 * @example Basic inline call (v2 workflow style)
 * ```ts
 * import { runSiteGenerationWorkflowV2 } from './services/ai_workflows.js';
 *
 * const result = await runSiteGenerationWorkflowV2(env, {
 *   businessName: "Vito's Mens Salon",
 *   businessAddress: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
 *   uploadedAssets: ['org/abc/sites/123/uploads/storefront.jpg'],
 * });
 * await env.SITES_BUCKET.put(`sites/${slug}/v1/index.html`, result.html);
 * ```
 *
 * @example Direct `runPrompt` call (custom pipelines)
 * ```ts
 * import { runPrompt, extractJsonFromText } from './services/ai_workflows.js';
 *
 * const { output } = await runPrompt(env, 'research_profile', 1, {
 *   business_name: 'Acme Plumbing',
 *   business_address: '123 Main St',
 * });
 * const profile = extractJsonFromText(output) as ProfileResult;
 * ```
 *
 * @see ../prompts/registry.ts — version + variant resolution, KV hot-patching
 * @see ../prompts/renderer.ts — doctrine injection, `safeDelimit` prevention
 * @see ../prompts/observability.ts — D1 audit logging shape
 * @see ../workflows/site-generation.ts — production multi-page replacement
 * @see ../../CLAUDE.md — Mission Doctrine + Mandatory Invariants
 */

import type { Env } from '../types/env.js';
import type { PromptSpec, LlmCallResult } from '../prompts/types.js';
import { registry } from '../prompts/index.js';
import { renderPromptWithDoctrine } from '../prompts/renderer.js';
import { validatePromptInput, validatePromptOutput } from '../prompts/schemas.js';
import { withObservability } from '../prompts/observability.js';

// ── Core LLM call ────────────────────────────────────────────

/**
 * Central LLM call wrapper — every Workers AI inference in the codebase routes through this.
 *
 * @remarks
 * Five-step pipeline:
 *   1. {@link registry.resolve} the {@link PromptSpec} (with optional A/B variant via `seed` or `variant`).
 *   2. {@link validatePromptInput} against the prompt's Zod input schema (rejects malformed callers).
 *   3. {@link renderPrompt} the system + user templates with `safeDelimit:true` (prevents injection).
 *   4. {@link withObservability} wraps the actual `env.AI.run` call — emits prompt_id, version,
 *      input_hash (SHA-256), latency, outcome to D1 audit_logs for every call.
 *   5. Return {@link LlmCallResult} with the raw text + metadata.
 *
 * Centralization prevents three classes of bug: (a) silent prompt-version drift across services,
 * (b) untracked LLM cost bleed (every call logged with token estimate), (c) prompt-injection via
 * unescaped user input (renderer escapes `{{...}}` delimiters by default).
 *
 * Variant selection: `options.seed` deterministically routes by SHA-256(seed) % weight-sum, so
 * `orgId` as seed gives consistent A/B bucketing per tenant. `options.variant` forces a specific
 * variant ('a','b','c'). Neither set = default variant per registry config.
 *
 * @param env - Worker `Env` with `AI` binding (Workers AI).
 * @param promptId - Registry key, e.g. `'research_profile'` or `'generate_website'`.
 * @param version - Integer version. Multiple versions can coexist; pick the one matching your
 *   call-site's contract.
 * @param rawInputs - Untyped input bag. Validated against the prompt's input schema before render.
 * @param options.variant - Force a specific A/B variant (skips weighted selection).
 * @param options.seed - Deterministic variant selection key (e.g. `orgId`).
 * @param options.retryCount - Recorded in observability log; caller wraps in retry, this just tags.
 * @param options.modelOverride - Bypass the prompt's declared model list (use sparingly — defeats
 *   the purpose of prompt-spec model declarations).
 *
 * @throws `Error('Prompt not found: <id>@<v>')` when registry has no matching spec.
 * @throws `ZodError` from {@link validatePromptInput} when `rawInputs` violates the schema.
 * @throws Workers-AI errors (rate limits, model unavailable) — caller should retry.
 *
 * @example Basic call
 * ```ts
 * const result = await runPrompt(env, 'research_profile', 1, {
 *   business_name: 'Acme Plumbing',
 *   business_address: '123 Main St',
 * });
 * const profile = extractJsonFromText(result.output) as ProfileResult;
 * ```
 *
 * @example A/B variant (deterministic per org)
 * ```ts
 * const result = await runPrompt(env, 'site_copy', 3,
 *   { businessName, city, services, tone: 'premium' },
 *   { seed: orgId },
 * );
 * ```
 *
 * @see ../prompts/registry.ts — version + variant resolution
 * @see ../prompts/observability.ts — D1 audit logging shape
 * @see ../prompts/renderer.ts — `safeDelimit` injection prevention
 */
export async function runPrompt(
  env: Env,
  promptId: string,
  version: number,
  rawInputs: Record<string, unknown>,
  options: {
    variant?: string;
    seed?: string;
    retryCount?: number;
    modelOverride?: string;
  } = {},
): Promise<LlmCallResult> {
  // 1. Resolve the prompt spec (with optional A/B variant)
  let spec: PromptSpec | undefined;
  if (options.seed) {
    spec = registry.resolveVariant(promptId, version, options.seed);
  } else if (options.variant) {
    spec = registry.resolveExact(promptId, version, options.variant);
  } else {
    spec = registry.resolve(promptId, version);
  }

  if (!spec) {
    throw new Error(`Prompt not found: ${promptId}@${version}`);
  }

  // 2. Validate inputs against Zod schema
  const validated = validatePromptInput(promptId, rawInputs);
  const stringInputs: Record<string, string> = {};
  for (const [k, v] of Object.entries(validated)) {
    stringInputs[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
  }

  // 3. Render the prompt templates with HOLIEST / HIGHEST B-ORDER mission
  //    doctrine + Creativity + Love + Stars doctrine prepended to system.
  const rendered = renderPromptWithDoctrine(spec, stringInputs, { safeDelimit: true });
  const model = options.modelOverride ?? rendered.model;

  // 4. Call the LLM with observability wrapper
  const retryCount = options.retryCount ?? 0;

  const { result: output, log } = await withObservability(
    spec,
    model,
    validated,
    retryCount,
    async () => {
      const response = await env.AI.run(model as Parameters<Ai['run']>[0], {
        messages: [
          { role: 'system', content: rendered.system },
          { role: 'user', content: rendered.user },
        ],
        temperature: rendered.params.temperature,
        max_tokens: rendered.params.maxTokens,
      });

      const text =
        typeof response === 'string'
          ? response
          : ((response as { response?: string }).response ?? JSON.stringify(response));

      return { output: text, tokenCount: 0 };
    },
  );

  return {
    success: true,
    output,
    model,
    tokensUsed: log.tokenCount,
    latencyMs: log.latencyMs,
    promptId: spec.id,
    promptVersion: spec.version,
    promptVariant: spec.variant,
  };
}

/**
 * Extract JSON from an LLM response that may contain surrounding text or markdown fences.
 *
 * @remarks
 * LLMs (especially Llama-class) routinely violate "return ONLY JSON" instructions. Observed
 * failure modes in production:
 *   - Markdown code fences: ` ```json\n{...}\n``` `
 *   - Preface text: `"Based on the research, here is the JSON:\n{...}"`
 *   - Trailing commentary: `"{...}\n\nLet me know if you need adjustments."`
 *   - Nested objects with the JSON buried mid-paragraph
 *
 * Three-stage extraction (try-fast-fall-through):
 *   1. Direct `JSON.parse(trimmed)` — fast path when the LLM behaves.
 *   2. Markdown-fence regex — captures the body of the first \`\`\`json...\`\`\` block.
 *   3. First-`{`/`[` to last-matching-`}`/`]` substring — last-resort bracket walk.
 *
 * Note: the bracket walk uses naive `lastIndexOf` so it CAN match a `}` inside a string literal
 * embedded in the explanatory text. In practice this is rare because LLM commentary doesn't
 * contain unescaped braces. If you see parse failures on long preambles, audit the LLM output
 * for stray `{` in explanations and adjust the prompt to be stricter.
 *
 * @param text - Raw LLM output (may include fences, preface, trailing commentary).
 * @returns The parsed JSON value (object | array | primitive).
 * @throws {SyntaxError} When no recognizable JSON shape is found in the input.
 *
 * @example Markdown-fence wrapped output
 * ```ts
 * extractJsonFromText('```json\n{"name":"Acme"}\n```')
 * // → { name: 'Acme' }
 * ```
 *
 * @example Preface + JSON
 * ```ts
 * extractJsonFromText('Based on research:\n{"score": 0.85}\n\nNotes: ...')
 * // → { score: 0.85 }
 * ```
 *
 * @example Failure case
 * ```ts
 * extractJsonFromText('I cannot help with that request.')
 * // throws SyntaxError: No JSON found in LLM output: I cannot help...
 * ```
 *
 * @see runPrompt — every JSON-output prompt pipes through this after `runPrompt`
 */
export function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();

  // Fast path: already valid JSON
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue to extraction
  }

  // Try to extract from markdown code fences ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]!.trim());
    } catch {
      // continue
    }
  }

  // Find the first { or [ and match to the last } or ]
  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');
  let startIdx = -1;
  let endChar = '';

  if (firstBrace === -1 && firstBracket === -1) {
    throw new SyntaxError(`No JSON found in LLM output: ${trimmed.substring(0, 80)}...`);
  }

  if (firstBrace === -1) {
    startIdx = firstBracket;
    endChar = ']';
  } else if (firstBracket === -1) {
    startIdx = firstBrace;
    endChar = '}';
  } else {
    startIdx = Math.min(firstBrace, firstBracket);
    endChar = startIdx === firstBrace ? '}' : ']';
  }

  const lastEnd = trimmed.lastIndexOf(endChar);
  if (lastEnd <= startIdx) {
    throw new SyntaxError(`No matching closing bracket in LLM output: ${trimmed.substring(0, 80)}...`);
  }

  const candidate = trimmed.substring(startIdx, lastEnd + 1);
  return JSON.parse(candidate);
}

// ── Research Business ────────────────────────────────────────

/**
 * Legacy v1 research output — single-pass research producing all content fields at once.
 *
 * @remarks
 * Superseded by the v2 split (Profile + Social + Brand + SellingPoints + Images) in
 * {@link WorkflowResearch}. v1 is kept for the `/api/sites/improve-prompt` and
 * `/api/sites/generate-prompt` endpoints which only need lightweight content generation
 * without full brand/social research.
 *
 * Field constraints enforced by `validatePromptOutput('research_business', ...)`:
 *   - `tagline`: under 60 chars (used in hero subhead)
 *   - `description`: 2–3 sentences
 *   - `services`: 3–8 items
 *   - `faq`: 3–5 items
 *   - `seoTitle`: under 60 chars (HTML `<title>`)
 *   - `seoDescription`: under 160 chars (HTML `<meta name="description">`)
 *
 * @see runSiteGenerationWorkflowV2 — preferred multi-pass research pipeline
 * @see ../prompts/research_business.prompt.md — system + user prompt source
 */
export interface ResearchResult {
  businessName: string;
  tagline: string;
  description: string;
  services: string[];
  hours: Array<{ day: string; hours: string }>;
  faq: Array<{ question: string; answer: string }>;
  seoTitle: string;
  seoDescription: string;
}

/**
 * Legacy v1 single-pass business research.
 *
 * @remarks
 * Combines profile, services, hours, FAQ, and SEO meta into one LLM call. Faster than v2
 * (one prompt vs five) but lower quality — no separate brand color extraction, no social
 * link discovery, no image strategy. Use for fast prototyping or pre-edit copy refresh, NOT
 * for full site generation.
 *
 * Output is normalized: missing fields default to empty string / empty array. Caller never
 * sees `undefined` for required keys.
 *
 * @param env - Worker environment with `AI` binding.
 * @param input.businessName - Required. Drives the entire prompt.
 * @param input.businessPhone - Optional. Empty string when omitted (template-safe).
 * @param input.businessAddress - Optional. Used for "in {city}" SEO phrasing when present.
 * @param input.googlePlaceId - Optional. Hint for the LLM that Places-enriched data is available.
 * @param input.additionalContext - Optional free-form context (e.g., user-supplied bio).
 *
 * @throws {SyntaxError} When the LLM returns malformed JSON ({@link extractJsonFromText} fails).
 * @throws {ZodError} When the parsed JSON fails the `research_business` output schema.
 *
 * @example
 * ```ts
 * const research = await researchBusiness(env, {
 *   businessName: "Vito's Mens Salon",
 *   businessAddress: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
 * });
 * // → { businessName: "Vito's Mens Salon", tagline: 'Classic cuts...', services: [...] }
 * ```
 *
 * @see runSiteGenerationWorkflowV2 — the production multi-pass replacement
 */
export async function researchBusiness(
  env: Env,
  input: {
    businessName: string;
    businessPhone?: string;
    businessAddress?: string;
    googlePlaceId?: string;
    additionalContext?: string;
  },
): Promise<ResearchResult> {
  const result = await runPrompt(env, 'research_business', 2, {
    business_name: input.businessName,
    business_phone: input.businessPhone ?? '',
    business_address: input.businessAddress ?? '',
    google_place_id: input.googlePlaceId ?? '',
    additional_context: input.additionalContext ?? '',
  });

  const parsed = extractJsonFromText(result.output) as Record<string, unknown>;

  // Validate output schema
  const validated = validatePromptOutput('research_business', parsed) as Record<string, unknown>;

  return {
    businessName: String(validated.business_name ?? input.businessName),
    tagline: String(validated.tagline ?? ''),
    description: String(validated.description ?? ''),
    services: Array.isArray(validated.services) ? validated.services.map(String) : [],
    hours: Array.isArray(validated.hours)
      ? (validated.hours as Array<{ day: string; hours: string }>)
      : [],
    faq: Array.isArray(validated.faq)
      ? (validated.faq as Array<{ question: string; answer: string }>)
      : [],
    seoTitle: String(validated.seo_title ?? ''),
    seoDescription: String(validated.seo_description ?? ''),
  };
}

// ── Generate Site HTML ───────────────────────────────────────

/**
 * Legacy v1 single-page HTML generator from {@link ResearchResult}.
 *
 * @remarks
 * Produces a complete `<!DOCTYPE html>` document with embedded CSS, no external dependencies,
 * under 50KB. Sections: hero+CTA, services, about, hours, contact, FAQ. WCAG 2.1 AA target.
 *
 * Superseded by the v2 container-orchestrator pipeline (single-prompt orchestrator → parallel
 * subagents → multi-page Vite+React+Tailwind+shadcn output). v1 stays for the lightweight
 * prompt-improvement / single-page demo paths only.
 *
 * Output validation: `validatePromptOutput('generate_site', ...)` checks for `<!DOCTYPE html>`
 * presence — that's the only structural assertion. Real quality enforcement happens later via
 * {@link build_validators.validateBuild} once R2 upload completes.
 *
 * @param env - Worker environment with `AI` binding.
 * @param researchData - Output of {@link researchBusiness} (or compatible shape).
 * @returns Full HTML document string ready to upload to R2.
 *
 * @throws {Error} From the underlying schema validator if output lacks `<!DOCTYPE html>`.
 *
 * @example
 * ```ts
 * const research = await researchBusiness(env, { businessName: 'Acme' });
 * const html = await generateSiteHtml(env, research);
 * await env.SITES_BUCKET.put(`sites/${slug}/v1/index.html`, html);
 * ```
 *
 * @see runSiteGenerationWorkflowV2 — production multi-page pipeline
 * @see ../prompts/generate_site.prompt.md — system + user prompt source
 */
export async function generateSiteHtml(env: Env, researchData: ResearchResult): Promise<string> {
  const result = await runPrompt(env, 'generate_site', 2, {
    research_data: JSON.stringify(researchData),
  });

  // Validate output (must contain DOCTYPE)
  validatePromptOutput('generate_site', result.output);

  return result.output;
}

// ── Score Quality ────────────────────────────────────────────

/**
 * Legacy v1 quality score — superseded by {@link WebsiteScore} (8 dimensions vs 5).
 *
 * @remarks
 * All sub-scores normalized 0.0–1.0. `overall` is a weighted mean computed by the LLM (not
 * recomputed here — trust-but-verify the LLM's math when feeding into convergence loops).
 * Threshold convention: `overall < 0.6` → regenerate.
 *
 * @see WebsiteScore — v2 8-dimension replacement
 */
export interface QualityScore {
  scores: {
    accuracy: number;
    completeness: number;
    professionalism: number;
    seo: number;
    accessibility: number;
  };
  overall: number;
  issues: string[];
  suggestions: string[];
}

/**
 * Legacy v1 LLM-based quality score (5 dimensions: accuracy, completeness, professionalism,
 * SEO, accessibility).
 *
 * @remarks
 * Truncates input to 4000 chars to fit a small-context model. For 80KB+ HTML (typical v2
 * output), prefer {@link runScoreWebsite} which uses 6000 chars and 8 dimensions.
 *
 * LLM-as-judge has known biases: leniency on its own output (the same model that generated
 * the HTML scores it kindly), drift over time, and confabulated sub-scores when issues are
 * subtle. Use as a coarse signal — pair with deterministic validators ({@link build_validators})
 * for ground truth.
 *
 * @param env - Worker environment with `AI` binding.
 * @param htmlContent - Generated HTML (truncated to first 4000 chars for the model).
 * @returns Score envelope with sub-scores, overall, issue list, suggestion list.
 *
 * @throws {SyntaxError} When extraction fails ({@link extractJsonFromText}).
 * @throws {ZodError} When parsed JSON doesn't match the `score_quality` schema.
 *
 * @example
 * ```ts
 * const score = await scoreQuality(env, generatedHtml);
 * if (score.overall < 0.6) await regenerate();
 * for (const issue of score.issues) console.warn('quality', issue);
 * ```
 *
 * @see runScoreWebsite — v2 8-dimension replacement
 * @see ../prompts/score_quality.prompt.md — prompt source
 */
export async function scoreQuality(env: Env, htmlContent: string): Promise<QualityScore> {
  const result = await runPrompt(env, 'score_quality', 2, {
    html_content: htmlContent.substring(0, 4000),
  });

  const parsed = extractJsonFromText(result.output);

  // Validate output schema
  return validatePromptOutput('score_quality', parsed) as QualityScore;
}

// ── Site Copy (with A/B variant support) ─────────────────────

/**
 * Generate marketing copy for hero + benefits + about with deterministic A/B routing.
 *
 * @remarks
 * Two variants registered for prompt `site_copy@3`:
 *   - **Variant A (80% weight):** business-name-led hero — `"{businessName} | {city} {service}"`.
 *   - **Variant B (20% weight):** benefit-led hero — leads with the primary benefit, business
 *     name appears in subhead. Hypothesis: 15% CTR lift on benefit-led headlines.
 *
 * `orgId` as `seed` keeps each tenant on a stable variant across regenerations — required for
 * clean A/B analysis (mid-experiment variant flip would contaminate the result). Without
 * `orgId`, every call rolls weighted dice independently.
 *
 * Output is Markdown (not JSON) — caller must render to HTML before injecting into the page.
 *
 * @param env - Worker environment with `AI` binding.
 * @param input.businessName - Brand display name.
 * @param input.city - Location string for "{benefit} in {city}" SEO phrasing.
 * @param input.services - Service list (joined with `, ` by {@link runPrompt}).
 * @param input.tone - One of `'friendly' | 'premium' | 'no-nonsense'`. Strict tone-guide enforcement.
 * @param orgId - Optional. Deterministic variant seed — same `orgId` always gets same variant.
 * @returns Markdown string with hero, benefits, about sections.
 *
 * @example Stable per-tenant A/B
 * ```ts
 * const md = await generateSiteCopy(env, {
 *   businessName: 'Acme',
 *   city: 'Newark, NJ',
 *   services: ['plumbing','heating'],
 *   tone: 'no-nonsense',
 * }, orgId);
 * ```
 *
 * @see ../prompts/site_copy.prompt.md — variant A source
 * @see ../prompts/site_copy_v3b.prompt.md — variant B source
 * @see ../prompts/registry.ts — `configureVariants` weight table
 */
export async function generateSiteCopy(
  env: Env,
  input: {
    businessName: string;
    city: string;
    services: string[];
    tone: 'friendly' | 'premium' | 'no-nonsense';
  },
  orgId?: string,
): Promise<string> {
  const result = await runPrompt(
    env,
    'site_copy',
    3,
    {
      businessName: input.businessName,
      city: input.city,
      services: input.services,
      tone: input.tone,
    },
    {
      seed: orgId, // deterministic A/B variant selection by org
    },
  );

  return result.output;
}

// ── Full Site Generation Workflow (legacy v1) ────────────────

/**
 * Legacy v1 sequential site generation: research → HTML → quality score.
 *
 * @remarks
 * Three-step pipeline with NO parallelization, NO container build, NO subagent fan-out.
 * Produces a single-page HTML site under 50KB. Total runtime: ~30–90 s.
 *
 * Kept ONLY for the prompt-improvement / quick-demo paths and historical comparison. The
 * production pipeline is {@link runSiteGenerationWorkflowV2} which orchestrates 5+ parallel
 * research prompts plus a Cloudflare Container running Claude Code with full subagent fan-out.
 *
 * No D1 writes, no R2 upload, no Cloudflare Workflow durability — caller is responsible for
 * persistence. Use for ad-hoc generation only.
 *
 * @param env - Worker environment with `AI` binding.
 * @param input.businessName - Required.
 * @param input.businessPhone - Optional.
 * @param input.businessAddress - Optional.
 * @param input.googlePlaceId - Optional.
 *
 * @returns `{ research, html, quality }` — three-step output.
 *
 * @throws Propagates errors from {@link researchBusiness}, {@link generateSiteHtml}, {@link scoreQuality}.
 *
 * @example
 * ```ts
 * const { html, quality } = await runSiteGenerationWorkflow(env, {
 *   businessName: 'Acme',
 *   businessAddress: '123 Main St',
 * });
 * if (quality.overall >= 0.7) await env.SITES_BUCKET.put(key, html);
 * ```
 *
 * @see runSiteGenerationWorkflowV2 — production replacement
 */
export async function runSiteGenerationWorkflow(
  env: Env,
  input: {
    businessName: string;
    businessPhone?: string;
    businessAddress?: string;
    googlePlaceId?: string;
  },
): Promise<{
  research: ResearchResult;
  html: string;
  quality: QualityScore;
}> {
  // Step 1: Research the business
  const research = await researchBusiness(env, input);

  // Step 2: Generate the website HTML
  const html = await generateSiteHtml(env, research);

  // Step 3: Score the quality
  const quality = await scoreQuality(env, html);

  return { research, html, quality };
}

// ══════════════════════════════════════════════════════════════
// V2 WORKFLOW: Parallelized research + full website generation
// ══════════════════════════════════════════════════════════════

import type {
  ResearchProfileOutput as ProfileResult,
  ResearchSocialOutput as SocialResult,
  ResearchBrandOutput as BrandResult,
  ResearchSellingPointsOutput as SellingPointsResult,
  ResearchImagesOutput as ImagesResult,
  ScoreWebsiteOutput as WebsiteScore,
} from '../prompts/schemas.js';

/**
 * Input contract for the v2 site generation workflow.
 *
 * @remarks
 * The minimum viable input is `businessName` alone — every other field is optional and the
 * pipeline will research/infer missing pieces. In practice the API surface always supplies at
 * least name + address (Google Places search prefills) and `additionalContext` (user textarea).
 *
 * `uploadedAssets` is the R2 key list of user-uploaded files (logos, photos, brochure PDFs)
 * that the container orchestrator MUST surface in the rebuilt site. Format: `['org/{orgId}/sites/{siteId}/uploads/{filename}', ...]`.
 *
 * @see ../routes/api.ts → POST /api/sites/create-from-search — primary caller
 * @see runSiteGenerationWorkflowV2 — consumer
 */
export interface WorkflowInput {
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  googlePlaceId?: string;
  additionalContext?: string;
  uploadedAssets?: string[];
}

/**
 * Aggregated output of all five parallel research prompts.
 *
 * @remarks
 * Built in two passes: profile (sequential, blocks the rest), then social/brand/selling-points/
 * images in parallel. All five outputs are persisted to R2 at `org/{orgId}/sites/{siteId}/_research.json`
 * for the container build context, and the brand sub-block is written to D1 `research_data` table
 * for fast reload during user edits.
 *
 * @see ../prompts/schemas.ts — full Zod shape per sub-block
 * @see runSiteGenerationWorkflowV2 — producer
 */
export interface WorkflowResearch {
  profile: ProfileResult;
  social: SocialResult;
  brand: BrandResult;
  sellingPoints: SellingPointsResult;
  images: ImagesResult;
}

/**
 * Full v2 workflow output — what the workflow step ultimately persists to R2.
 *
 * @remarks
 * NOT the production output anymore — the production pipeline now produces a multi-page
 * Vite+React+Tailwind+shadcn site via the container orchestrator (see workflows/site-generation.ts
 * `build-orchestrator` step). This shape is retained for the inline-LLM fallback path and the
 * v2 unit tests.
 *
 * `quality.overall < 0.6` triggers regeneration in the legacy path.
 *
 * @see runSiteGenerationWorkflowV2 — producer
 * @see ../workflows/site-generation.ts — production multi-page replacement
 */
export interface WorkflowResult {
  research: WorkflowResearch;
  html: string;
  privacyHtml: string;
  termsHtml: string;
  quality: WebsiteScore;
}

// ── Phase 1: Profile Research ────────────────────────────────

async function runResearchProfile(env: Env, input: WorkflowInput): Promise<ProfileResult> {
  const result = await runPrompt(env, 'research_profile', 1, {
    business_name: input.businessName,
    business_address: input.businessAddress ?? '',
    business_phone: input.businessPhone ?? '',
    google_place_id: input.googlePlaceId ?? '',
    additional_context: input.additionalContext ?? '',
  });
  return validatePromptOutput('research_profile', extractJsonFromText(result.output)) as ProfileResult;
}

// ── Phase 2: Parallel Research ───────────────────────────────

async function runResearchSocial(
  env: Env, input: WorkflowInput, businessType: string,
): Promise<SocialResult> {
  const result = await runPrompt(env, 'research_social', 1, {
    business_name: input.businessName,
    business_address: input.businessAddress ?? '',
    business_type: businessType,
  });
  return validatePromptOutput('research_social', extractJsonFromText(result.output)) as SocialResult;
}

async function runResearchBrand(
  env: Env, input: WorkflowInput, businessType: string, websiteUrl: string,
): Promise<BrandResult> {
  // Step 1: If website exists, extract REAL colors via GPT-4o vision (Anthropic fallback)
  // This prevents the LLM from guessing colors based on industry stereotypes
  let extractedColors = '';
  if (websiteUrl && (env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY)) {
    try {
      const { callExternalLLMWithVision } = await import('./external_llm.js');
      // Use a lightweight screenshot proxy or instruct the LLM to analyze the URL
      const colorResult = await callExternalLLMWithVision(env, {
        system: `You are a brand color extraction specialist. Given a website URL, describe the EXACT brand colors used on the site. Focus on:
1. Logo dominant color (HIGHEST PRIORITY — this IS the brand color)
2. Header/nav colors
3. CTA button colors
4. Accent/link colors
Return ONLY a JSON object: {"primary":"#hex","secondary":"#hex","accent":"#hex","source":"extracted_from_website","confidence":"high|medium|low","notes":"..."}
Do NOT guess. If you cannot determine from the URL alone, set confidence to "low".`,
        user: `Extract the brand colors from this website: ${websiteUrl}
Business: ${input.businessName} (${businessType})
Look at the logo and header area first — the logo color defines the primary brand color.`,
        jsonMode: true,
        maxTokens: 500,
        provider: 'openai',
      });
      const parsed = JSON.parse(colorResult.output);
      if (parsed.primary && parsed.confidence !== 'low') {
        extractedColors = `\n\nIMPORTANT — Pre-extracted brand colors from the actual website (via GPT-4o vision):
Primary: ${parsed.primary} (from ${parsed.source})
Secondary: ${parsed.secondary || 'not determined'}
Accent: ${parsed.accent || 'not determined'}
Notes: ${parsed.notes || 'none'}
Confidence: ${parsed.confidence}
USE THESE COLORS as the primary palette. Do NOT override with industry-generic colors.`;
      }
      console.warn(JSON.stringify({ level: 'info', service: 'ai_workflows', step: 'color_extraction', website: websiteUrl, colors: parsed }));
    } catch (err) {
      // Non-fatal — fall back to LLM color inference
      console.warn(JSON.stringify({ level: 'warn', service: 'ai_workflows', step: 'color_extraction', error: err instanceof Error ? err.message : String(err) }));
    }
  }

  const result = await runPrompt(env, 'research_brand', 1, {
    business_name: input.businessName,
    business_type: businessType,
    business_address: input.businessAddress ?? '',
    website_url: websiteUrl,
    additional_context: (input.additionalContext ?? '') + extractedColors,
  });
  return validatePromptOutput('research_brand', extractJsonFromText(result.output)) as BrandResult;
}

async function runResearchSellingPoints(
  env: Env, input: WorkflowInput, businessType: string,
  servicesJson: string, description: string,
): Promise<SellingPointsResult> {
  const result = await runPrompt(env, 'research_selling_points', 1, {
    business_name: input.businessName,
    business_type: businessType,
    services_json: servicesJson,
    description,
    additional_context: input.additionalContext ?? '',
  });
  return validatePromptOutput(
    'research_selling_points', extractJsonFromText(result.output),
  ) as SellingPointsResult;
}

async function runResearchImages(
  env: Env, input: WorkflowInput, businessType: string, servicesJson: string,
): Promise<ImagesResult> {
  const result = await runPrompt(env, 'research_images', 1, {
    business_name: input.businessName,
    business_type: businessType,
    business_address: input.businessAddress ?? '',
    services_json: servicesJson,
    additional_context: input.additionalContext ?? '',
  });
  return validatePromptOutput('research_images', extractJsonFromText(result.output)) as ImagesResult;
}

// ── Phase 3: Website Generation ──────────────────────────────

async function runGenerateWebsite(
  env: Env, research: WorkflowResearch, uploads?: string[],
): Promise<string> {
  const result = await runPrompt(env, 'generate_website', 1, {
    profile_json: JSON.stringify(research.profile),
    brand_json: JSON.stringify(research.brand),
    selling_points_json: JSON.stringify(research.sellingPoints),
    social_json: JSON.stringify(research.social),
    images_json: JSON.stringify(research.images),
    uploads_json: uploads ? JSON.stringify(uploads) : '',
  });
  validatePromptOutput('generate_website', result.output);
  return result.output;
}

// ── Phase 4: Legal Pages ─────────────────────────────────────

async function runGenerateLegalPage(
  env: Env, research: WorkflowResearch, pageType: 'privacy' | 'terms',
): Promise<string> {
  const addr = research.profile.address;
  const addressStr = [addr.street, addr.city, addr.state, addr.zip]
    .filter(Boolean).join(', ');

  const result = await runPrompt(env, 'generate_legal_pages', 1, {
    business_name: research.profile.business_name,
    brand_json: JSON.stringify(research.brand),
    page_type: pageType,
    business_address: addressStr,
    business_email: research.profile.email ?? '',
    website_url: research.social.website_url ?? '',
  });
  validatePromptOutput('generate_legal_pages', result.output);
  return result.output;
}

// ── Phase 4: Quality Scoring ─────────────────────────────────

async function runScoreWebsite(
  env: Env, html: string, businessName: string,
): Promise<WebsiteScore> {
  const result = await runPrompt(env, 'score_website', 1, {
    html_content: html.substring(0, 6000),
    business_name: businessName,
  });
  return validatePromptOutput('score_website', extractJsonFromText(result.output)) as WebsiteScore;
}

// ── V2 Full Workflow Orchestration ───────────────────────────

/**
 * V2 inline-LLM site generation workflow with parallelized research.
 *
 * @remarks
 * Four-phase pipeline running entirely on Workers AI (no container, no subagents):
 *   - **Phase 1 (sequential, ~10s):** `runResearchProfile` — produces `business_type` which all
 *     downstream prompts depend on for industry-specific context.
 *   - **Phase 2 (parallel, ~15s):** `runResearchSocial`, `runResearchBrand`,
 *     `runResearchSellingPoints`, `runResearchImages` fan out via `Promise.all`. Brand step
 *     additionally invokes GPT-4o vision for color extraction when an existing website URL is
 *     present (prevents the LLM from guessing industry-stereotype colors — the
 *     {@link feedback_brand_color_extraction} 2025-04 njsk.org burgundy incident).
 *   - **Phase 3 (sequential, ~30s):** `runGenerateWebsite` produces the full HTML using all
 *     accumulated research as input. Token-heavy (16k max).
 *   - **Phase 4 (parallel, ~20s):** Privacy page + terms page + 8-dimension quality score run
 *     concurrently — they share no inputs that could change between calls.
 *
 * Total wall-clock: ~75s when Workers AI is responsive.
 *
 * **NOT the production pipeline.** Production uses the container orchestrator (see
 * `workflows/site-generation.ts` `build-orchestrator` step) which runs Claude Opus 4.7 with
 * full subagent fan-out and produces multi-page Vite+React+Tailwind+shadcn output. This
 * function survives as the inline-LLM fallback path and the integration-test harness.
 *
 * Phase boundaries log structured JSON via `console.warn` for D1 audit log correlation.
 *
 * @param env - Worker environment with `AI` binding + optional `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`
 *   for vision-based color extraction.
 * @param input - {@link WorkflowInput}.
 * @returns {@link WorkflowResult} with research blocks, main HTML, legal pages, and 8-dim score.
 *
 * @throws Propagates Workers AI errors, schema validation errors, JSON parse errors from any phase.
 *   Phase 2 brand color extraction failures are non-fatal — caught and logged, falls back to
 *   LLM-inferred colors.
 *
 * @example
 * ```ts
 * const result = await runSiteGenerationWorkflowV2(env, {
 *   businessName: "Vito's Mens Salon",
 *   businessAddress: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
 *   uploadedAssets: ['org/abc/sites/123/uploads/storefront.jpg'],
 * });
 * await env.SITES_BUCKET.put(`sites/${slug}/v1/index.html`, result.html);
 * await env.SITES_BUCKET.put(`sites/${slug}/v1/privacy.html`, result.privacyHtml);
 * await env.SITES_BUCKET.put(`sites/${slug}/v1/terms.html`, result.termsHtml);
 * ```
 *
 * @see ../workflows/site-generation.ts → build-orchestrator — production replacement
 * @see external_llm.callExternalLLMWithVision — color extraction integration
 */
export async function runSiteGenerationWorkflowV2(
  env: Env,
  input: WorkflowInput,
): Promise<WorkflowResult> {
  // Phase 1: Research profile first (we need business_type for other prompts)
  const profile = await runResearchProfile(env, input);

  console.warn(JSON.stringify({
    level: 'info', service: 'ai_workflow', phase: 1,
    message: 'Profile research complete',
    business_type: profile.business_type,
  }));

  // Phase 2: Parallel research (all depend on profile.business_type)
  const servicesJson = JSON.stringify(profile.services.map((s) => s.name));

  const bizType = profile.business_type ?? 'general';
  const bizDesc = profile.description ?? '';

  const [social, brand, sellingPoints, images] = await Promise.all([
    runResearchSocial(env, input, bizType),
    runResearchBrand(env, input, bizType, ''),
    runResearchSellingPoints(env, input, bizType, servicesJson, bizDesc),
    runResearchImages(env, input, bizType, servicesJson),
  ]);

  const research: WorkflowResearch = { profile, social, brand, sellingPoints, images };

  console.warn(JSON.stringify({
    level: 'info', service: 'ai_workflow', phase: 2,
    message: 'Parallel research complete',
    social_links_found: social.social_links.filter((l) => l.url && (l.confidence ?? 0) >= 0.9).length,
    logo_found: brand.logo.found_online,
  }));

  // Phase 3: Generate main website HTML
  const html = await runGenerateWebsite(env, research, input.uploadedAssets);

  console.warn(JSON.stringify({
    level: 'info', service: 'ai_workflow', phase: 3,
    message: 'Website HTML generated', html_size: html.length,
  }));

  // Phase 4: Parallel - legal pages + quality scoring
  const [privacyHtml, termsHtml, quality] = await Promise.all([
    runGenerateLegalPage(env, research, 'privacy'),
    runGenerateLegalPage(env, research, 'terms'),
    runScoreWebsite(env, html, input.businessName),
  ]);

  console.warn(JSON.stringify({
    level: 'info', service: 'ai_workflow', phase: 4,
    message: 'Legal pages and scoring complete',
    quality_score: quality.overall,
    missing_sections: quality.missing_sections,
  }));

  return { research, html, privacyHtml, termsHtml, quality };
}

// ── Prompt Registration (called at startup) ──────────────────

/**
 * Register every prompt spec used by this Worker into the in-memory {@link registry}.
 *
 * @remarks
 * Two-step registration keeps the bundle simple:
 *   1. Legacy v2 prompts: `research_business`, `generate_site`, `score_quality`, `site_copy`
 *      (variants A + B).
 *   2. V2 workflow prompts: `research_profile`, `research_social`, `research_brand`,
 *      `research_selling_points`, `research_images`, `generate_website`, `generate_legal_pages`,
 *      `score_website`.
 *
 * Each spec is defined inline here AND mirrored as a `.prompt.md` file under `/prompts/`. The
 * inline spec is the **runtime source of truth** (bundled with the Worker for cold-start speed).
 * The `.md` file is the **human review surface** — when editing a prompt, edit BOTH and verify
 * with `npm test` (parser tests assert MD↔inline parity).
 *
 * Call this exactly once at Worker startup (typically from `src/index.ts` initialization). The
 * registry is module-singleton so a second call is a no-op but still wastes CPU. Idempotency
 * is enforced inside `registry.registerAll` via internal de-dup on `(id, version, variant)` tuple.
 *
 * Variant A/B weights are configured via {@link registry.configureVariants} after the
 * `site_copy@3` registrations — 80/20 split, deterministic when caller supplies a seed.
 *
 * KV hot-patching: any `prompt:{id}@{version}` key in the `PROMPT_STORE` KV namespace overrides
 * the inline spec at resolve-time. This is the emergency hotfix path — push a corrected prompt
 * via `wrangler kv key put` without redeploying. See `../prompts/registry.ts`.
 *
 * @example
 * ```ts
 * // src/index.ts
 * import { registerAllPrompts } from './services/ai_workflows';
 * registerAllPrompts(); // module load — runs once per isolate
 * ```
 *
 * @see ../prompts/registry.ts — registry implementation, KV hot-patching
 * @see ../prompts/parser.ts — .prompt.md parser (asserts MD↔inline parity in tests)
 */
export function registerAllPrompts(): void {
  registry.registerAll([
    {
      id: 'research_business',
      version: 2,
      description: 'Research a business using public data to generate structured website content',
      models: ['@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-3.1-8b-instruct'],
      params: { temperature: 0.3, maxTokens: 4096 },
      inputs: {
        required: ['business_name'],
        optional: ['business_phone', 'business_address', 'google_place_id', 'additional_context'],
      },
      outputs: { format: 'json', schema: 'ResearchBusinessOutput' },
      notes: {
        pii: 'Avoid customer personal data in generated content',
        quality: 'Verify claims are factually plausible',
      },
      system: [
        'You are a business research assistant specializing in small and local businesses.',
        'Given a business name and optional details, produce structured JSON content for a professional website.',
        '',
        'Rules:',
        '- All claims must be factually plausible and generic enough to be accurate.',
        '- Never fabricate specific reviews, testimonials, or customer names.',
        '- Keep the tone professional and confident.',
        '- If data is insufficient, produce reasonable defaults for the business type.',
        '',
        'Return valid JSON with: business_name, tagline (under 60 chars), description (2-3 sentences),',
        'services (3-8 items), hours [{day, hours}], faq [{question, answer}] (3-5 items),',
        'seo_title (under 60 chars), seo_description (under 160 chars).',
      ].join('\n'),
      user: [
        'Business Name: {{business_name}}',
        'Business Phone: {{business_phone}}',
        'Business Address: {{business_address}}',
        'Google Place ID: {{google_place_id}}',
        'Additional Context: {{additional_context}}',
        '',
        'Research this business and return the JSON structure described above.',
      ].join('\n'),
    },
    {
      id: 'generate_site',
      version: 2,
      description: 'Generate a complete single-page HTML website from structured business data',
      models: ['@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-3.1-8b-instruct'],
      params: { temperature: 0.2, maxTokens: 8192 },
      inputs: { required: ['research_data'], optional: [] },
      outputs: { format: 'html', schema: 'GenerateSiteOutput' },
      notes: { size: 'Under 50KB', accessibility: 'WCAG 2.1 AA' },
      system: [
        'You are a web designer that generates clean, mobile-first, single-page HTML websites.',
        'The output must be a complete, self-contained HTML file with embedded CSS.',
        '',
        'Requirements:',
        '- Mobile-first responsive design using modern CSS (grid, flexbox)',
        '- Semantic HTML5 elements',
        '- Sections: hero with CTA, services, about, hours, contact, FAQ',
        '- No external dependencies',
        '- Under 50KB total, WCAG 2.1 AA accessible',
        '',
        'Return ONLY a complete HTML document starting with <!DOCTYPE html>.',
      ].join('\n'),
      user: 'Here is the structured business data:\n\n{{research_data}}\n\nGenerate the complete HTML website now.',
    },
    {
      id: 'score_quality',
      version: 2,
      description: 'Score the quality of generated website HTML on multiple dimensions',
      models: ['@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-3.1-8b-instruct'],
      params: { temperature: 0.1, maxTokens: 1024 },
      inputs: { required: ['html_content'], optional: [] },
      outputs: { format: 'json', schema: 'ScoreQualityOutput' },
      notes: { scoring: 'All scores 0.0-1.0', threshold: 'Below 0.6 = regenerate' },
      system: [
        'You are a quality assurance reviewer for generated websites.',
        'Score on: accuracy, completeness, professionalism, seo, accessibility (each 0.0-1.0).',
        'Return JSON: { "scores": {...}, "overall": number, "issues": [], "suggestions": [] }',
      ].join('\n'),
      user: 'Score the following website HTML:\n\n{{html_content}}',
    },
    {
      id: 'site_copy',
      version: 3,
      description: 'Generate conversion-focused marketing copy for a small business website',
      models: ['@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-3.1-8b-instruct'],
      params: { temperature: 0.6, maxTokens: 900 },
      inputs: {
        required: ['businessName', 'city', 'services', 'tone'],
        optional: [],
      },
      outputs: { format: 'markdown', schema: 'SiteCopyOutput' },
      notes: { pii: 'Avoid customer personal data', brand: 'Follow tone strictly' },
      system: [
        'You are a conversion-focused copywriter for small business websites.',
        'Follow the brand tone exactly and keep all claims verifiable.',
        '',
        'Tone guide:',
        '- friendly: Warm, approachable, community-focused.',
        '- premium: Sophisticated, confident, quality-first.',
        '- no-nonsense: Direct, efficient, facts-first.',
      ].join('\n'),
      user: [
        'Business: {{businessName}}',
        'City: {{city}}',
        'Services: {{services}}',
        'Tone: {{tone}}',
        '',
        'Write:',
        '1) Hero headline + subhead + 2 CTAs',
        '2) Three benefit bullets',
        '3) Short About section',
        'Return in Markdown.',
      ].join('\n'),
    },
    {
      id: 'site_copy',
      version: 3,
      variant: 'b',
      description: 'Generate conversion-focused marketing copy (variant B: benefit-led)',
      models: ['@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-3.1-8b-instruct'],
      params: { temperature: 0.7, maxTokens: 900 },
      inputs: {
        required: ['businessName', 'city', 'services', 'tone'],
        optional: [],
      },
      outputs: { format: 'markdown', schema: 'SiteCopyOutput' },
      notes: {
        pii: 'Avoid customer personal data',
        ab_test: 'Variant B: benefit-led hero',
        hypothesis: 'Benefit-led headlines increase CTR by 15%',
      },
      system: [
        'You are a conversion-focused copywriter for small business websites.',
        'This variant emphasizes benefits over brand name in headlines.',
        'Follow the brand tone exactly and keep all claims verifiable.',
        '',
        'IMPORTANT: The hero headline must lead with the primary BENEFIT,',
        'not the business name. The business name appears in the subhead.',
      ].join('\n'),
      user: [
        'Business: {{businessName}}',
        'City: {{city}}',
        'Services: {{services}}',
        'Tone: {{tone}}',
        '',
        'Write:',
        '1) Hero headline (benefit-led) + subhead with business name + 2 CTAs',
        '2) Three benefit bullets',
        '3) Short About section',
        'Return in Markdown.',
      ].join('\n'),
    },
  ]);

  // Configure A/B test: 80% variant a (default), 20% variant b
  registry.configureVariants('site_copy', 3, { a: 80, b: 20 });

  // ── V2 Workflow Prompts ──────────────────────────────────────

  const defaultModels = ['@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-3.1-8b-instruct'];

  registry.registerAll([
    {
      id: 'research_profile',
      version: 1,
      description: 'Deep business profile research',
      models: defaultModels,
      params: { temperature: 0.3, maxTokens: 4096 },
      inputs: {
        required: ['business_name'],
        optional: ['business_address', 'business_phone', 'google_place_id', 'additional_context'],
      },
      outputs: { format: 'json', schema: 'ResearchProfileOutput' },
      notes: { pii: 'No customer PII' },
      system: [
        'You are a business intelligence analyst. Produce a comprehensive JSON profile for a professional portfolio website.',
        'Infer business type from name/context. Generate plausible hours, services (4-8), and FAQ (3-5).',
        'All text must be professional, concise, and free of jargon.',
        'Return valid JSON matching the schema: business_name, tagline, description, mission_statement,',
        'business_type, services[{name,description,price_hint}], hours[{day,open,close,closed}],',
        'phone, email, address{street,city,state,zip,country}, faq[{question,answer}],',
        'seo_title (under 60 chars), seo_description (under 160 chars).',
      ].join('\n'),
      user: [
        'Business Name: {{business_name}}',
        'Address: {{business_address}}',
        'Phone: {{business_phone}}',
        'Google Place ID: {{google_place_id}}',
        'Additional Context: {{additional_context}}',
        '',
        'Research this business thoroughly and return the JSON profile.',
      ].join('\n'),
    },
    {
      id: 'research_social',
      version: 1,
      description: 'Discover social media profiles and online presence',
      models: defaultModels,
      params: { temperature: 0.2, maxTokens: 2048 },
      inputs: {
        required: ['business_name'],
        optional: ['business_address', 'business_type'],
      },
      outputs: { format: 'json', schema: 'ResearchSocialOutput' },
      notes: { confidence: '90%+ confidence only' },
      system: [
        'You are a social media researcher. Determine the most likely social media URLs for this business.',
        'Only return URLs with 90%+ confidence. Include confidence scores (0.0-1.0).',
        'Check: Facebook, Instagram, X/Twitter, LinkedIn, Yelp, Google Maps, TikTok, YouTube, Pinterest.',
        'Return JSON: { social_links[{platform,url,confidence}], website_url, review_platforms[{platform,url,rating}] }',
      ].join('\n'),
      user: [
        'Business Name: {{business_name}}',
        'Address: {{business_address}}',
        'Business Type: {{business_type}}',
        '',
        'Find social media profiles. Only include links where confidence >= 0.9.',
      ].join('\n'),
    },
    {
      id: 'research_brand',
      version: 1,
      description: 'Determine brand identity - colors, fonts, logo, style',
      models: defaultModels,
      params: { temperature: 0.3, maxTokens: 2048 },
      inputs: {
        required: ['business_name', 'business_type'],
        optional: ['business_address', 'website_url', 'additional_context'],
      },
      outputs: { format: 'json', schema: 'ResearchBrandOutput' },
      notes: { colors: 'Appropriate for industry' },
      system: [
        'You are a brand identity consultant. Determine visual brand identity for this business.',
        'Suggest 3-5 colors (hex) appropriate for the industry. Recommend Google Fonts.',
        'For logo: indicate if findable online or needs generation. If generating, describe a text-based logo.',
        'Return JSON: { logo{found_online,search_query,fallback_design{text,font,accent_shape,accent_color}},',
        'colors{primary,secondary,accent,background,surface,text_primary,text_secondary},',
        'fonts{heading,body}, brand_personality, style_notes }',
      ].join('\n'),
      user: [
        'Business Name: {{business_name}}',
        'Business Type: {{business_type}}',
        'Address: {{business_address}}',
        'Website: {{website_url}}',
        'Additional Context: {{additional_context}}',
        '',
        'Determine the brand identity.',
      ].join('\n'),
    },
    {
      id: 'research_selling_points',
      version: 1,
      description: 'Identify top 3 USPs and hero content',
      models: defaultModels,
      params: { temperature: 0.4, maxTokens: 2048 },
      inputs: {
        required: ['business_name', 'business_type'],
        optional: ['services_json', 'description', 'additional_context'],
      },
      outputs: { format: 'json', schema: 'ResearchSellingPointsOutput' },
      notes: { icons: 'Use Lucide icon names' },
      system: [
        'You are a marketing strategist. Identify exactly 3 selling points for this business.',
        'Each has: headline (3-6 words), description (2-3 sentences), icon (Lucide icon name).',
        'Also generate 2-3 hero slogans with CTAs and 3-5 benefit bullets.',
        'Icons: shield-check, clock, star, heart, zap, award, users, thumbs-up, scissors, wrench, utensils.',
        'Return JSON: { selling_points[3], hero_slogans[{headline,subheadline,cta_primary,cta_secondary}],',
        'benefit_bullets[] }',
      ].join('\n'),
      user: [
        'Business Name: {{business_name}}',
        'Business Type: {{business_type}}',
        'Services: {{services_json}}',
        'Description: {{description}}',
        'Additional Context: {{additional_context}}',
        '',
        'Identify the top 3 selling points and hero content.',
      ].join('\n'),
    },
    {
      id: 'research_images',
      version: 1,
      description: 'Determine image needs and search strategies',
      models: defaultModels,
      params: { temperature: 0.3, maxTokens: 2048 },
      inputs: {
        required: ['business_name', 'business_type'],
        optional: ['business_address', 'services_json', 'additional_context'],
      },
      outputs: { format: 'json', schema: 'ResearchImagesOutput' },
      notes: { confidence: '90%+ for real images' },
      system: [
        'You are a visual content strategist. Determine image needs for this business website.',
        'For hero carousel: 3 image concepts. For each: specific search query and stock fallback.',
        'Include storefront, team, and service images with confidence scores.',
        'Return JSON: { hero_images[], storefront_image, team_image, service_images[],',
        'placeholder_strategy (gradient|pattern|illustration) }',
      ].join('\n'),
      user: [
        'Business Name: {{business_name}}',
        'Business Type: {{business_type}}',
        'Address: {{business_address}}',
        'Services: {{services_json}}',
        'Additional Context: {{additional_context}}',
        '',
        'Determine image needs and search strategies.',
      ].join('\n'),
    },
    {
      id: 'generate_website',
      version: 1,
      description: 'Generate complete portfolio website from all research data',
      models: defaultModels,
      params: { temperature: 0.2, maxTokens: 16000 },
      inputs: {
        required: ['profile_json', 'brand_json', 'selling_points_json', 'social_json'],
        optional: ['images_json', 'uploads_json', 'privacy_template', 'terms_template'],
      },
      outputs: { format: 'html', schema: 'GenerateWebsiteOutput' },
      notes: { size: 'Under 80KB', a11y: 'WCAG 2.1 AA' },
      system: [
        'You are an elite web designer creating gorgeous, concise, intuitive business portfolio websites.',
        'Produce a complete HTML file with embedded CSS and minimal inline JS.',
        '',
        'Required sections: 1) Hero with CSS carousel (3 slides, auto-rotating), gradient overlays, CTAs.',
        '2) Selling points (3 cards with SVG icons). 3) About with mission blockquote.',
        '4) Services grid with CTA. 5) Full-width Google Maps embed.',
        '6) Contact form (name, email, phone, message). 7) Social media icon links (inline SVGs).',
        '8) Footer with copyright, /privacy and /terms links.',
        '',
        'Technical: Mobile-first, CSS custom properties, Google Fonts, semantic HTML5,',
        'smooth scroll, fadeInUp animations, WCAG 2.1 AA, SEO meta + Open Graph tags.',
        'No frameworks. Under 80KB. Return ONLY <!DOCTYPE html> document.',
      ].join('\n'),
      user: [
        '## Business Profile\n{{profile_json}}',
        '\n## Brand Identity\n{{brand_json}}',
        '\n## Selling Points & Hero\n{{selling_points_json}}',
        '\n## Social Media\n{{social_json}}',
        '\n## Images\n{{images_json}}',
        '\n## Uploads\n{{uploads_json}}',
        '\nGenerate the complete, gorgeous HTML website now.',
      ].join('\n'),
    },
    {
      id: 'generate_legal_pages',
      version: 1,
      description: 'Generate privacy policy or terms of service page',
      models: defaultModels,
      params: { temperature: 0.1, maxTokens: 12000 },
      inputs: {
        required: ['business_name', 'brand_json', 'page_type'],
        optional: ['business_address', 'business_email', 'website_url'],
      },
      outputs: { format: 'html', schema: 'GenerateLegalPageOutput' },
      notes: { legal: 'Generic, not legal advice' },
      system: [
        'Generate a privacy policy or terms of service page for a small business website.',
        'Match the main site visual design from brand data.',
        'Include header (business name linking to /), the legal content, and matching footer.',
        '',
        'Privacy sections: Introduction, Info We Collect, When We Collect, How We Use,',
        'How We Protect, Cookies, Third-Party Disclosure, Third-Party Links,',
        'Children Privacy, Data Breach Notice, Your Rights, Contact.',
        '',
        'Terms sections: Agreement, Responsible Use, Content Ownership, Privacy reference,',
        'Warranties, Liability, IP, Termination, Governing Law, Contact.',
        '',
        'Return ONLY <!DOCTYPE html> document matching the site design.',
      ].join('\n'),
      user: [
        'Business: {{business_name}}',
        'Address: {{business_address}}',
        'Email: {{business_email}}',
        'Website: {{website_url}}',
        'Page Type: {{page_type}}',
        'Brand: {{brand_json}}',
        '',
        'Generate the complete {{page_type}} page HTML.',
      ].join('\n'),
    },
    {
      id: 'score_website',
      version: 1,
      description: 'Score website quality across 8 dimensions',
      models: defaultModels,
      params: { temperature: 0.1, maxTokens: 2048 },
      inputs: { required: ['html_content', 'business_name'], optional: [] },
      outputs: { format: 'json', schema: 'ScoreWebsiteOutput' },
      notes: { threshold: 'Below 0.6 = regenerate' },
      system: [
        'Evaluate this HTML website. Score 0.0-1.0 on:',
        'visual_design, content_quality, completeness, responsiveness,',
        'accessibility, seo, performance, brand_consistency.',
        'Return JSON: { scores{...}, overall, issues[], suggestions[], missing_sections[] }',
      ].join('\n'),
      user: 'Business: {{business_name}}\n\nHTML:\n{{html_content}}\n\nScore this website.',
    },
  ]);
}
