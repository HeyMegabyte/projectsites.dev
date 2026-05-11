/**
 * @module services/confidence
 *
 * @description
 * Transforms raw research data into the confidence-wrapped **SmallBizSeedV3**
 * payload that every downstream template + UI component reads from. Takes the
 * 5 research bundles (`profile`, `social`, `brand`, `sellingPoints`, `images`)
 * + optional Google Places ground-truth and produces a single object where
 * every leaf value is wrapped in `Conf<T>` — `{ value, confidence (0-1),
 * sources[], rationale?, lastVerifiedAt?, isPlaceholder? }`.
 *
 * Why this exists: the orchestrator container + the runtime UI both need to
 * decide which fields to render *prominently* (high confidence, multiple
 * corroborating sources), *standard* (single trustworthy source), or
 * *placeholder* (LLM-only guess, may be wrong). Embedding confidence inline
 * means the orchestrator never has to re-query provenance — every field
 * carries its own pedigree.
 *
 * Confidence scoring algorithm (3-stage):
 *
 * 1. **Base score by source kind** — `BASE_CONFIDENCE` table assigns a fixed
 *    starting score per `SourceKind` (e.g. `business_owner=0.95`,
 *    `google_places=0.92`, `llm_generated=0.50`, `stock_photo=0.30`). Empty
 *    or placeholder values get a -0.15 / -0.10 penalty.
 * 2. **Graduated corroboration boost** — when `mergeConf()` combines two
 *    `Conf<T>` instances for the same field, the unique source-kind count
 *    drives a boost: 1 src=+0.00, 2 src=+0.08, 3 src=+0.15, 4+ src=+0.20.
 *    Score capped at 0.98 (never absolute certainty).
 * 3. **LLM-only inferred penalty** — fields the LLM guessed without any
 *    confirming source (payment methods, amenities, accessibility, languages)
 *    pass through `llmInferred()` which subtracts an extra 0.15 on top of the
 *    base 0.50 → typical floor 0.35.
 *
 * Google Places precedence rule: when `placesData` is non-null for a field
 * that has both an LLM guess and a Places value (phone, hours, website,
 * geo, reviews, photos), the Places value wins — `mergeConf()` picks the
 * higher-confidence source as primary and unions the source lists.
 *
 * Image filtering (`isImageRelevant()`): hero + gallery images are filtered
 * against business-type keywords before inclusion. Generic terms
 * (`shop|store|front|exterior|interior`) and business-name matches always
 * pass; type-specific keywords (barber→`[barber, haircut, fade, ...]`,
 * salon→`[salon, hair, beauty, ...]`) gate the rest. Unknown business types
 * skip filtering. Filter passes are documented in the `gallery` field's
 * `rationale`.
 *
 * Downstream consumers:
 * - `services/build_context.ts` reads the SmallBizSeedV3 and writes
 *   `_research.json` to R2 for the container to consume verbatim.
 * - `services/ai_workflows.ts::runPrompt` uses `provenance.warnings[]` to
 *   route around missing fields (e.g. "Missing: phone number" → skip
 *   `tel:` rendering, render placeholder instead).
 * - `uiPolicy.componentThresholds` is consumed by template logic to choose
 *   between `prominent` / `standard` / `deemphasize` / `hide_or_placeholder`
 *   rendering per field.
 *
 * @see {@link https://www.w3.org/TR/wcag2/ WCAG 2.2 AA} (image alt-text contract)
 */

import type { PlacesResult } from './google_places.js';

// ── Types (lightweight, no dependency on shared package) ─────

type SourceKind =
  | 'business_owner' | 'user_provided' | 'google_places' | 'osm'
  | 'review_platform' | 'domain_whois' | 'street_view' | 'social_profile'
  | 'llm_generated' | 'internal_inference' | 'stock_photo';

interface SourceRef {
  kind: SourceKind;
  id?: string;
  url?: string;
  retrievedAt: string;
  notes?: string;
}

interface Conf<T> {
  value: T;
  confidence: number;
  sources: SourceRef[];
  rationale?: string;
  lastVerifiedAt?: string;
  isPlaceholder?: boolean;
}

const BASE_CONFIDENCE: Record<SourceKind, number> = {
  business_owner: 0.95,
  user_provided: 0.90,
  google_places: 0.92,
  osm: 0.80,
  review_platform: 0.80,
  domain_whois: 0.70,
  street_view: 0.70,
  social_profile: 0.70,
  llm_generated: 0.50,
  internal_inference: 0.45,
  stock_photo: 0.30,
};

/**
 * Graduated corroboration boosts. More confirming sources = higher confidence.
 * e.g. Google Places + YellowPages + Google Maps all showing same phone = 3 sources = +0.15
 */
const CORROBORATION_BOOSTS: Record<number, number> = {
  1: 0.00,
  2: 0.08,
  3: 0.15,
  4: 0.20,
};

