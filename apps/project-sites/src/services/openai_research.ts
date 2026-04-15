/**
 * @module services/openai_research
 * @description OpenAI-powered business research and expert prompt formulation.
 *
 * Uses the OpenAI Chat Completions API (with configurable model) to:
 * 1. Research a business deeply (profile, brand, services, selling points)
 * 2. Formulate a single expert prompt for bolt.diy to generate a website
 *
 * The default model is `o3-mini` (extended thinking), configurable via
 * the `RESEARCH_MODEL` environment variable.
 */

import type { Env } from '../types/env.js';

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
 * Call OpenAI Chat Completions API.
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
 * Extract JSON from a text response (handles markdown code fences).
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
 * Research a business comprehensively using OpenAI.
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
 * Research brand identity (colors, fonts, personality).
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
 * Research selling points and hero content.
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
 * Research social media and online presence.
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
 * Run the full research pipeline and formulate an expert prompt for bolt.diy.
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
 * Combine all research into a single expert prompt for bolt.diy.
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
  const systemPrompt = `You are an expert web developer and designer. Your job is to write a SINGLE, comprehensive prompt
that will be given to an AI code editor (bolt.diy) to generate a complete, stunning, production-ready website.

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
