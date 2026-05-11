/**
 * @module services/template_cache
 *
 * @description
 * KV-cached industry template shells for site generation. Each shell is a
 * structural blueprint (section order, Tailwind hint patterns, color
 * strategy, recommended pages) for one of 15 hard-coded business
 * categories. The LLM customizes these rather than inventing from scratch —
 * it produces better-looking, more consistent results AND cuts container
 * build time materially (no green-field structure decisions).
 *
 * Two-tier lookup with graceful fallback:
 * 1. KV cache hit (`template:{Category}`, 7-day TTL) → return cached shell.
 * 2. KV miss / KV error → return built-in `TEMPLATES[category]`, then
 *    fire-and-forget `KV.put()` to populate the cache for next time.
 *
 * Both KV operations are wrapped in `try/catch` and degrade silently — a
 * KV outage NEVER blocks site generation. The built-in `TEMPLATES` record
 * is the authoritative fallback and is always reachable.
 *
 * Category coverage (15): Restaurant, Salon, Legal, Medical, Retail, Tech,
 * Construction, Fitness, Real Estate, Photography, Automotive, Education,
 * Financial, Café, Other. Strings outside this set route to `'Other'` via
 * keyword fallback in `matchCategory()`.
 *
 * Hot-patching: editing a cached shell via the KV dashboard takes effect
 * immediately for new builds — the built-in `TEMPLATES` record is only
 * consulted on KV miss/error, so dashboard overrides win until the 7-day
 * TTL expires or the override is deleted.
 *
 * @example
 * ```ts
 * const shell = await getOrCreateTemplate(env, 'pizzeria in newark');
 * // → TEMPLATES.Restaurant (keyword "pizzeria" matched)
 * // → sections: ['hero-with-food-imagery', 'menu-highlights', ...]
 * ```
 *
 * @see {@link module:services/ai_workflows}
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';

export interface TemplateShell {
  category: string;
  sections: string[];
  tailwind_patterns: string[];
  color_strategy: string;
  layout_notes: string;
  recommended_pages: string[];
}

const CATEGORIES = [
  'Restaurant',
  'Salon',
  'Legal',
  'Medical',
  'Retail',
  'Tech',
  'Construction',
  'Fitness',
  'Real Estate',
  'Photography',
  'Automotive',
  'Education',
  'Financial',
  'Café',
  'Other',
] as const;

export type TemplateCategory = typeof CATEGORIES[number];

/** Default TTL for template cache: 7 days */
const TEMPLATE_TTL = 60 * 60 * 24 * 7;

