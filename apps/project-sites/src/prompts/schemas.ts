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

// ── Research Profile (v2 workflow) ────────────────────────────

export const ResearchProfileInput = z.object({
  business_name: z.string().min(1),
  business_address: z.string().optional().default(''),
  business_phone: z.string().optional().default(''),
  google_place_id: z.string().optional().default(''),
  additional_context: z.string().optional().default(''),
});
export type ResearchProfileInput = z.infer<typeof ResearchProfileInput>;

export const ResearchProfileOutput = z.object({
  business_name: z.string(),
  tagline: z.string().nullable().optional().default(''),
  description: z.string().nullable().optional().default(''),
  mission_statement: z.string().nullable().optional().default(''),
  business_type: z.string().nullable().optional().default('general'),
  services: z.array(z.object({
    name: z.string(),
    description: z.string().nullable().optional().default(''),
    price_hint: z.string().nullable().optional().default(null),
  })).optional().default([]),
  hours: z.array(z.object({
    day: z.string(),
    open: z.string().nullable().optional().default(null),
    close: z.string().nullable().optional().default(null),
    closed: z.boolean().nullable().optional().default(false),
  })).optional().default([]),
  phone: z.string().nullable().optional().default(null),
  email: z.string().nullable().optional().default(null),
  address: z.object({
    street: z.string().nullable().optional().default(null),
    city: z.string().nullable().optional().default(null),
    state: z.string().nullable().optional().default(null),
    zip: z.string().nullable().optional().default(null),
    country: z.string().nullable().optional().default('US'),
  }).optional().default({}),
  faq: z.array(z.object({ question: z.string(), answer: z.string().nullable().optional().default('') })).optional().default([]),
  seo_title: z.string().nullable().optional().default(''),
  seo_description: z.string().nullable().optional().default(''),
});
export type ResearchProfileOutput = z.infer<typeof ResearchProfileOutput>;

// ── Research Social ──────────────────────────────────────────

export const ResearchSocialInput = z.object({
  business_name: z.string().min(1),
  business_address: z.string().optional().default(''),
  business_type: z.string().optional().default(''),
});
export type ResearchSocialInput = z.infer<typeof ResearchSocialInput>;

export const ResearchSocialOutput = z.object({
  social_links: z.array(z.object({
    platform: z.string(),
    url: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable().optional().default(0.5),
  })).optional().default([]),
  website_url: z.string().nullable().optional().default(null),
  review_platforms: z.array(z.object({
    platform: z.string(),
    url: z.string().nullable(),
    rating: z.string().nullable(),
  })).optional().default([]),
});
export type ResearchSocialOutput = z.infer<typeof ResearchSocialOutput>;

// ── Research Brand ───────────────────────────────────────────

export const ResearchBrandInput = z.object({
  business_name: z.string().min(1),
  business_type: z.string().min(1),
  business_address: z.string().optional().default(''),
  website_url: z.string().optional().default(''),
  additional_context: z.string().optional().default(''),
});
export type ResearchBrandInput = z.infer<typeof ResearchBrandInput>;

export const ResearchBrandOutput = z.object({
  logo: z.object({
    found_online: z.boolean().optional().default(false),
    search_query: z.string().optional().default(''),
    fallback_design: z.object({
      text: z.string().optional().default(''),
      font: z.string().optional().default('Inter'),
      accent_shape: z.string().optional().default('circle'),
      accent_color: z.string().optional().default('#64ffda'),
    }).optional().default({}),
  }).optional().default({}),
  colors: z.object({
    primary: z.string().optional().default('#2563eb'),
    secondary: z.string().optional().default('#7c3aed'),
    accent: z.string().optional().default('#64ffda'),
    background: z.string().optional().default('#ffffff'),
    surface: z.string().optional().default('#f8fafc'),
    text_primary: z.string().optional().default('#1e293b'),
    text_secondary: z.string().optional().default('#64748b'),
  }).optional().default({}),
  fonts: z.object({
    heading: z.string().optional().default('Inter'),
    body: z.string().optional().default('Inter'),
  }).optional().default({}),
  brand_personality: z.string().optional().default(''),
  style_notes: z.string().optional().default(''),
});
export type ResearchBrandOutput = z.infer<typeof ResearchBrandOutput>;

// ── Research Selling Points ──────────────────────────────────

export const ResearchSellingPointsInput = z.object({
  business_name: z.string().min(1),
  business_type: z.string().min(1),
  services_json: z.string().optional().default(''),
  description: z.string().optional().default(''),
  additional_context: z.string().optional().default(''),
});
export type ResearchSellingPointsInput = z.infer<typeof ResearchSellingPointsInput>;

export const ResearchSellingPointsOutput = z.object({
  selling_points: z.array(z.object({
    headline: z.string(),
    description: z.string(),
    icon: z.string().optional().default('star'),
  })).min(1).max(6),
  hero_slogans: z.array(z.object({
    headline: z.string(),
    subheadline: z.string().optional().default(''),
    cta_primary: z.object({ text: z.string(), action: z.string() }).optional().default({ text: 'Get Started', action: '#contact' }),
    cta_secondary: z.object({ text: z.string(), action: z.string() }).optional().default({ text: 'Learn More', action: '#services' }),
  })).optional().default([]),
  benefit_bullets: z.array(z.string()).optional().default([]),
});
export type ResearchSellingPointsOutput = z.infer<typeof ResearchSellingPointsOutput>;

// ── Research Images ──────────────────────────────────────────

