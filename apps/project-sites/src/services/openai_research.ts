/**
 * @module services/openai_research
 *
 * @description
 * OpenAI-powered business research pipeline + expert prompt synthesis. This
 * module is the "researcher of record" for every workflow run that doesn't
 * delegate to Workers AI — given a business name (plus optional Google
 * Places metadata), it produces four structured JSON bundles
 * (`profile` / `brand` / `sellingPoints` / `social`) and folds them into a
 * single self-contained build prompt that the bolt.diy code-editor (or the
 * downstream Cloudflare Container running Claude Code) consumes verbatim.
 *
 * ## Pipeline shape
 * 1. `researchProfile` (sequential, blocking) — extracts the core profile
 *    bundle. Every downstream step depends on the business_type +
 *    description it produces.
 * 2. `researchBrand`, `researchSellingPoints`, `researchSocial` (parallel
 *    via `Promise.all`) — three independent passes that read the profile
 *    and produce orthogonal JSON bundles. Failure of any one rejects the
 *    whole pipeline (no per-bundle isolation today).
 * 3. `formulateExpertPrompt` (sequential, blocking) — concatenates all
 *    four bundles into a single LLM call whose response IS the prompt
 *    handed to bolt.diy. This call prepends `buildDoctrinePrefix()` so
 *    the meta-prompt inherits the HOLIEST / HIGHEST B-ORDER mission
 *    doctrine (cinematic floor, latest-tech flex, every-free-API,
 *    flex-on-whitehouse.gov, platform-promise mandates) and re-embeds
 *    those mandates verbatim into the prompt it produces.
 *
 * ## Model selection
 * Default `o3-mini` (extended-thinking, JSON-mode friendly). Override via
 * `env.RESEARCH_MODEL` — useful for canary-testing `gpt-4o` /
 * `gpt-4-turbo` or swapping in a cheaper experimental model. The same
 * model is used for every step in the pipeline — no per-step routing.
 *
 * ## Failure model
 * - Missing `OPENAI_API_KEY` → throws `Error('OPENAI_API_KEY is not
 *   configured')` from `callOpenAI`. Caller (workflow step) MUST
 *   `try/catch` and route through `error_handler` so the site flips to
 *   `status='error'` with a clean audit-log entry.
 * - Non-2xx OpenAI response → throws `Error('OpenAI API error {status}:
 *   {body}')`. The body is included verbatim for debuggability — be
 *   careful not to log it into customer-facing surfaces.
 * - Malformed JSON in any research step → throws from `JSON.parse` deep
 *   inside `extractJson`. The error propagates with no extra context;
 *   callers should add their own breadcrumb.
 *
 * ## Cost notes
 * Each end-to-end `researchAndFormulatePrompt` invocation = 5 OpenAI
 * calls (1 profile + 3 parallel + 1 prompt synthesis). Typical token
 * spend on `o3-mini`: ~$0.08–$0.15 per site. The expert-prompt step
 * dominates because `max_completion_tokens=16000`.
 *
 * @example
 * ```ts
 * const result = await researchAndFormulatePrompt(env, {
 *   businessName: "Vito's Mens Salon",
 *   businessAddress: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
 *   businessPhone: '(973) 335-2222',
 * });
 * // result.expertPrompt is now the self-contained build prompt for bolt.diy
 * await env.SITE_WORKFLOW.create({ params: { expertPrompt: result.expertPrompt } });
 * ```
 *
 * @see {@link module:prompts/renderer} for `buildDoctrinePrefix()`
 * @see {@link module:services/ai_workflows} for the alternate Workers-AI path
 * @see {@link module:workflows/site-generation} for the consumer
 */

import type { Env } from '../types/env.js';
import { buildDoctrinePrefix } from '../prompts/renderer.js';

const DEFAULT_MODEL = 'o3-mini';

interface BusinessInfo {
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  googlePlaceId?: string;
  additionalContext?: string;
}

