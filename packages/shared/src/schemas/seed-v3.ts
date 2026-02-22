/**
 * @module schemas/seed-v3
 * @description SmallBizSeedV3 — the confidence-weighted enriched business data schema.
 * Contains all sections: identity, operations, offerings, trust, brand, marketing, media, seo.
 */

import { z } from 'zod';
import { confSchema } from './confidence.js';

// ── Helpers ──────────────────────────────────────────────────

const confStr = confSchema(z.string());
const confNum = confSchema(z.number());
const confBool = confSchema(z.boolean());
const confStrNull = confSchema(z.string().nullable());
const confNumNull = confSchema(z.number().nullable());

// ── Identity ─────────────────────────────────────────────────

export const geoSchema = z.object({
  lat: confNum,
  lng: confNum,
});

export const googleIdentitySchema = z.object({
  place_id: confStr,
  maps_url: confStr,
  cid: confStrNull.optional(),
});

export const addressSchema = z.object({
  street: confStr,
  city: confStr,
  state: confStr,
  zip: confStr,
  country: confStr,
});

export const identitySchema = z.object({
  business_name: confStr,
  tagline: confStr,
  description: confStr,
  mission_statement: confStr,
  business_type: confStr,
  categories: confSchema(z.array(z.string())).optional(),
  phone: confStrNull,
  email: confStrNull,
  website_url: confStrNull,
  primary_contact_name: confStrNull.optional(),
  sms_number: confStrNull.optional(),
  address: confSchema(addressSchema.shape ? z.object({
    street: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    zip: z.string().nullable(),
    country: z.string(),
  }) : z.unknown()),
  geo: confSchema(z.object({ lat: z.number(), lng: z.number() })).optional(),
  google: confSchema(z.object({
    place_id: z.string(),
    maps_url: z.string(),
    cid: z.string().nullable().optional(),
  })).optional(),
  service_area: confSchema(z.object({
    zips: z.array(z.string()).optional().default([]),
    towns: z.array(z.string()).optional().default([]),
  })).optional(),
  neighborhood: confStrNull.optional(),
  parking: confStrNull.optional(),
  public_transit: confStrNull.optional(),
  landmarks_nearby: confSchema(z.array(z.string())).optional(),
});

// ── Operations ───────────────────────────────────────────────

export const hoursEntrySchema = z.object({
  day: z.string(),
  open: z.string().nullable(),
  close: z.string().nullable(),
  closed: z.boolean().optional().default(false),
});

export const operationsSchema = z.object({
  hours: confSchema(z.array(hoursEntrySchema)),
  holiday_hours: confSchema(z.array(z.object({
    date: z.string(),
    label: z.string(),
    open: z.string().nullable(),
    close: z.string().nullable(),
    closed: z.boolean().optional().default(true),
  }))).optional(),
  booking: confSchema(z.object({
    url: z.string().nullable().optional(),
    platform: z.string().nullable().optional(),
    walkins_accepted: z.boolean().optional().default(true),
    typical_wait_minutes: z.number().nullable().optional(),
    appointment_required: z.boolean().optional().default(false),
    lead_time_minutes: z.number().nullable().optional(),
  })).optional(),
  policies: confSchema(z.object({
    cancellation: z.string().nullable().optional(),
    late: z.string().nullable().optional(),
    no_show: z.string().nullable().optional(),
    age: z.string().nullable().optional(),
    discount_rules: z.string().nullable().optional(),
  })).optional(),
  payments: confSchema(z.array(z.string())).optional(),
  amenities: confSchema(z.array(z.string())).optional(),
  accessibility: confSchema(z.object({
    wheelchair: z.boolean().optional().default(false),
    hearing_loop: z.boolean().optional().default(false),
    service_animals: z.boolean().optional().default(true),
    notes: z.string().nullable().optional(),
  })).optional(),
  languages_spoken: confSchema(z.array(z.string())).optional(),
});

// ── Offerings ────────────────────────────────────────────────

export const serviceAddOnSchema = z.object({
  name: z.string(),
  price_from: z.number().nullable().optional(),
  duration_minutes: z.number().nullable().optional(),
});

export const serviceSchema = z.object({
  name: confStr,
  description: confStr,
  price_hint: confStrNull,
  price_from: confNumNull.optional(),
  duration_minutes: confNumNull.optional(),
  variants: confSchema(z.array(z.string())).optional(),
  add_ons: confSchema(z.array(serviceAddOnSchema)).optional(),
  requirements: confStrNull.optional(),
  category: confStrNull.optional(),
});

export const offeringsSchema = z.object({
  services: confSchema(z.array(z.lazy(() => serviceSchema))),
  products_sold: confSchema(z.array(z.string())).optional(),
  guarantee_details: confStrNull.optional(),
  faq: confSchema(z.array(z.object({
    question: z.string(),
    answer: z.string(),
  }))),
});

// ── Trust ────────────────────────────────────────────────────

export const teamMemberSchema = z.object({
  name: confStr,
  role: confStr,
  bio: confStrNull.optional(),
  specialties: confSchema(z.array(z.string())).optional(),
  years_experience: confNumNull.optional(),
  instagram: confStrNull.optional(),
  headshot_url: confStrNull.optional(),
});

export const reviewSchema = z.object({
  quote: z.string(),
  name: z.string(),
  source: z.string(),
  rating: z.number().optional(),
});