export const ResearchImagesInput = z.object({
  business_name: z.string().min(1),
  business_type: z.string().min(1),
  business_address: z.string().optional().default(''),
  services_json: z.string().optional().default(''),
  additional_context: z.string().optional().default(''),
});
export type ResearchImagesInput = z.infer<typeof ResearchImagesInput>;

export const ResearchImagesOutput = z.object({
  hero_images: z.array(z.object({
    concept: z.string(),
    search_query_specific: z.string(),
    search_query_stock: z.string(),
    aspect_ratio: z.string().optional().default('16:9'),
    confidence_specific: z.number().optional().default(0.5),
  })).optional().default([]),
  storefront_image: z.object({
    search_query: z.string(),
    confidence: z.number().optional().default(0.5),
    fallback_description: z.string().optional().default(''),
  }).optional().default({ search_query: '', confidence: 0, fallback_description: '' }),
  team_image: z.object({
    search_query: z.string(),
    confidence: z.number().optional().default(0.5),
    fallback_description: z.string().optional().default(''),
  }).optional().default({ search_query: '', confidence: 0, fallback_description: '' }),
  service_images: z.array(z.object({
    service_name: z.string(),
    search_query_stock: z.string(),
    alt_text: z.string().optional().default(''),
  })).optional().default([]),
  placeholder_strategy: z.string().optional().default('stock'),
});
export type ResearchImagesOutput = z.infer<typeof ResearchImagesOutput>;

// ── Generate Website (v2 workflow) ───────────────────────────

export const GenerateWebsiteInput = z.object({
  profile_json: z.string().min(1),
  brand_json: z.string().min(1),
  selling_points_json: z.string().min(1),
  social_json: z.string().min(1),
  images_json: z.string().optional().default(''),
  uploads_json: z.string().optional().default(''),
  privacy_template: z.string().optional().default(''),
  terms_template: z.string().optional().default(''),
});
export type GenerateWebsiteInput = z.infer<typeof GenerateWebsiteInput>;

export const GenerateWebsiteOutput = z
  .string()
  .refine((s) => s.includes('<!DOCTYPE html>') || s.includes('<!doctype html>'), {
    message: 'Output must be a valid HTML document',
  });
export type GenerateWebsiteOutput = z.infer<typeof GenerateWebsiteOutput>;

// ── Generate Legal Pages ─────────────────────────────────────

export const GenerateLegalPageInput = z.object({
  business_name: z.string().min(1),
  brand_json: z.string().min(1),
  page_type: z.enum(['privacy', 'terms']),
  business_address: z.string().optional().default(''),
  business_email: z.string().optional().default(''),
  website_url: z.string().optional().default(''),
});
export type GenerateLegalPageInput = z.infer<typeof GenerateLegalPageInput>;

export const GenerateLegalPageOutput = z
  .string()
  .refine((s) => s.includes('<!DOCTYPE html>') || s.includes('<!doctype html>'), {
    message: 'Output must be a valid HTML document',
  });
export type GenerateLegalPageOutput = z.infer<typeof GenerateLegalPageOutput>;

// ── Score Website (v2 workflow) ──────────────────────────────

export const ScoreWebsiteInput = z.object({
  html_content: z.string().min(1),
  business_name: z.string().min(1),
});
export type ScoreWebsiteInput = z.infer<typeof ScoreWebsiteInput>;

export const ScoreWebsiteOutput = z.object({
  scores: z.object({
    visual_design: z.number().min(0).max(1).optional().default(0.5),
    content_quality: z.number().min(0).max(1).optional().default(0.5),
    completeness: z.number().min(0).max(1).optional().default(0.5),
    responsiveness: z.number().min(0).max(1).optional().default(0.5),
    accessibility: z.number().min(0).max(1).optional().default(0.5),
    seo: z.number().min(0).max(1).optional().default(0.5),
    performance: z.number().min(0).max(1).optional().default(0.5),
    brand_consistency: z.number().min(0).max(1).optional().default(0.5),
  }).optional().default({}),
  overall: z.number().min(0).max(1).optional().default(0.5),
  issues: z.array(z.string()).optional().default([]),
  suggestions: z.array(z.string()).optional().default([]),
  missing_sections: z.array(z.string()).optional().default([]),
});
export type ScoreWebsiteOutput = z.infer<typeof ScoreWebsiteOutput>;

// ── Schema Registry ───────────────────────────────────────────

/** Map of schema name → { input, output } Zod schemas */
export const PROMPT_SCHEMAS: Record<string, { input: z.ZodType; output?: z.ZodType }> = {
  // Legacy v1 prompts
  research_business: { input: ResearchBusinessInput, output: ResearchBusinessOutput },
  generate_site: { input: GenerateSiteInput, output: GenerateSiteOutput },
  score_quality: { input: ScoreQualityInput, output: ScoreQualityOutput },
  site_copy: { input: SiteCopyInput, output: SiteCopyOutput },
  // V2 workflow prompts
  research_profile: { input: ResearchProfileInput, output: ResearchProfileOutput },
  research_social: { input: ResearchSocialInput, output: ResearchSocialOutput },
  research_brand: { input: ResearchBrandInput, output: ResearchBrandOutput },
  research_selling_points: { input: ResearchSellingPointsInput, output: ResearchSellingPointsOutput },
  research_images: { input: ResearchImagesInput, output: ResearchImagesOutput },
  generate_website: { input: GenerateWebsiteInput, output: GenerateWebsiteOutput },
  generate_legal_pages: { input: GenerateLegalPageInput, output: GenerateLegalPageOutput },
  score_website: { input: ScoreWebsiteInput, output: ScoreWebsiteOutput },
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
