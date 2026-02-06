/**
 * Zod schemas for prompt inputs and outputs.
 *
 * Each prompt has a typed input schema (validated before rendering)
 * and an optional output schema (validated after LLM response).
 */

import { z } from 'zod';

// ── Research Business ─────────────────────────────────────────

export const ResearchBusinessInput = z.object({
  business_name: z.string().min(1, 'business_name is required'),
  business_phone: z.string().optional().default(''),
  business_address: z.string().optional().default(''),
  google_place_id: z.string().optional().default(''),
  additional_context: z.string().optional().default(''),
});
export type ResearchBusinessInput = z.infer<typeof ResearchBusinessInput>;

export const ResearchBusinessOutput = z.object({
  business_name: z.string(),
  tagline: z.string().max(60),
  description: z.string(),
  services: z.array(z.string()).min(3).max(8),
  hours: z.array(z.object({ day: z.string(), hours: z.string() })),
  faq: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .min(3)
    .max(5),
  seo_title: z.string().max(60),
  seo_description: z.string().max(160),
});
export type ResearchBusinessOutput = z.infer<typeof ResearchBusinessOutput>;

// ── Generate Site ─────────────────────────────────────────────

export const GenerateSiteInput = z.object({
  research_data: z.string().min(1, 'research_data is required'),
});
export type GenerateSiteInput = z.infer<typeof GenerateSiteInput>;

export const GenerateSiteOutput = z
  .string()
  .refine((s) => s.includes('<!DOCTYPE html>') || s.includes('<!doctype html>'), {
    message: 'Output must be a valid HTML document',
  });
export type GenerateSiteOutput = z.infer<typeof GenerateSiteOutput>;

// ── Score Quality ─────────────────────────────────────────────

export const ScoreQualityInput = z.object({
  html_content: z.string().min(1, 'html_content is required'),
});
export type ScoreQualityInput = z.infer<typeof ScoreQualityInput>;

export const ScoreQualityOutput = z.object({
  scores: z.object({
    accuracy: z.number().min(0).max(1),
    completeness: z.number().min(0).max(1),
    professionalism: z.number().min(0).max(1),
    seo: z.number().min(0).max(1),
    accessibility: z.number().min(0).max(1),
  }),
  overall: z.number().min(0).max(1),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
});
export type ScoreQualityOutput = z.infer<typeof ScoreQualityOutput>;

// ── Site Copy ─────────────────────────────────────────────────

export const SiteCopyInput = z.object({
  businessName: z.string().min(1, 'businessName is required'),
  city: z.string().min(1, 'city is required'),
  services: z.array(z.string()).default([]),
  tone: z.enum(['friendly', 'premium', 'no-nonsense']).default('friendly'),
});
export type SiteCopyInput = z.infer<typeof SiteCopyInput>;

export const SiteCopyOutput = z.string().refine((s) => s.includes('#'), {
  message: 'Output must contain Markdown headings',
});
export type SiteCopyOutput = z.infer<typeof SiteCopyOutput>;

// ── Schema Registry ───────────────────────────────────────────

/** Map of schema name → { input, output } Zod schemas */
export const PROMPT_SCHEMAS: Record<string, { input: z.ZodType; output?: z.ZodType }> = {
  research_business: { input: ResearchBusinessInput, output: ResearchBusinessOutput },
  generate_site: { input: GenerateSiteInput, output: GenerateSiteOutput },
  score_quality: { input: ScoreQualityInput, output: ScoreQualityOutput },
  site_copy: { input: SiteCopyInput, output: SiteCopyOutput },
};

/**
 * Validate inputs against a prompt's registered Zod schema.
 * Returns the parsed (and defaulted) input object or throws ZodError.
 */
export function validatePromptInput(
  promptId: string,
  rawInputs: Record<string, unknown>,
): Record<string, unknown> {
  const schemas = PROMPT_SCHEMAS[promptId];
  if (!schemas) {
    throw new Error(`No schema registered for prompt: ${promptId}`);
  }
  return schemas.input.parse(rawInputs) as Record<string, unknown>;
}

/**
 * Validate LLM output against a prompt's registered output schema.
 * Returns the parsed output or throws ZodError.
 */
export function validatePromptOutput(promptId: string, rawOutput: unknown): unknown {
  const schemas = PROMPT_SCHEMAS[promptId];
  if (!schemas?.output) {
    return rawOutput; // no output schema, pass through
  }
  return schemas.output.parse(rawOutput);
}