export const trustSchema = z.object({
  team: confSchema(z.array(z.lazy(() => teamMemberSchema))).optional(),
  reviews: confSchema(z.object({
    aggregate: z.object({
      rating: z.number().min(0).max(5),
      count: z.number().min(0),
    }),
    featured: z.array(reviewSchema).optional().default([]),
  })).optional(),
  social_links: confSchema(z.array(z.object({
    platform: z.string(),
    url: z.string().nullable(),
    confidence: z.number().min(0).max(1).optional(),
  }))),
  review_platforms: confSchema(z.array(z.object({
    platform: z.string(),
    url: z.string().nullable(),
    rating: z.string().nullable().optional(),
  }))).optional(),
  credentials: confSchema(z.array(z.string())).optional(),
  before_after_gallery: confSchema(z.array(z.object({
    before_url: z.string(),
    after_url: z.string(),
    caption: z.string().optional(),
  }))).optional(),
});

// ── Brand ────────────────────────────────────────────────────

export const brandSchema = z.object({
  logo: confSchema(z.object({
    found_online: z.boolean().optional().default(false),
    logo_url: z.string().nullable().optional(),
    logo_svg: z.string().nullable().optional(),
    logo_png: z.string().nullable().optional(),
    favicon: z.string().nullable().optional(),
    og_image: z.string().nullable().optional(),
    search_query: z.string().optional().default(''),
    fallback_design: z.object({
      text: z.string().optional().default(''),
      font: z.string().optional().default('Inter'),
      accent_shape: z.string().optional().default('circle'),
      accent_color: z.string().optional().default('#64ffda'),
    }).optional().default({}),
  })),
  colors: confSchema(z.object({
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
    background: z.string(),
    surface: z.string(),
    text_primary: z.string(),
    text_secondary: z.string(),
  })),
  fonts: confSchema(z.object({
    heading: z.string(),
    body: z.string(),
  })),
  brand_personality: confStr,
  style_notes: confStr,
  tone: confSchema(z.object({
    do: z.array(z.string()).optional().default([]),
    dont: z.array(z.string()).optional().default([]),
  })).optional(),
});

// ── Marketing ────────────────────────────────────────────────

export const ctaSchema = z.object({
  text: z.string(),
  action: z.string(),
});

export const marketingSchema = z.object({
  selling_points: confSchema(z.array(z.object({
    headline: z.string(),
    description: z.string(),
    icon: z.string().optional().default('star'),
  }))),
  hero_slogans: confSchema(z.array(z.object({
    headline: z.string(),
    subheadline: z.string().nullable().optional(),
    cta_primary: ctaSchema.optional(),
    cta_secondary: ctaSchema.optional(),
  }))).optional(),
  benefit_bullets: confSchema(z.array(z.string())).optional(),
});

// ── Media ────────────────────────────────────────────────────

export const mediaItemSchema = z.object({
  url: z.string().nullable().optional(),
  search_query: z.string().optional(),
  alt_text: z.string().optional().default(''),
  source: z.string().optional(),
  license: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  aspect_ratio: z.string().optional().default('16:9'),
});

export const mediaSchema = z.object({
  hero_images: confSchema(z.array(z.object({
    concept: z.string(),
    url: z.string().nullable().optional(),
    search_query: z.string().optional(),
    stock_fallback: z.string().optional(),
    alt_text: z.string().optional().default(''),
    aspect_ratio: z.string().optional().default('16:9'),
  }))),
  storefront_image: confSchema(mediaItemSchema).optional(),
  team_image: confSchema(mediaItemSchema).optional(),
  service_images: confSchema(z.array(z.object({
    service_name: z.string(),
    url: z.string().nullable().optional(),
    search_query: z.string().optional(),
    alt_text: z.string().optional().default(''),
  }))).optional(),
  gallery: confSchema(z.array(mediaItemSchema)).optional(),
  placeholder_strategy: confStr,
});

// ── SEO ──────────────────────────────────────────────────────

export const seoSchema = z.object({
  title: confStr,
  description: confStr,
  primary_keywords: confSchema(z.array(z.string())),
  secondary_keywords: confSchema(z.array(z.string())).optional(),
  service_keywords: confSchema(z.array(z.string())).optional(),
  neighborhood_keywords: confSchema(z.array(z.string())).optional(),
  schema_org: confSchema(z.object({
    type: z.string(),
    openingHoursSpecification: z.array(z.unknown()).optional(),
    priceRange: z.string().optional(),
    hasMap: z.string().optional(),
    sameAs: z.array(z.string()).optional(),
    aggregateRating: z.object({
      ratingValue: z.number(),
      reviewCount: z.number(),
    }).optional(),
  })).optional(),
  pages: confSchema(z.record(z.string())).optional(),
});

// ── Provenance ───────────────────────────────────────────────

export const provenanceSchema = z.object({
  overallConfidence: z.number().min(0).max(1),
  sectionConfidence: z.record(z.number()),
  warnings: z.array(z.string()),
  enrichmentPipeline: z.array(z.enum([
    'llm_research',
    'google_places',
    'owner_questionnaire',
  ])),
  generatedAt: z.string(),
  version: z.literal('v3'),
});

// ── UI Policy ────────────────────────────────────────────────

export const uiPolicySchema = z.object({
  componentThresholds: z.record(z.number()),
  prominenceLevels: z.record(z.string()),
});

// ── SmallBizSeedV3 (root) ────────────────────────────────────

export const smallBizSeedV3Schema = z.object({
  identity: identitySchema,
  operations: operationsSchema,
  offerings: offeringsSchema,
  trust: trustSchema,
  brand: brandSchema,
  marketing: marketingSchema,
  media: mediaSchema,
  seo: seoSchema,
  uiPolicy: uiPolicySchema,
  provenance: provenanceSchema,
});

export type SmallBizSeedV3 = z.infer<typeof smallBizSeedV3Schema>;