export interface ResearchResult {
  profile: Record<string, unknown>;
  brand: Record<string, unknown>;
  sellingPoints: Record<string, unknown>;
  social: Record<string, unknown>;
  expertPrompt: string;
}

/**
 * Single OpenAI Chat Completions request — the lowest-level primitive in
 * this module. Every other research function funnels through this.
 *
 * @param env - Worker bindings; `env.OPENAI_API_KEY` REQUIRED. Reads
 *   `env.RESEARCH_MODEL` as optional override (default `o3-mini`).
 * @param systemPrompt - Verbatim system message. Doctrine prefixes (if
 *   needed) MUST be baked in by the caller — this function does not
 *   inject anything.
 * @param userPrompt - Verbatim user message. No template substitution.
 * @param options.temperature - Sampling temperature (default `0.3` —
 *   tight enough for JSON-mode reliability, loose enough to avoid
 *   verbatim regurgitation).
 * @param options.maxTokens - `max_completion_tokens` cap (default
 *   `8192`). `formulateExpertPrompt` overrides to `16000`.
 * @param options.jsonMode - When `true`, sets
 *   `response_format={type:'json_object'}` to force JSON output. All
 *   `research*` callers set this; `formulateExpertPrompt` does not.
 * @returns The raw `choices[0].message.content` string. Empty string
 *   when OpenAI returns no choices (rare; usually a billing/quota
 *   issue).
 *
 * @throws {Error} `OPENAI_API_KEY is not configured` when the binding
 *   is unset. This is a deployment misconfig, not a transient — do
 *   not retry without surfacing.
 * @throws {Error} `OpenAI API error {status}: {body}` for any non-2xx
 *   response. The body is included verbatim for debuggability —
 *   beware of including in user-facing error envelopes.
 */
async function callOpenAI(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number; jsonMode?: boolean },
): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const model = env.RESEARCH_MODEL || DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: options?.temperature ?? 0.3,
    max_completion_tokens: options?.maxTokens ?? 8192,
  };

  if (options?.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content ?? '';
}

/**
 * Best-effort JSON extraction from LLM output, with a three-tier
 * fallback chain to handle the most common "JSON-mode forgot" failure
 * shapes.
 *
 * @param text - Raw model response. May be pure JSON, a fenced code
 *   block, or prose wrapped around a JSON object.
 * @returns Parsed value (typed as `unknown` — caller asserts shape).
 *
 * @remarks
 * Fallback chain, in order:
 * 1. ` ```json … ``` ` (or bare ` ``` ``` `) — common when the model
 *    decides to "explain" its output. The fence is stripped and the
 *    inner body is parsed.
 * 2. Curly-brace slice — finds the first `{` and the last `}` in the
 *    trimmed string and parses only that range. Handles "Sure! Here
 *    is your JSON: { … } Let me know if you need anything else."
 * 3. Raw parse — last resort; throws if the entire response isn't
 *    valid JSON.
 *
 * @throws {SyntaxError} Propagates from `JSON.parse` when every tier
 *   fails. Callers SHOULD wrap with their own breadcrumb because the
 *   stack trace points at this helper, not the originating prompt.
 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);

  if (fenced) {
    return JSON.parse(fenced[1].trim());
  }

  // Try direct parse
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  return JSON.parse(trimmed);
}

/**
 * Pipeline step 1 — deep business profile research.
 *
 * @param env - Worker bindings (OPENAI_API_KEY required).
 * @param info - Business identity. Only `businessName` is required; the
 *   remaining fields (`businessAddress`, `businessPhone`,
 *   `googlePlaceId`, `additionalContext`) are concatenated into the
 *   user prompt when present and dramatically improve research
 *   quality.
 * @returns Profile bundle (typed as `Record<string, unknown>` because
 *   schema is LLM-defined; consumers MUST validate before use). Shape
 *   produced by the system prompt: `{ business_type, description,
 *   services[], hours, phone, email, website, address, service_area,
 *   parking, accessibility, team[]?, reviews_summary?, seo, schema_org_type }`.
 *
 * @remarks
 * - Sequential blocking step — every other `research*` call reads
 *   this bundle. Run BEFORE the parallel fan-out.
 * - Temperature is `0.2` (tightest in the module) to maximize factual
 *   recall over creativity.
 * - System prompt explicitly forbids fabricating reviews/team/prices —
 *   uncertain fields come back as `null`.
 * - JSON mode is ON; `extractJson` rarely needs its fallbacks here.
 *
 * @throws {Error} Propagates from `callOpenAI` (auth/quota/network) or
 *   `extractJson` (malformed JSON).
 */
