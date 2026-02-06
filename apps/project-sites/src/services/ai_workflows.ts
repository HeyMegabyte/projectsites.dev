/**
 * AI workflow orchestration using the prompt registry.
 *
 * All LLM calls go through the prompt infrastructure:
 *   registry.resolve() → renderer.renderPrompt() → callModel() → schemas.validateOutput()
 *
 * Every call is observed (prompt_id, version, input_hash, latency, outcome).
 */

import type { Env } from '../types/env.js';
import type { PromptSpec, LlmCallResult } from '../prompts/types.js';
import { registry } from '../prompts/index.js';
import { renderPrompt } from '../prompts/renderer.js';
import { validatePromptInput, validatePromptOutput } from '../prompts/schemas.js';
import { withObservability } from '../prompts/observability.js';

// ── Core LLM call ────────────────────────────────────────────

/**
 * Call an LLM model through the Workers AI binding.
 * Uses the prompt registry for resolution, rendering, and observability.
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

  // 3. Render the prompt templates
  const rendered = renderPrompt(spec, stringInputs, { safeDelimit: true });
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

// ── Research Business ────────────────────────────────────────

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

  const parsed = JSON.parse(result.output) as Record<string, unknown>;

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

export async function generateSiteHtml(env: Env, researchData: ResearchResult): Promise<string> {
  const result = await runPrompt(env, 'generate_site', 2, {
    research_data: JSON.stringify(researchData),
  });

  // Validate output (must contain DOCTYPE)
  validatePromptOutput('generate_site', result.output);

  return result.output;
}

// ── Score Quality ────────────────────────────────────────────

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

export async function scoreQuality(env: Env, htmlContent: string): Promise<QualityScore> {
  const result = await runPrompt(env, 'score_quality', 2, {
    html_content: htmlContent.substring(0, 4000),
  });

  const parsed = JSON.parse(result.output);

  // Validate output schema
  return validatePromptOutput('score_quality', parsed) as QualityScore;
}

// ── Site Copy (with A/B variant support) ─────────────────────

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

// ── Full Site Generation Workflow ─────────────────────────────

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

// ── Prompt Registration (called at startup) ──────────────────

/**
 * Register all prompt definitions in the registry.
 * Called once at Worker startup.
 *
 * Each prompt is defined inline here (bundled with the Worker).
 * The corresponding .prompt.md files in /prompts/ are the
 * human-readable, diffable source of truth for review.
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
}