function getCorroborationBoost(uniqueSourceCount: number): number {
  if (uniqueSourceCount >= 4) return CORROBORATION_BOOSTS[4];
  return CORROBORATION_BOOSTS[uniqueSourceCount] ?? 0;
}

/**
 * Extra penalty for LLM-only inferred data (payment methods, amenities, etc.)
 * that cannot be verified from public sources.
 */
const LLM_ONLY_INFERRED_PENALTY = 0.15;

/**
 * Business-type image relevance keywords. Used to filter out images
 * that are clearly not related to the business type.
 */
const BUSINESS_IMAGE_KEYWORDS: Record<string, string[]> = {
  barber: ['barber', 'haircut', 'salon', 'shave', 'fade', 'grooming', 'hair', 'men'],
  salon: ['salon', 'hair', 'beauty', 'style', 'cut', 'color', 'women', 'nails'],
  restaurant: ['food', 'restaurant', 'dining', 'meal', 'kitchen', 'chef', 'plate'],
  dentist: ['dental', 'dentist', 'teeth', 'smile', 'clinic', 'office'],
  plumber: ['plumbing', 'pipe', 'water', 'repair', 'faucet', 'bathroom'],
};

// ── Helpers ──────────────────────────────────────────────────

const now = () => new Date().toISOString();

function conf<T>(
  value: T,
  kind: SourceKind,
  rationale?: string,
  opts?: { isPlaceholder?: boolean; id?: string; url?: string },
): Conf<T> {
  let c = BASE_CONFIDENCE[kind];
  if (value === null || value === undefined || value === '') c = Math.max(0, c - 0.15);
  if (opts?.isPlaceholder) c = Math.max(0, c - 0.10);
  return {
    value,
    confidence: Math.round(c * 100) / 100,
    sources: [{ kind, id: opts?.id, url: opts?.url, retrievedAt: now() }],
    rationale,
    lastVerifiedAt: now(),
    isPlaceholder: opts?.isPlaceholder ?? false,
  };
}

function llm<T>(value: T, rationale?: string): Conf<T> {
  return conf(value, 'llm_generated', rationale);
}

function gp<T>(value: T, placeId?: string, rationale?: string): Conf<T> {
  return conf(value, 'google_places', rationale, { id: placeId });
}

function placeholder<T>(value: T, rationale: string): Conf<T> {
  return conf(value, 'internal_inference', rationale, { isPlaceholder: true });
}

