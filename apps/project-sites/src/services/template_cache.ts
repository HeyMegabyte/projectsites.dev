/**
 * @module services/template_cache
 * @description KV-cached industry template shells for site generation.
 *
 * Pre-generated structure templates per business category, cached in KV.
 * The LLM customizes these rather than inventing from scratch, improving
 * consistency and speed.
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
 * Match a business type string to the nearest template category.
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
 * Get or create a template shell for a business category.
 *
 * Checks KV cache first, falls back to built-in templates.
 *
 * @param env - Worker environment with CACHE_KV binding
 * @param category - Business category (matched via matchCategory)
 * @returns Template shell for the category
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
 * Get all available template categories.
 */
export function getCategories(): readonly string[] {
  return CATEGORIES;
}