async function researchProfile(env: Env, info: BusinessInfo): Promise<Record<string, unknown>> {
  const systemPrompt = `You are an expert business researcher. Given a business name and optional details,
research and output a comprehensive JSON profile including:
- business_type, description, services (with prices if findable), hours, phone, email, website
- address, service_area, parking, accessibility
- team members (if known), reviews_summary
- seo metadata, schema_org_type

Rules:
- ONLY include data you are confident about. Mark uncertain data as null.
- DO NOT fabricate reviews, team members, or specific prices you cannot verify.
- Use Google Places data as primary truth source when available.

Output: A single JSON object.`;

  const userPrompt = `Business: ${info.businessName}
${info.businessAddress ? `Address: ${info.businessAddress}` : ''}
${info.businessPhone ? `Phone: ${info.businessPhone}` : ''}
${info.googlePlaceId ? `Google Place ID: ${info.googlePlaceId}` : ''}
${info.additionalContext ? `Additional context: ${info.additionalContext}` : ''}`;

  const result = await callOpenAI(env, systemPrompt, userPrompt, {
    temperature: 0.2,
    maxTokens: 8192,
    jsonMode: true,
  });

  return extractJson(result) as Record<string, unknown>;
}

/**
 * Pipeline step 2a — brand identity research (parallel fan-out).
 *
 * @param env - Worker bindings (OPENAI_API_KEY required).
 * @param info - Same business identity passed into `researchProfile`.
 * @param profile - Result of `researchProfile`. Embedded into the user
 *   prompt to give the brand step business context.
 * @returns Brand bundle. Shape: `{ primary_color, secondary_color,
 *   accent_color, font_heading, font_body, personality[],
 *   logo_description, design_style, color_rationale }`. Colors are
 *   hex; fonts are Google Fonts names.
 *
 * @remarks
 * - Runs IN PARALLEL with `researchSellingPoints` and `researchSocial`
 *   inside `researchAndFormulatePrompt`.
 * - Temperature `0.3` — slightly looser than profile because color +
 *   font selection benefits from variation.
 * - Output is non-authoritative — the orchestrator's brand-extraction
 *   pipeline (logo scrape + GPT-4o vision) takes precedence when a
 *   real source site exists. This step is the cold-start fallback.
 *
 * @throws {Error} Propagates from `callOpenAI` / `extractJson`. A
 *   failure here rejects the entire `Promise.all` and aborts the
 *   pipeline.
 */
async function researchBrand(
  env: Env,
  info: BusinessInfo,
  profile: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const systemPrompt = `You are an expert brand designer. Given a business profile, determine the ideal brand identity.

Output JSON with:
- primary_color, secondary_color, accent_color (hex codes)
- font_heading, font_body (Google Fonts names)
- personality (3-5 adjective words)
- logo_description (what a logo should look like)
- design_style (e.g., "modern minimalist", "warm rustic", "bold corporate")
- color_rationale (why these colors work for this business)`;

  const userPrompt = `Business: ${info.businessName}
Profile: ${JSON.stringify(profile, null, 2)}`;

  const result = await callOpenAI(env, systemPrompt, userPrompt, {
    temperature: 0.3,
    maxTokens: 2048,
    jsonMode: true,
  });

  return extractJson(result) as Record<string, unknown>;
}