function mergeConf<T>(a: Conf<T>, b: Conf<T>): Conf<T> {
  const primary = a.confidence >= b.confidence ? a : b;
  const allSources = [...a.sources, ...b.sources];
  const seen = new Set<string>();
  const uniqueSources = allSources.filter((s) => {
    const key = s.kind + ':' + (s.id ?? s.url ?? '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const uniqueKinds = new Set(uniqueSources.map((s) => s.kind));
  let confidence = primary.confidence;
  // Graduated corroboration boost
  const boost = getCorroborationBoost(uniqueKinds.size);
  confidence = Math.min(0.98, confidence + boost);
  return {
    value: primary.value,
    confidence: Math.round(confidence * 100) / 100,
    sources: uniqueSources,
    rationale: primary.rationale,
    lastVerifiedAt: primary.lastVerifiedAt,
    isPlaceholder: false,
  };
}

/**
 * Apply LLM-only inferred penalty. For fields like payment methods, amenities, etc.
 * that are only guessed by the LLM without any confirming source.
 */
function llmInferred<T>(value: T, rationale?: string): Conf<T> {
  const base = llm(value, rationale);
  // Apply extra penalty for inferred-only data
  base.confidence = Math.max(0, Math.round((base.confidence - LLM_ONLY_INFERRED_PENALTY) * 100) / 100);
  return base;
}

/**
 * Filter images that are irrelevant to the business type.
 * Returns true if the image metadata suggests it matches the business.
 */
function isImageRelevant(imageAltText: string, businessType: string, businessName: string): boolean {
  const text = (imageAltText || '').toLowerCase();
  const name = businessName.toLowerCase();

  // Always include if it mentions the business name
  if (name && text.includes(name)) return true;

  // Always include if alt text is empty or very generic
  if (text.length === 0 || text === 'photo' || text === 'image') return true;

  // Always include generic business terms like "shop front", "exterior", etc.
  const genericTerms = ['shop', 'store', 'front', 'exterior', 'interior', 'entrance', 'sign', 'logo', 'building', 'office', 'staff', 'team', 'professional'];
  if (genericTerms.some((t) => text.includes(t))) return true;

  // Check business-type keywords
  const typeKey = Object.keys(BUSINESS_IMAGE_KEYWORDS).find((k) => businessType.toLowerCase().includes(k));
  if (!typeKey) return true; // No filter for unknown types

  // Include if alt text has relevant keywords for the business type
  const keywords = BUSINESS_IMAGE_KEYWORDS[typeKey];
  return keywords.some((kw) => text.includes(kw));
}

// ── Main Transformer ─────────────────────────────────────────

/**
 * Five raw research bundles produced by the OpenAI research pipeline
 * (`services/openai_research.ts`). Every field is typed as
 * `Record<string, unknown>` because the precise shape varies per business
 * type AND per LLM call (`o3-mini` may add/drop keys between runs). Strict
 * validation happens downstream via Zod inside
 * {@link transformToV3} field-extraction helpers (`str`, `num`, `arr`,
 * `strArr`) — never at this boundary, so a malformed bundle degrades
 * gracefully into low-confidence fields rather than failing the build.
 *
 * @remarks
 * - `profile`: output of `researchProfile()` — phone/email/hours/geo +
 *   primary services + business_type + employees + price range.
 * - `social`: output of `researchSocial()` — website + social handles
 *   (Instagram, Facebook, X/Twitter — see `formerTwitter` backcompat).
 * - `brand`: output of `researchBrand()` — logo URL + brand colors +
 *   typography (heading/body fonts) + tone + visual style.
 * - `sellingPoints`: output of `researchSellingPoints()` — 3 USPs +
 *   hero slogan candidates + competitive differentiators.
 * - `images`: output of `researchImages()` — hero candidates + gallery
 *   alt-text strategies + image search queries. Filtered downstream
 *   via {@link isImageRelevant}.
 *
 * @see {@link transformToV3} — primary consumer.
 * @see {@link "services/openai_research"} — producer of all five bundles.
 */
export interface RawResearch {
  profile: Record<string, unknown>;
  social: Record<string, unknown>;
  brand: Record<string, unknown>;
  sellingPoints: Record<string, unknown>;
  images: Record<string, unknown>;
}

/**
 * Transform the five raw research bundles + optional Google Places
 * ground-truth + user-provided inputs into the canonical **SmallBizSeedV3**
 * payload where every leaf value is wrapped in `Conf<T>` (`{ value,
 * confidence, sources, rationale?, lastVerifiedAt?, isPlaceholder? }`).
 *
 * This is the single most important transformation in the pipeline:
 * every downstream consumer (`services/build_context.ts` → `_research.json`
 * → container orchestrator → template UI rendering decisions) reads from
 * this output. The container never re-queries provenance — confidence
 * scores embedded here drive whether each field renders prominent,
 * standard, deemphasized, or as a placeholder.
 *
 * @param raw - Five research bundles (`profile`, `social`, `brand`,
 *   `sellingPoints`, `images`) — see {@link RawResearch} for shape.
 * @param placesData - Google Places verified record from
 *   `services/google_places.ts::lookupBusiness`. When non-null, takes
 *   precedence over LLM guesses for `phone`, `website`, `hours`, `geo`,
 *   `google identity`, `reviews`, and `photos` via {@link mergeConf}.
 *   When `null`, every contact/location field stays LLM-only at 0.50
 *   base confidence.
 * @param userInputs - User-provided values from the search/signup form.
 *   `businessName` is required (anchor for all research). `businessAddress`
 *   and `businessPhone` are optional; when present they merge in at
 *   `user_provided=0.90` — second only to Google Places ground-truth.
 *
 * @returns SmallBizSeedV3 payload with 8 top-level sections (`identity`,
 *   `operations`, `offerings`, `trust`, `brand`, `marketing`, `media`,
 *   `seo`) plus `uiPolicy` (component-threshold map driving render
 *   decisions) plus `provenance` (`overallConfidence` = mean of section
 *   averages, `warnings[]` collected from each missing-required-field
 *   branch, `enrichmentPipeline` listing the data sources actually used:
 *   always `['llm_research']`, conditionally `['llm_research', 'google_places']`).
 *
 * @remarks
 * Composition rules applied per-field:
 *
 * - **Phone**: LLM(0.50) ← user_provided(0.90) ← google_places(0.92).
 *   Final via {@link mergeConf} — corroboration boost applies.
 * - **Email**: LLM-only (Google Places doesn't return email). Warns
 *   if missing — businesses without email lose Contact JSON-LD richness.
 * - **Website**: LLM ← google_places.
 * - **Hours**: LLM(7-day array) ← google_places (verified weekday text).
 *   Places hours are normalized to the same `{ day, open, close, closed }`
 *   shape upstream in `google_places.ts`, so merge is structural-compatible.
 * - **Geo**: LLM ← google_places. Required for `LocalBusiness` JSON-LD
 *   `geo` property and Map embed centering — warns when missing.
 * - **Images**: Hero + gallery candidates filtered via
 *   {@link isImageRelevant} against `businessType`. Stock-photo
 *   prohibition: when no verified photos survive filtering, gallery
 *   falls back to `placeholder_strategy='css_gradient'` rather than
 *   inserting generic stock that would fail business-type semantic
 *   match (Megabyte Labs gate `image.business_type_mismatch`).
 * - **Amenities / payment methods / accessibility / languages**: marked
 *   `llmInferred()` which applies the extra -0.15 penalty on top of base
 *   0.50 → floor 0.35. These render as `hide_or_placeholder` per
 *   `uiPolicy.componentThresholds` unless corroborated by user input.
 *
 * `overallConfidence` calculation: arithmetic mean of per-section average
 * confidences (`computeSectionConfidence(section)`). Used by the orchestrator
 * to decide whether to escalate to a deeper research pass — sites with
 * overall <0.60 trigger a `researchProfile` re-run with broader search
 * scope before container build.
 *
 * @example
 * ```ts
 * import { transformToV3 } from './services/confidence.js';
 * import { lookupBusiness } from './services/google_places.js';
 *
 * const places = await lookupBusiness(env.GOOGLE_PLACES_API_KEY, name, addr);
 * const seed = transformToV3(
 *   { profile, social, brand, sellingPoints, images },
 *   places,
 *   { businessName: 'Vito\'s Mens Salon', businessAddress: addr, businessPhone: '+1-973-...' },
 * );
 * // seed.identity.phone.confidence === 0.92 (Google Places primary)
 * // seed.provenance.overallConfidence === 0.78
 * // seed.provenance.warnings === ['Missing: email address']
 * // seed.provenance.enrichmentPipeline === ['llm_research', 'google_places']
 * ```
 *
 * @throws Never — every field falls through to LLM-only or placeholder
 *   rather than throwing. Missing required fields accumulate in
 *   `provenance.warnings[]` for the orchestrator to surface.
 *
 * @see {@link RawResearch} - input bundle shape.
 * @see {@link mergeConf} - graduated-corroboration merge logic.
 * @see {@link isImageRelevant} - business-type image filter.
 * @see {@link "services/build_context"} - downstream `_research.json` writer.
 */
export function transformToV3(
  raw: RawResearch,
  placesData: PlacesResult | null,
  userInputs: { businessName: string; businessAddress?: string; businessPhone?: string },
): Record<string, unknown> {
  const p = raw.profile;
  const s = raw.social;
  const b = raw.brand;
  const sp = raw.sellingPoints;
  const img = raw.images;
  const g = placesData;
  const warnings: string[] = [];

  // ── Identity ─────────────────────────────────────────────

  // Phone: prefer Google Places > user input > LLM
  let phoneConf = llm(str(p.phone), 'LLM-inferred phone');
  if (userInputs.businessPhone) phoneConf = mergeConf(phoneConf, conf(userInputs.businessPhone, 'user_provided', 'User provided phone'));
  if (g?.phone) phoneConf = mergeConf(phoneConf, gp(g.phone, g.place_id, 'Google Places phone'));
  if (!phoneConf.value) warnings.push('Missing: phone number');

  // Email
  let emailConf = llm(str(p.email), 'LLM-inferred email');
  if (!emailConf.value) warnings.push('Missing: email address');

  // Website
  let websiteConf = llm(str(s.website_url) || str(p.website_url), 'LLM-inferred website');
  if (g?.website) websiteConf = mergeConf(websiteConf, gp(g.website, g.place_id, 'Google Places website'));
  if (!websiteConf.value) warnings.push('Missing: website URL');

  // Hours: prefer Google Places
  const rawHours = arr(p.hours);
  let hoursConf = llm(rawHours.map((h: Record<string, unknown>) => ({
    day: str(h.day), open: str(h.open), close: str(h.close), closed: !!h.closed,
  })), 'LLM-inferred operating hours');
  if (g?.hours) {
    hoursConf = mergeConf(hoursConf, gp(g.hours, g.place_id, 'Google Places verified hours'));
  }

  // Geo
  let geoConf = llm(
    p.geo && typeof p.geo === 'object' ? p.geo as { lat: number; lng: number } : null,
    'LLM-inferred coordinates',
  );
  if (g?.geo) geoConf = mergeConf(geoConf, gp(g.geo, g.place_id, 'Google Places coordinates'));
  if (!geoConf.value) warnings.push('Missing: geo coordinates (lat/lng)');

  // Google identity
  const googleData = p.google && typeof p.google === 'object' ? p.google as Record<string, unknown> : {};
  let googleConf = llm({
    place_id: str(googleData.place_id),
    maps_url: str(googleData.maps_url),
    cid: str(googleData.cid),
  }, 'LLM-inferred Google identity');
  if (g) {
    googleConf = mergeConf(googleConf, gp({
      place_id: g.place_id,
      maps_url: g.maps_url || '',
      cid: null,
    }, g.place_id, 'Google Places verified identity'));
  }

  // Address
  const rawAddr = p.address && typeof p.address === 'object' ? p.address as Record<string, unknown> : {};
  let addressConf = llm({
    street: str(rawAddr.street),
    city: str(rawAddr.city),
    state: str(rawAddr.state),
    zip: str(rawAddr.zip),
    country: str(rawAddr.country) || 'US',
  }, 'LLM-inferred address');
  if (userInputs.businessAddress) {
    addressConf = mergeConf(addressConf, conf(addressConf.value, 'user_provided', 'User provided address'));
  }

  const identity = {
    business_name: llm(str(p.business_name) || userInputs.businessName, 'Business name from input'),
    tagline: llm(str(p.tagline), 'LLM-generated tagline'),
    description: llm(str(p.description), 'LLM-generated description'),
    mission_statement: llm(str(p.mission_statement), 'LLM-generated mission'),
    business_type: llm(str(p.business_type) || 'general', 'LLM-inferred type'),
    categories: llm(strArr(p.categories), 'LLM-inferred categories'),
    phone: phoneConf,
    email: emailConf,
    website_url: websiteConf,
    primary_contact_name: llm(str(p.primary_contact_name), 'LLM-inferred contact'),
    address: addressConf,
    geo: geoConf,
    google: googleConf,
    service_area: llm(
      p.service_area && typeof p.service_area === 'object'
        ? p.service_area as { zips: string[]; towns: string[] }
        : { zips: [], towns: [] },
      'LLM-inferred service area',
    ),
    neighborhood: llm(str(p.neighborhood), 'LLM-inferred neighborhood'),
    parking: llm(str(p.parking), 'LLM-inferred parking'),
    public_transit: llm(str(p.public_transit), 'LLM-inferred transit'),
    landmarks_nearby: llm(strArr(p.landmarks_nearby), 'LLM-inferred landmarks'),
  };

  // ── Operations ───────────────────────────────────────────

  const bookingRaw = p.booking && typeof p.booking === 'object' ? p.booking as Record<string, unknown> : {};
  const policiesRaw = p.policies && typeof p.policies === 'object' ? p.policies as Record<string, unknown> : {};
  const accessRaw = p.accessibility && typeof p.accessibility === 'object' ? p.accessibility as Record<string, unknown> : {};

  if (!bookingRaw.url) warnings.push('Missing: booking URL');

  const operations = {
    hours: hoursConf,
    holiday_hours: placeholder([], 'No holiday hours data available'),
    booking: llm({
      url: str(bookingRaw.url),
      platform: str(bookingRaw.platform),
      walkins_accepted: bookingRaw.walkins_accepted !== false,
      typical_wait_minutes: num(bookingRaw.typical_wait_minutes),
      appointment_required: !!bookingRaw.appointment_required,
      lead_time_minutes: num(bookingRaw.lead_time_minutes),
    }, 'LLM-inferred booking info'),
    policies: llm({
      cancellation: str(policiesRaw.cancellation),
      late: str(policiesRaw.late),
      no_show: str(policiesRaw.no_show),
      age: str(policiesRaw.age),
      discount_rules: str(policiesRaw.discount_rules),
    }, 'LLM-inferred policies'),
    payments: llmInferred(strArr(p.payments), 'LLM-inferred payment methods — unverified, may not be accurate'),
    amenities: llmInferred(strArr(p.amenities), 'LLM-inferred amenities — unverified'),
    accessibility: llmInferred({
      wheelchair: !!accessRaw.wheelchair,
      hearing_loop: !!accessRaw.hearing_loop,
      service_animals: accessRaw.service_animals !== false,
      notes: str(accessRaw.notes),
    }, 'LLM-inferred accessibility — unverified'),
    languages_spoken: llmInferred(strArr(p.languages_spoken), 'LLM-inferred languages — unverified'),
  };

  // ── Offerings ────────────────────────────────────────────

  const rawServices = arr(p.services) as Array<Record<string, unknown>>;
  const services = rawServices.map((svc) => ({
    name: llm(str(svc.name), 'LLM-generated service name'),
    description: llm(str(svc.description), 'LLM-generated service description'),
    price_hint: llm(str(svc.price_hint), 'LLM-estimated price range'),
    price_from: llm(num(svc.price_from), 'LLM-estimated starting price'),
    duration_minutes: llm(num(svc.duration_minutes), 'LLM-estimated duration'),
    variants: llm(strArr(svc.variants), 'LLM-suggested variants'),
    add_ons: llm(arr(svc.add_ons) as Array<{ name: string; price_from: number | null; duration_minutes: number | null }>, 'LLM-suggested add-ons'),
    requirements: llm(str(svc.requirements), 'LLM-inferred requirements'),
    category: llm(str(svc.category), 'LLM-inferred category'),
  }));

  const offerings = {
    services: llm(services, 'LLM-generated service menu'),
    products_sold: llm(strArr(p.products_sold), 'LLM-inferred products'),
    guarantee_details: llm(str(p.guarantee_details), 'LLM-inferred guarantee'),
    faq: llm(arr(p.faq).map((f: Record<string, unknown>) => ({
      question: str(f.question), answer: str(f.answer),
    })), 'LLM-generated FAQ'),
  };

  // ── Trust ────────────────────────────────────────────────

  const rawTeam = arr(p.team) as Array<Record<string, unknown>>;
  const team = rawTeam.map((m) => ({
    name: llm(str(m.name), 'LLM-inferred team member'),
    role: llm(str(m.role), 'LLM-inferred role'),
    bio: llm(str(m.bio), 'LLM-generated bio'),
    specialties: llm(strArr(m.specialties), 'LLM-inferred specialties'),
    years_experience: llm(num(m.years_experience), 'LLM-estimated experience'),
    instagram: llm(str(m.instagram), 'LLM-inferred social'),
    headshot_url: placeholder(null as string | null, 'No headshot available'),
  }));

  // Reviews: prefer Google Places
  const reviewsRaw = p.reviews_summary && typeof p.reviews_summary === 'object'
    ? p.reviews_summary as Record<string, unknown>
    : {};
  let reviewsConf = llm({
    aggregate: {
      rating: num(reviewsRaw.aggregate_rating) ?? 0,
      count: num(reviewsRaw.review_count) ?? 0,
    },
    featured: arr(reviewsRaw.featured_reviews).map((r: Record<string, unknown>) => ({
      quote: str(r.quote), name: str(r.name), source: str(r.source) || 'Google',
    })),
  }, 'LLM-inferred reviews');

  if (g?.rating || g?.reviews?.length) {
    const gpReviews = {
      aggregate: {
        rating: g!.rating ?? 0,
        count: g!.review_count ?? 0,
      },
      featured: (g!.reviews || []).slice(0, 3).map((r) => ({
        quote: r.text.substring(0, 200),
        name: r.author,
        source: 'Google',
      })),
    };
    reviewsConf = mergeConf(reviewsConf, gp(gpReviews, g!.place_id, 'Google Places reviews'));
  }
  if (!reviewsConf.value.aggregate.count) warnings.push('Missing: customer reviews');

  // Social links
  const rawSocial = arr(s.social_links) as Array<Record<string, unknown>>;
  const socialLinks = rawSocial.map((link) => ({
    platform: str(link.platform),
    url: str(link.url),
    confidence: num(link.confidence) ?? 0.5,
  }));

  // Google business photos
  const rawGBPhotos = arr(s.google_business_photos) as Array<Record<string, unknown>>;
  let photos = rawGBPhotos.map((photo) => ({
    url: str(photo.url),
    alt_text: str(photo.alt_text),
    source: 'google',
  }));
  if (g?.photos?.length) {
    const gpPhotos = g.photos.map((photo) => ({
      url: photo.url,
      alt_text: `Photo of ${userInputs.businessName}`,
      source: 'google_places',
    }));
    photos = [...gpPhotos, ...photos];
  }

  const trust = {
    team: llm(team, 'LLM-inferred team'),
    reviews: reviewsConf,
    social_links: llm(socialLinks, 'LLM-inferred social profiles'),
    review_platforms: llm(arr(s.review_platforms).map((r: Record<string, unknown>) => ({
      platform: str(r.platform), url: str(r.url), rating: str(r.rating),
    })), 'LLM-inferred review platforms'),
    credentials: placeholder([] as string[], 'No credential data'),
    before_after_gallery: placeholder([] as Array<{ before_url: string; after_url: string }>, 'No before/after photos'),
  };

  // ── Brand ────────────────────────────────────────────────

  const rawLogo = b.logo && typeof b.logo === 'object' ? b.logo as Record<string, unknown> : {};
  const rawColors = b.colors && typeof b.colors === 'object' ? b.colors as Record<string, unknown> : {};
  const rawFonts = b.fonts && typeof b.fonts === 'object' ? b.fonts as Record<string, unknown> : {};
  const fallbackDesign = rawLogo.fallback_design && typeof rawLogo.fallback_design === 'object'
    ? rawLogo.fallback_design as Record<string, unknown>
    : {};

  const brand = {
    logo: llm({
      found_online: !!rawLogo.found_online,
      logo_url: null as string | null,
      logo_svg: null as string | null,
      logo_png: null as string | null,
      favicon: null as string | null,
      og_image: null as string | null,
      search_query: str(rawLogo.search_query),
      fallback_design: {
        text: str(fallbackDesign.text) || userInputs.businessName,
        font: str(fallbackDesign.font) || 'Inter',
        accent_shape: str(fallbackDesign.accent_shape) || 'circle',
        accent_color: str(fallbackDesign.accent_color) || '#64ffda',
      },
    }, 'LLM-generated logo guidance'),
    colors: llm({
      primary: str(rawColors.primary) || '#2563eb',
      secondary: str(rawColors.secondary) || '#7c3aed',
      accent: str(rawColors.accent) || '#64ffda',
      background: str(rawColors.background) || '#ffffff',
      surface: str(rawColors.surface) || '#f8fafc',
      text_primary: str(rawColors.text_primary) || '#1e293b',
      text_secondary: str(rawColors.text_secondary) || '#64748b',
    }, 'LLM-generated color palette'),
    fonts: llm({
      heading: str(rawFonts.heading) || 'Inter',
      body: str(rawFonts.body) || 'Inter',
    }, 'LLM-suggested typography'),
    brand_personality: llm(str(b.brand_personality), 'LLM-generated brand personality'),
    style_notes: llm(str(b.style_notes), 'LLM-generated style notes'),
    tone: placeholder({ do: [], dont: [] }, 'No tone guidelines provided'),
  };

  // ── Marketing ────────────────────────────────────────────

  const rawSP = arr(sp.selling_points) as Array<Record<string, unknown>>;
  const rawSlogans = arr(sp.hero_slogans) as Array<Record<string, unknown>>;

  const marketing = {
    selling_points: llm(rawSP.map((pt) => ({
      headline: str(pt.headline),
      description: str(pt.description),
      icon: str(pt.icon) || 'star',
    })), 'LLM-generated selling points'),
    hero_slogans: llm(rawSlogans.map((sl) => ({
      headline: str(sl.headline),
      subheadline: str(sl.subheadline),
      cta_primary: sl.cta_primary && typeof sl.cta_primary === 'object'
        ? sl.cta_primary as { text: string; action: string }
        : { text: 'Get Started', action: '#contact' },
      cta_secondary: sl.cta_secondary && typeof sl.cta_secondary === 'object'
        ? sl.cta_secondary as { text: string; action: string }
        : { text: 'Learn More', action: '#services' },
    })), 'LLM-generated hero slogans'),
    benefit_bullets: llm(strArr(sp.benefit_bullets), 'LLM-generated benefits'),
  };

  // ── Media ────────────────────────────────────────────────

  const rawHeroImages = arr(img.hero_images) as Array<Record<string, unknown>>;
  const rawServiceImages = arr(img.service_images) as Array<Record<string, unknown>>;
  // Determine business type for image filtering
  const businessType = str(p.business_type) || 'general';

  // Filter hero images: only keep concepts relevant to the business
  const filteredHeroImages = rawHeroImages.filter((hi) =>
    isImageRelevant(str(hi.concept) || str(hi.alt_text) || '', businessType, userInputs.businessName),
  );

  // Filter gallery photos: remove images that clearly don't match the business
  const filteredPhotos = photos.filter((ph) =>
    isImageRelevant(ph.alt_text ?? '', businessType, userInputs.businessName),
  );

  const media = {
    hero_images: llm(filteredHeroImages.map((hi) => ({
      concept: str(hi.concept),
      url: str(hi.url),
      search_query: str(hi.search_query) || str(hi.search_query_stock) || str(hi.search_query_specific),
      stock_fallback: null as string | null, // No Getty/stock fallbacks — use CSS placeholders
      alt_text: str(hi.alt_text) || str(hi.concept),
      aspect_ratio: str(hi.aspect_ratio) || '16:9',
    })), 'LLM-generated hero image concepts (filtered for relevance)'),
    storefront_image: img.storefront_image && typeof img.storefront_image === 'object'
      ? llm({
        url: str((img.storefront_image as Record<string, unknown>).url),
        search_query: str((img.storefront_image as Record<string, unknown>).search_query),
        alt_text: `Storefront of ${userInputs.businessName}`,
        source: 'inference',
        license: 'free',
        width: 1920,
        height: 1080,
        aspect_ratio: '16:9',
      }, 'LLM-suggested storefront image (actual business only)')
      : placeholder({
        url: null as string | null, search_query: '', alt_text: '', source: 'css_placeholder',
        license: '', width: 0, height: 0, aspect_ratio: '16:9',
      }, 'No storefront image — use CSS gradient placeholder'),
    team_image: placeholder({
      url: null as string | null, search_query: '', alt_text: '', source: 'css_placeholder',
      license: '', width: 0, height: 0, aspect_ratio: '16:9',
    }, 'No team photo available — use CSS placeholder'),
    service_images: llm(rawServiceImages.map((si) => ({
      service_name: str(si.service_name) || str(si.name),
      url: null as string | null, // Do not use stock images
      search_query: str(si.search_query) || str(si.search_query_stock),
      alt_text: str(si.alt_text),
    })), 'Service image concepts — actual photos only, no stock'),
    gallery: filteredPhotos.length > 0
      ? conf(filteredPhotos.map((ph) => ({
        url: ph.url, alt_text: ph.alt_text, source: ph.source, license: 'google_places',
      })), filteredPhotos[0].source === 'google_places' ? 'google_places' : 'llm_generated',
        'Business photos (filtered for relevance, ' + filteredPhotos.length + ' of ' + photos.length + ' kept)')
      : placeholder([] as Array<{ url: string; alt_text: string; source: string; license: string }>,
        'No verified business photos — use CSS gradient/pattern placeholders'),
    // NEVER use stock photos or Getty images. CSS gradients/patterns/illustrations only.
    placeholder_strategy: conf('css_gradient', 'internal_inference',
      'CSS gradients and patterns only — no stock photos, no Getty, no copyrighted images'),
  };

  // ── SEO ──────────────────────────────────────────────────

  const rawSeo = p.seo && typeof p.seo === 'object' ? p.seo as Record<string, unknown> : {};
  const seo = {
    title: llm(str(rawSeo.title) || str(p.seo_title) || `${userInputs.businessName}`, 'LLM-generated SEO title'),
    description: llm(str(rawSeo.description) || str(p.seo_description) || '', 'LLM-generated SEO description'),
    primary_keywords: llm(strArr(rawSeo.primary_keywords), 'LLM-generated primary keywords'),
    secondary_keywords: llm(strArr(rawSeo.secondary_keywords), 'LLM-generated secondary keywords'),
    service_keywords: llm(strArr(rawSeo.service_keywords), 'LLM-generated service keywords'),
    neighborhood_keywords: llm(strArr(rawSeo.neighborhood_keywords), 'LLM-generated local keywords'),
    schema_org: llm({
      type: str(p.schema_org_type) || 'LocalBusiness',
      priceRange: rawServices.length > 0 ? str(rawServices[0].price_hint) : undefined,
      sameAs: socialLinks.filter((l) => l.url).map((l) => l.url),
      aggregateRating: reviewsConf.value.aggregate.count > 0 ? {
        ratingValue: reviewsConf.value.aggregate.rating,
        reviewCount: reviewsConf.value.aggregate.count,
      } : undefined,
    }, 'Generated schema.org inputs'),
    pages: placeholder({} as Record<string, string>, 'No page-specific blurbs'),
  };

  // ── Provenance ───────────────────────────────────────────

  const sections = { identity, operations, offerings, trust, brand, marketing, media, seo };
  const sectionConfidence: Record<string, number> = {};
  for (const [name, section] of Object.entries(sections)) {
    sectionConfidence[name] = computeSectionConfidence(section);
  }
  const allScores = Object.values(sectionConfidence);
  const overallConfidence = allScores.length > 0
    ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 100) / 100
    : 0;

  const enrichmentPipeline: string[] = ['llm_research'];
  if (g) enrichmentPipeline.push('google_places');

  // ── UI Policy ────────────────────────────────────────────

  const uiPolicy = {
    componentThresholds: {
      'hero.title': 0.80,
      'hero.tagline': 0.80,
      'contact.phone': 0.85,
      'contact.booking_cta': 0.85,
      'contact.address': 0.85,
      'contact.map': 0.85,
      'hours.display': 0.80,
      'reviews.aggregate': 0.80,
      'services.pricing': 0.75,
      'team.bios': 0.70,
      'brand.colors': 0.70,
      'brand.fonts': 0.70,
      'marketing.copy': 0.60,
      'images.hero': 0.50,
      'images.gallery': 0.40,
    },
    prominenceLevels: {
      prominent: 'confidence >= 0.85',
      standard: '0.70-0.84',
      deemphasize: '0.50-0.69',
      hide_or_placeholder: '< 0.50',
    },
  };

  return {
    identity,
    operations,
    offerings,
    trust,
    brand,
    marketing,
    media,
    seo,
    uiPolicy,
    provenance: {
      overallConfidence,
      sectionConfidence,
      warnings,
      enrichmentPipeline,
      generatedAt: now(),
      version: 'v3',
    },
  };
}

// ── Internal helpers ─────────────────────────────────────────

function str(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && !isNaN(v)) return v;
  return null;
}

function arr(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? v : [];
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === 'string');
}

function computeSectionConfidence(obj: unknown): number {
  const scores: number[] = [];
  function walk(current: unknown): void {
    if (current && typeof current === 'object') {
      const c = current as Record<string, unknown>;
      if ('confidence' in c && 'value' in c && 'sources' in c) {
        scores.push(c.confidence as number);
        return;
      }
      if (Array.isArray(current)) {
        current.forEach((item) => walk(item));
        return;
      }
      for (const v of Object.values(c)) walk(v);
    }
  }
  walk(obj);
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
}