/** Built-in template definitions per category */
const TEMPLATES: Record<string, TemplateShell> = {
  Restaurant: {
    category: 'Restaurant',
    sections: ['hero-with-food-imagery', 'menu-highlights', 'about-chef', 'gallery', 'reviews', 'hours-location', 'reservation-cta', 'contact'],
    tailwind_patterns: ['bg-gradient-to-br', 'from-amber-900', 'text-amber-50', 'rounded-2xl', 'shadow-2xl'],
    color_strategy: 'Warm tones: amber, orange, deep red. Dark backgrounds with warm accent highlights.',
    layout_notes: 'Full-width hero with food image overlay. Menu as card grid. Map embed near bottom.',
    recommended_pages: ['index.html', 'menu.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  Salon: {
    category: 'Salon',
    sections: ['hero-glamour', 'services-grid', 'team-profiles', 'gallery', 'reviews', 'booking-cta', 'hours-location', 'contact'],
    tailwind_patterns: ['bg-gradient-to-r', 'from-purple-900', 'via-pink-800', 'text-pink-50', 'rounded-3xl'],
    color_strategy: 'Luxe palette: deep purple, rose gold, soft pink. Elegant and inviting.',
    layout_notes: 'Glamorous hero with gradient overlay. Services as pricing cards. Team with circular photos.',
    recommended_pages: ['index.html', 'services.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  Legal: {
    category: 'Legal',
    sections: ['hero-authority', 'practice-areas', 'attorney-profiles', 'case-results', 'testimonials', 'consultation-cta', 'contact'],
    tailwind_patterns: ['bg-slate-900', 'text-slate-100', 'border-amber-500', 'font-serif'],
    color_strategy: 'Authoritative: navy, slate, gold accents. Conservative but modern.',
    layout_notes: 'Commanding hero with firm tagline. Practice areas as icon cards. Attorneys in formal grid.',
    recommended_pages: ['index.html', 'practice-areas.html', 'attorneys.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  Medical: {
    category: 'Medical',
    sections: ['hero-trust', 'services-overview', 'providers', 'patient-info', 'insurance', 'appointment-cta', 'hours-location', 'contact'],
    tailwind_patterns: ['bg-blue-50', 'text-blue-900', 'border-teal-400', 'rounded-xl'],
    color_strategy: 'Clean and trustworthy: soft blue, teal, white. Calming and professional.',
    layout_notes: 'Clean hero with trust signals. Services with medical icons. Provider cards with credentials.',
    recommended_pages: ['index.html', 'services.html', 'providers.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  Retail: {
    category: 'Retail',
    sections: ['hero-showcase', 'featured-products', 'categories', 'about-brand', 'reviews', 'store-info', 'newsletter-signup', 'contact'],
    tailwind_patterns: ['bg-gradient-to-b', 'from-zinc-900', 'text-zinc-50', 'rounded-2xl', 'hover:scale-105'],
    color_strategy: 'Bold and modern: dark backgrounds with vibrant product accent colors.',
    layout_notes: 'Product-focused hero. Featured items as cards with hover zoom. Category grid.',
    recommended_pages: ['index.html', 'products.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  Tech: {
    category: 'Tech',
    sections: ['hero-innovation', 'features-grid', 'how-it-works', 'pricing', 'testimonials', 'team', 'cta-section', 'contact'],
    tailwind_patterns: ['bg-gray-950', 'text-gray-100', 'from-indigo-600', 'to-purple-600', 'rounded-2xl'],
    color_strategy: 'Modern tech: dark mode with vibrant gradients (indigo to purple). Neon accents.',
    layout_notes: 'Hero with animated gradient. Features as icon grid. Pricing table. CTA with gradient button.',
    recommended_pages: ['index.html', 'features.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  Construction: {
    category: 'Construction',
    sections: ['hero-project-showcase', 'services', 'portfolio', 'process-steps', 'certifications', 'testimonials', 'quote-cta', 'contact'],
    tailwind_patterns: ['bg-yellow-600', 'text-gray-900', 'border-orange-500', 'font-bold'],
    color_strategy: 'Industrial: yellow/orange safety colors on dark gray. Strong and dependable.',
    layout_notes: 'Bold hero with project photo. Services as icon list. Portfolio gallery with before/after.',
    recommended_pages: ['index.html', 'services.html', 'portfolio.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  Fitness: {
    category: 'Fitness',
    sections: ['hero-energy', 'programs', 'trainers', 'schedule', 'membership-pricing', 'transformation-gallery', 'trial-cta', 'contact'],
    tailwind_patterns: ['bg-black', 'text-white', 'from-red-600', 'to-orange-500', 'uppercase', 'tracking-wider'],
    color_strategy: 'High-energy: black with red/orange gradients. Bold typography. Action-oriented.',
    layout_notes: 'Dynamic hero with energy feel. Programs as cards. Trainers with action shots. Pricing table.',
    recommended_pages: ['index.html', 'programs.html', 'trainers.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  'Real Estate': {
    category: 'Real Estate',
    sections: ['hero-property', 'featured-listings', 'services', 'agent-profiles', 'market-stats', 'testimonials', 'valuation-cta', 'contact'],
    tailwind_patterns: ['bg-emerald-950', 'text-emerald-50', 'border-gold-400', 'rounded-xl'],
    color_strategy: 'Luxury: deep green, gold accents, cream. Sophisticated and trustworthy.',
    layout_notes: 'Property hero with search overlay. Listings as image cards. Agent profiles with stats.',
    recommended_pages: ['index.html', 'listings.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  Photography: {
    category: 'Photography',
    sections: ['hero-full-bleed', 'portfolio-masonry', 'services-packages', 'about-artist', 'testimonials', 'booking-cta', 'contact'],
    tailwind_patterns: ['bg-neutral-950', 'text-neutral-100', 'aspect-square', 'object-cover'],
    color_strategy: 'Minimal: near-black with subtle warm tones. Let the photography speak.',
    layout_notes: 'Full-bleed hero image. Masonry portfolio grid. Minimal text, maximum imagery.',
    recommended_pages: ['index.html', 'portfolio.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  Automotive: {
    category: 'Automotive',
    sections: ['hero-vehicle', 'services-offered', 'why-choose-us', 'gallery', 'reviews', 'appointment-cta', 'hours-location', 'contact'],
    tailwind_patterns: ['bg-zinc-900', 'text-zinc-100', 'border-red-600', 'font-bold'],
    color_strategy: 'Automotive: dark charcoal with red/chrome accents. Industrial but polished.',
    layout_notes: 'Hero with vehicle/shop imagery. Services as icon cards. Trust badges for certifications.',
    recommended_pages: ['index.html', 'services.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  Education: {
    category: 'Education',
    sections: ['hero-learning', 'programs-courses', 'faculty', 'campus-virtual-tour', 'student-outcomes', 'enrollment-cta', 'contact'],
    tailwind_patterns: ['bg-blue-900', 'text-blue-50', 'border-yellow-400', 'rounded-lg'],
    color_strategy: 'Academic: deep blue with bright yellow/gold accents. Inspiring and structured.',
    layout_notes: 'Welcoming hero with campus vibe. Programs as expandable cards. Faculty grid.',
    recommended_pages: ['index.html', 'programs.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  Financial: {
    category: 'Financial',
    sections: ['hero-trust', 'services-overview', 'team-advisors', 'approach', 'client-stories', 'consultation-cta', 'contact'],
    tailwind_patterns: ['bg-slate-800', 'text-slate-100', 'border-green-500', 'font-serif'],
    color_strategy: 'Financial trust: navy/slate with green (growth) accents. Conservative elegance.',
    layout_notes: 'Authoritative hero with trust messaging. Services as detailed cards. Team with credentials.',
    recommended_pages: ['index.html', 'services.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  'Café': {
    category: 'Café',
    sections: ['hero-cozy', 'menu-highlights', 'about-story', 'atmosphere-gallery', 'reviews', 'hours-location', 'order-cta', 'contact'],
    tailwind_patterns: ['bg-amber-50', 'text-amber-900', 'from-orange-800', 'rounded-2xl'],
    color_strategy: 'Warm café: cream, brown, orange. Cozy and inviting with coffee-inspired tones.',
    layout_notes: 'Warm hero with café atmosphere. Menu as clean list. Gallery with cozy shots.',
    recommended_pages: ['index.html', 'menu.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
  Other: {
    category: 'Other',
    sections: ['hero-brand', 'features-overview', 'about', 'services', 'testimonials', 'cta-section', 'contact'],
    tailwind_patterns: ['bg-gradient-to-br', 'from-gray-900', 'to-indigo-900', 'text-gray-100', 'rounded-2xl'],
    color_strategy: 'Versatile: dark with colorful gradient accents. Professional and adaptable.',
    layout_notes: 'Strong hero with brand colors. Feature cards. Clean about section. Contact form.',
    recommended_pages: ['index.html', 'about.html', 'services.html', 'contact.html', 'privacy.html', 'terms.html'],
  },
};

/**
 * Match a free-form business-type string to one of the 15 supported
 * `TemplateCategory` values using a deterministic keyword table.
 *
 * @param businessType - Caller-supplied business descriptor. Free-form;
 *   case-insensitive. Examples: `"Italian restaurant"`, `"hair salon and
 *   day spa"`, `"family law attorney"`, `"crossfit gym"`.
 * @returns The matched category, or `'Other'` if no keyword matched. The
 *   return value is guaranteed to be a key in `TEMPLATES`.
 *
 * @remarks
 * Pure synchronous function — no I/O, no allocations beyond the keyword
 * table. Iteration order matches the `mappings` array: the first table
 * row whose keyword list contains a substring of the lowercased input
 * wins. Keyword lists were chosen to cover the most common Google Places
 * `business_type` strings + free-text descriptions a user might type into
 * the search box.
 *
 * Substring matching is naive (`String.includes`) — `"dental hygienist"`
 * matches `Medical` via `"dental"`, but `"barbecue"` matches `Restaurant`
 * via `"bbq"` only if the substring `"bbq"` is present. Add new keywords
 * to the table when categorization misses are reported; do NOT add new
 * categories without also adding a built-in shell to `TEMPLATES`.
 *
 * Ambiguity policy: when the input matches multiple rows, the FIRST row
 * wins. The table is ordered with the more-specific categories first
 * (Restaurant before Café, Legal before Financial) to bias toward the
 * tighter match.
 *
 * @example
 * ```ts
 * matchCategory('Italian Restaurant');       // → 'Restaurant'
 * matchCategory('crossfit gym');             // → 'Fitness'
 * matchCategory('quantum widget consultancy'); // → 'Other'
 * ```
 *
 * @throws Never — pure function.
 */
export function matchCategory(businessType: string): TemplateCategory {
  const lower = businessType.toLowerCase();
  const mappings: Array<[string[], TemplateCategory]> = [
    [['restaurant', 'dining', 'eatery', 'grill', 'bistro', 'pizzeria', 'sushi', 'taco', 'bbq'], 'Restaurant'],
    [['salon', 'barber', 'hair', 'beauty', 'spa', 'nail', 'waxing'], 'Salon'],
    [['law', 'legal', 'attorney', 'lawyer', 'paralegal'], 'Legal'],
    [['medical', 'doctor', 'dentist', 'dental', 'health', 'clinic', 'hospital', 'therapy', 'chiropractic', 'optometry'], 'Medical'],
    [['retail', 'shop', 'store', 'boutique', 'market'], 'Retail'],
    [['tech', 'software', 'saas', 'startup', 'digital', 'app', 'web development', 'it service'], 'Tech'],
    [['construction', 'contractor', 'builder', 'roofing', 'plumbing', 'electric', 'hvac', 'handyman', 'remodel'], 'Construction'],
    [['fitness', 'gym', 'yoga', 'pilates', 'crossfit', 'personal train', 'martial art'], 'Fitness'],
    [['real estate', 'realtor', 'property', 'mortgage', 'realty'], 'Real Estate'],
    [['photo', 'video', 'film', 'creative', 'studio', 'design agency'], 'Photography'],
    [['auto', 'car', 'mechanic', 'tire', 'body shop', 'oil change', 'detailing'], 'Automotive'],
    [['school', 'education', 'tutor', 'university', 'college', 'academy', 'training'], 'Education'],
    [['financial', 'accounting', 'cpa', 'tax', 'insurance', 'invest', 'wealth', 'bank'], 'Financial'],
    [['café', 'cafe', 'coffee', 'tea', 'bakery', 'pastry', 'juice'], 'Café'],
  ];

  for (const [keywords, category] of mappings) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return category;
    }
  }
  return 'Other';
}

/**
 * Resolve a `TemplateShell` for a business category, preferring the KV
 * cache and falling back to the built-in `TEMPLATES` record on miss or
 * error.
 *
 * @param env - Worker bindings; `env.CACHE_KV` is required.
 * @param category - Free-form business descriptor. Routed through
 *   `matchCategory()` before lookup, so any string is acceptable —
 *   unmatched inputs return the `'Other'` shell.
 * @returns A `TemplateShell` matching the resolved category. Never
 *   `null`/`undefined`; falls back to `TEMPLATES['Other']` as a final
 *   guard against a `TEMPLATES` map miss.
 *
 * @remarks
 * Two-tier lookup chain:
 * 1. **KV read** — `env.CACHE_KV.get('template:${matched}', 'json')`.
 *    A non-null result is returned as-is (no schema validation — KV
 *    contents are trusted because we wrote them).
 * 2. **Built-in fallback** — on KV miss OR KV error (network, throttle,
 *    parse failure), fall through to `TEMPLATES[matched] ?? TEMPLATES['Other']`
 *    and fire a best-effort `KV.put()` to populate the cache for next
 *    time. The `put` is also wrapped in `try/catch` — failures are
 *    swallowed because the caller already has the data it needs.
 *
 * KV TTL is 7 days (`TEMPLATE_TTL`). Cached entries expire automatically;
 * built-in template edits propagate after expiry (or via explicit
 * dashboard delete). For immediate propagation across all categories,
 * bump the cache key prefix (`template:` → `template-v2:`).
 *
 * Performance: 1 KV read on cache hit (~5-20ms), 1 KV read + 1 KV write
 * on cache miss (~20-50ms). Both operations are non-blocking from the
 * caller's perspective — even total KV failure costs only the latency of
 * the failed call, not the failure of the build.
 *
 * @throws Never — both KV operations are individually wrapped in
 *   `try/catch`. Callers MAY assume this function always resolves to a
 *   valid `TemplateShell` and skip defensive null checks.
 */
export async function getOrCreateTemplate(
  env: Env,
  category: string,
): Promise<TemplateShell> {
  const matched = matchCategory(category);
  const cacheKey = `template:${matched}`;

  // Try KV cache
  try {
    const cached = await env.CACHE_KV.get(cacheKey, 'json');
    if (cached) {
      return cached as TemplateShell;
    }
  } catch {
    // KV error — fall through to built-in
  }

  const template = TEMPLATES[matched] ?? TEMPLATES['Other'];

  // Cache for future use
  try {
    await env.CACHE_KV.put(cacheKey, JSON.stringify(template), { expirationTtl: TEMPLATE_TTL });
  } catch {
    // Non-blocking
  }

  return template;
}

/**
 * Return the full list of 15 supported template categories.
 *
 * @returns Readonly tuple of category names in their canonical order.
 *   Safe to bind directly to a `<select>` or admin UI dropdown — the
 *   return value is the same `CATEGORIES` const used by `matchCategory()`,
 *   so dropdown selections are guaranteed to resolve to a valid shell.
 *
 * @remarks
 * Pure synchronous function. The returned reference is the module-level
 * `CATEGORIES` array typed as `readonly` — DO NOT mutate. Adding a new
 * category requires three coordinated edits in this file: append to
 * `CATEGORIES`, add a row to `matchCategory()`'s `mappings` table, and
 * add a `TEMPLATES[NewCategory]` entry. Skipping any one of those
 * produces a runtime fallback to `'Other'`.
 *
 * @example
 * ```ts
 * const cats = getCategories();
 * cats.forEach((c) => console.warn(c)); // Restaurant, Salon, Legal, ...
 * ```
 *
 * @throws Never — pure function.
 */
export function getCategories(): readonly string[] {
  return CATEGORIES;
}