/**
 * Pipeline step 2b — selling-points + hero copy research (parallel
 * fan-out).
 *
 * @param env - Worker bindings (OPENAI_API_KEY required).
 * @param info - Business identity.
 * @param profile - Profile bundle from `researchProfile`.
 * @returns Selling-points bundle. Shape: `{ hero_headline (≤8 words),
 *   hero_subheadline (one sentence), cta_primary, cta_secondary,
 *   selling_points: [{title, description, icon_suggestion}] × 3,
 *   testimonial_style, unique_value_proposition }`.
 *
 * @remarks
 * - Runs IN PARALLEL with `researchBrand` and `researchSocial`.
 * - Temperature `0.4` — loosest in the module; copy benefits from
 *   creative variation, and the copy-rules audit step downstream
 *   tightens it.
 * - Output is rough-draft only — `content-writer` subagent in the
 *   container build rewrites this once it has the final structure
 *   plan.
 *
 * @throws {Error} Propagates from `callOpenAI` / `extractJson`.
 */
async function researchSellingPoints(
  env: Env,
  info: BusinessInfo,
  profile: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const systemPrompt = `You are an expert copywriter. Given a business profile, identify the top selling points.

Output JSON with:
- hero_headline (short, powerful, max 8 words)
- hero_subheadline (one compelling sentence)
- cta_primary (button text, e.g., "Book Now", "Get Started")
- cta_secondary (button text, e.g., "Learn More", "View Portfolio")
- selling_points: array of 3 objects, each with { title, description, icon_suggestion }
- testimonial_style (what kind of social proof would work best)
- unique_value_proposition (one sentence)`;

  const userPrompt = `Business: ${info.businessName}
Profile: ${JSON.stringify(profile, null, 2)}`;

  const result = await callOpenAI(env, systemPrompt, userPrompt, {
    temperature: 0.4,
    maxTokens: 2048,
    jsonMode: true,
  });

  return extractJson(result) as Record<string, unknown>;
}

/**
 * Pipeline step 2c — social media + online presence inference (parallel
 * fan-out).
 *
 * @param env - Worker bindings (OPENAI_API_KEY required).
 * @param info - Business identity. Address embedded into user prompt
 *   when present for geographic disambiguation.
 * @param profile - Profile bundle from `researchProfile`.
 * @returns Social bundle. Shape: `{ website_url, social_links: {
 *   facebook?, instagram?, twitter?, linkedin?, youtube?, tiktok?,
 *   yelp? }, review_platforms[], online_presence_score (1-10) }`.
 *
 * @remarks
 * - Runs IN PARALLEL with `researchBrand` and `researchSellingPoints`.
 * - Temperature `0.2` — tight to discourage URL fabrication. The
 *   model SHOULD return `null` for unknown handles rather than
 *   guessing; downstream HEAD-200 validation catches anything that
 *   slips through.
 * - **Twitter** key remains `twitter` in the output schema even though
 *   the platform rebranded to X — preserved for consumer backwards
 *   compatibility.
 *
 * @throws {Error} Propagates from `callOpenAI` / `extractJson`.
 */
async function researchSocial(
  env: Env,
  info: BusinessInfo,
  profile: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const systemPrompt = `You are a social media researcher. Given a business, identify likely social media profiles.

Output JSON with:
- website_url (if known)
- social_links: object with keys like facebook, instagram, twitter, linkedin, youtube, tiktok, yelp
  (values are URLs or null if unknown)
- review_platforms: array of platforms where the business likely has reviews
- online_presence_score: 1-10 estimate of how active they are online`;

  const userPrompt = `Business: ${info.businessName}
${info.businessAddress ? `Address: ${info.businessAddress}` : ''}
Profile: ${JSON.stringify(profile, null, 2)}`;

  const result = await callOpenAI(env, systemPrompt, userPrompt, {
    temperature: 0.2,
    maxTokens: 2048,
    jsonMode: true,
  });

  return extractJson(result) as Record<string, unknown>;
}

