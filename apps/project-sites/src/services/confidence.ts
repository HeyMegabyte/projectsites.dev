/**
 * @module services/confidence
 * @description Transforms raw research data into confidence-wrapped v3 format.
 * Takes the 5 research outputs + optional Google Places data and produces
 * a SmallBizSeedV3-compatible object with every leaf wrapped in Conf<T>.
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

export interface RawResearch {
  profile: Record<string, unknown>;
  social: Record<string, unknown>;
  brand: Record<string, unknown>;
  sellingPoints: Record<string, unknown>;
  images: Record<string, unknown>;
}

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
  const rawGallery = arr(img.gallery) as Array<Record<string, unknown>>;

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