/**
 * The single public entry point of this module — orchestrates the entire
 * 5-call research pipeline and returns the synthesized build prompt.
 *
 * @param env - Worker bindings (OPENAI_API_KEY required).
 * @param info - Business identity. `businessName` is the only required
 *   field; everything else improves quality but is optional.
 * @returns `ResearchResult` containing all four research bundles plus
 *   `expertPrompt` — the self-contained, doctrine-embedded string
 *   ready to hand to bolt.diy / Claude Code container.
 *
 * @remarks
 * Pipeline shape (5 OpenAI calls total):
 * 1. `researchProfile` (sequential, blocks the rest).
 * 2. `researchBrand` + `researchSellingPoints` + `researchSocial` via
 *    `Promise.all` (3 calls in flight at once).
 * 3. `formulateExpertPrompt` (sequential, blocks completion).
 *
 * Total latency typically 30–90s depending on model + token sizes.
 * Cost: ~$0.08–$0.15 on `o3-mini`, dominated by step 3.
 *
 * **Failure semantics:** any sub-call rejection rejects the whole
 * pipeline. There is no per-bundle retry or graceful degradation —
 * the workflow step that invokes this MUST `try/catch` and route the
 * failure through `notifyBuildFailed()` so the site flips to
 * `status='error'` cleanly.
 *
 * @throws {Error} Propagates the first sub-call rejection (auth /
 *   quota / parse error / network).
 *
 * @example
 * ```ts
 * const result = await researchAndFormulatePrompt(env, {
 *   businessName: 'New Jersey Soup Kitchen',
 *   businessAddress: '1 Broadway, Newark, NJ',
 *   additionalContext: 'non-profit, serves 500 meals/day',
 * });
 * console.log(result.expertPrompt.slice(0, 200));
 * ```
 */
export async function researchAndFormulatePrompt(
  env: Env,
  info: BusinessInfo,
): Promise<ResearchResult> {
  // Step 1: Profile research (sequential — others depend on it)
  const profile = await researchProfile(env, info);

  // Step 2: Parallel research
  const [brand, sellingPoints, social] = await Promise.all([
    researchBrand(env, info, profile),
    researchSellingPoints(env, info, profile),
    researchSocial(env, info, profile),
  ]);

  // Step 3: Formulate the expert prompt
  const expertPrompt = await formulateExpertPrompt(env, {
    businessName: info.businessName,
    profile,
    brand,
    sellingPoints,
    social,
    additionalContext: info.additionalContext,
  });

  return { profile, brand, sellingPoints, social, expertPrompt };
}

/**
 * Pipeline step 3 — fold all four research bundles into a single,
 * self-contained build prompt for bolt.diy / Claude Code container.
 *
 * @param env - Worker bindings (OPENAI_API_KEY required).
 * @param data - All upstream research bundles plus business identity.
 *   `additionalContext` is optional but bubbles up into the final
 *   prompt verbatim.
 * @returns The expert prompt string. **No JSON parsing** — this is
 *   raw natural-language instructions the downstream AI will
 *   consume directly. Typical length 4K–12K tokens.
 *
 * @remarks
 * **Doctrine inheritance (CRITICAL):** This is the only function in
 * the module that prepends `buildDoctrinePrefix()` to its system
 * prompt. The doctrine includes the HOLIEST / HIGHEST B-ORDER
 * mandates (cinematic floor, latest-tech flex, every-free-API,
 * flex-on-whitehouse.gov, platform-promise) plus the Creativity +
 * Love + Stars preamble. The system prompt explicitly instructs the
 * LLM to **re-embed those mandates verbatim** into the build prompt
 * it produces, so the downstream AI code editor inherits them with
 * no additional plumbing.
 *
 * @remarks
 * - JSON mode is OFF — output is free-form text.
 * - `max_completion_tokens=16000` — the largest budget in the module
 *   because the build prompt must enumerate sections, technical
 *   constraints, schema requirements, and re-state the doctrine.
 * - Temperature `0.4` — loose enough to vary section ordering and
 *   stylistic emphasis, tight enough to keep technical requirements
 *   verbatim.
 *
 * @throws {Error} Propagates from `callOpenAI` (auth / quota /
 *   network). No parse step here, so `extractJson` errors are
 *   impossible.
 *
 * @see {@link module:prompts/renderer} for `buildDoctrinePrefix()`
 */
async function formulateExpertPrompt(
  env: Env,
  data: {
    businessName: string;
    profile: Record<string, unknown>;
    brand: Record<string, unknown>;
    sellingPoints: Record<string, unknown>;
    social: Record<string, unknown>;
    additionalContext?: string;
  },
): Promise<string> {
  const systemPrompt = `${buildDoctrinePrefix()}You are an expert web developer and designer. Your job is to write a SINGLE, comprehensive prompt
that will be given to an AI code editor (bolt.diy) to generate a complete, stunning, production-ready website. The build prompt you produce MUST itself embed and propagate the HOLIEST / HIGHEST B-ORDER mission doctrine above so the downstream AI code editor inherits the cinematic-floor + latest-tech-flex + every-free-API + flex-on-whitehouse.gov + platform-promise mandates verbatim.

The prompt you write must be completely self-contained — the AI code editor has NO other context.

The generated website must be:
- GORGEOUS: Modern design with CSS animations, smooth transitions, glassmorphism effects, gradient overlays
- ANIMATED: Scroll-triggered animations, hover microinteractions, parallax effects, animated counters
- RESPONSIVE: Mobile-first, fluid typography, works perfectly on all screen sizes
- COMPLETE: All sections a professional portfolio/business site needs
- FAST: Vanilla HTML/CSS/JS only, no frameworks, optimized for performance
- ACCESSIBLE: WCAG 2.1 AA compliant, semantic HTML5, proper contrast ratios

Required sections in the website:
1. Hero with animated background (CSS gradients/particles), headline, subheadline, 2 CTA buttons
2. About section with company story, mission statement
3. Services/offerings grid with icons, descriptions, pricing hints
4. Portfolio/gallery section (if applicable to the business)
5. Testimonials/social proof section
6. Team section (if applicable)
7. FAQ accordion section
8. Contact section with form (name, email, phone, message) and Google Maps embed
9. Footer with social links, business info, legal links

Technical requirements:
- Single HTML file with embedded CSS and minimal JS
- Google Fonts for typography
- CSS custom properties for the color scheme
- CSS animations: @keyframes for hero, scroll-reveal for sections, hover effects for cards
- Intersection Observer for scroll-triggered animations
- Form with client-side validation and success state
- Smooth scroll navigation
- Back-to-top button
- Open Graph meta tags for social sharing
- Schema.org structured data (JSON-LD)

Your output must be ONLY the prompt text — no explanations, no markdown, no wrapping.
The prompt should start directly with instructions for what to build.`;

  const userPrompt = `Create an expert prompt for this business:

Business: ${data.businessName}
${data.additionalContext ? `Context: ${data.additionalContext}` : ''}

Research Data:
Profile: ${JSON.stringify(data.profile, null, 2)}
Brand: ${JSON.stringify(data.brand, null, 2)}
Selling Points: ${JSON.stringify(data.sellingPoints, null, 2)}
Social: ${JSON.stringify(data.social, null, 2)}`;

  return callOpenAI(env, systemPrompt, userPrompt, {
    temperature: 0.4,
    maxTokens: 16000,
  });
}
