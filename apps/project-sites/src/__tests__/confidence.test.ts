/**
 * @module __tests__/confidence
 * @description Unit tests for the confidence transformer (transformToV3).
 */

import { transformToV3 } from '../services/confidence.js';
import type { RawResearch } from '../services/confidence.js';
import type { PlacesResult } from '../services/google_places.js';

const mockRawResearch: RawResearch = {
  profile: {
    business_name: 'Test Barber',
    tagline: 'Best cuts in town',
    description: 'A great barber shop.',
    mission_statement: 'We care about your look.',
    business_type: 'Barber Shop',
    categories: ['Barber', 'Grooming'],
    services: [
      { name: 'Haircut', description: 'Classic cut', price_hint: '$25-$40', price_from: 25, duration_minutes: 30, variants: ['Classic', 'Fade'], add_ons: [], category: 'Haircuts' },
    ],
    hours: [
      { day: 'Monday', open: '9:00 AM', close: '6:00 PM', closed: false },
      { day: 'Tuesday', open: '9:00 AM', close: '6:00 PM', closed: false },
    ],
    phone: '+19735550123',
    email: 'test@barber.com',
    website_url: 'https://testbarber.com',
    address: { street: '123 Main St', city: 'Lake Hiawatha', state: 'NJ', zip: '07034', country: 'US' },
    geo: { lat: 40.88, lng: -74.38 },
    google: { place_id: 'ChIJ123', maps_url: 'https://maps.google.com/?cid=123' },
    service_area: { zips: ['07034'], towns: ['Lake Hiawatha'] },
    booking: { url: 'https://booksy.com/test', platform: 'Booksy', walkins_accepted: true },
    policies: { cancellation: 'Cancel 4h in advance' },
    payments: ['Cash', 'Credit Cards'],
    amenities: ['Walk-ins welcome', 'Free WiFi'],
    team: [{ name: 'Alex', role: 'Owner', specialties: ['Fades'] }],
    reviews_summary: { aggregate_rating: 4.8, review_count: 120, featured_reviews: [{ quote: 'Great!', name: 'Mike', source: 'Google' }] },
    faq: [{ question: 'Walk-ins?', answer: 'Yes!' }],
    seo: { title: 'Test Barber - Lake Hiawatha', description: 'Best barber', primary_keywords: ['barber'], secondary_keywords: ['haircut'], service_keywords: ['fade'], neighborhood_keywords: ['07034'] },
    schema_org_type: 'BarberShop',
  },
  social: {
    social_links: [{ platform: 'instagram', url: 'https://instagram.com/testbarber', confidence: 0.9 }],
    website_url: 'https://testbarber.com',
    review_platforms: [{ platform: 'Google', url: 'https://g.co/test', rating: '4.8' }],
    google_business_photos: [{ url: 'https://photos.google.com/1', alt_text: 'Shop front' }],
  },
  brand: {
    logo: { found_online: false, search_query: 'test barber logo', fallback_design: { text: 'TB', font: 'Inter', accent_shape: 'circle', accent_color: '#64ffda' } },
    colors: { primary: '#2563eb', secondary: '#7c3aed', accent: '#64ffda', background: '#fff', surface: '#f8f', text_primary: '#111', text_secondary: '#666' },
    fonts: { heading: 'Montserrat', body: 'Lato' },
    brand_personality: 'Modern, friendly',
    style_notes: 'Clean and bold',
  },
  sellingPoints: {
    selling_points: [{ headline: 'Expert Barbers', description: 'Years of experience', icon: 'users' }],
    hero_slogans: [{ headline: 'Look Great', subheadline: 'Feel Great', cta_primary: { text: 'Book Now', action: '#contact' }, cta_secondary: { text: 'Learn More', action: '#services' } }],
    benefit_bullets: ['Expert barbers', 'Quick service'],
  },
  images: {
    hero_images: [{ concept: 'Barber action', search_query: 'barber cutting hair', alt_text: 'Barber cutting hair', aspect_ratio: '16:9' }],
    storefront_image: { search_query: 'barber shop', confidence: 0.6, fallback_description: 'Shop front' },
    service_images: [{ service_name: 'Haircut', search_query: 'haircut', alt_text: 'Haircut service' }],
    gallery: [],
    placeholder_strategy: 'stock',
  },
};

describe('transformToV3', () => {
  it('produces v3 output with all required sections', () => {
    const v3 = transformToV3(mockRawResearch, null, { businessName: 'Test Barber' });
    expect(v3).toHaveProperty('identity');
    expect(v3).toHaveProperty('operations');
    expect(v3).toHaveProperty('offerings');
    expect(v3).toHaveProperty('trust');
    expect(v3).toHaveProperty('brand');
    expect(v3).toHaveProperty('marketing');
    expect(v3).toHaveProperty('media');
    expect(v3).toHaveProperty('seo');
    expect(v3).toHaveProperty('uiPolicy');
    expect(v3).toHaveProperty('provenance');
  });

  it('wraps every identity field in Conf<T>', () => {
    const v3 = transformToV3(mockRawResearch, null, { businessName: 'Test Barber' });
    const id = v3.identity as Record<string, unknown>;
    for (const key of ['business_name', 'tagline', 'description', 'phone', 'email']) {
      const field = id[key] as Record<string, unknown>;
      expect(field).toHaveProperty('value');
      expect(field).toHaveProperty('confidence');
      expect(field).toHaveProperty('sources');
      expect(typeof field.confidence).toBe('number');
      expect(Array.isArray(field.sources)).toBe(true);
    }
  });

  it('uses llm_generated source for LLM-inferred data', () => {
    const v3 = transformToV3(mockRawResearch, null, { businessName: 'Test Barber' });
    const id = v3.identity as Record<string, { sources: Array<{ kind: string }> }>;
    expect(id.tagline.sources[0].kind).toBe('llm_generated');
  });

  it('merges Google Places data with higher confidence', () => {
    const placesData: PlacesResult = {
      place_id: 'ChIJ456',
      name: 'Test Barber',
      formatted_address: '123 Main St, Lake Hiawatha, NJ 07034',
      phone: '+19735550999',
      website: 'https://testbarber.com',
      rating: 4.9,
      review_count: 200,
      hours: [
        { day: 'Monday', open: '10:00 AM', close: '7:00 PM', closed: false },
      ],
      geo: { lat: 40.881, lng: -74.381 },
      maps_url: 'https://maps.google.com/?cid=456',
      photos: [{ url: 'https://photo.google/1', attribution: 'Google', width: 1024, height: 768 }],
      types: ['barber_shop'],
      price_level: 2,
      reviews: [{ text: 'Amazing cuts!', author: 'Jane D.', rating: 5, time: '2 months ago' }],
      business_status: 'OPERATIONAL',
    };

    const v3 = transformToV3(mockRawResearch, placesData, { businessName: 'Test Barber' });
    const id = v3.identity as Record<string, { value: unknown; confidence: number; sources: Array<{ kind: string }> }>;

    // Phone should use Google Places value (higher confidence)
    expect(id.phone.value).toBe('+19735550999');
    expect(id.phone.confidence).toBeGreaterThan(0.85);
    // Should have corroboration from both sources
    expect(id.phone.sources.length).toBeGreaterThanOrEqual(2);
  });

  it('computes provenance with overall confidence', () => {
    const v3 = transformToV3(mockRawResearch, null, { businessName: 'Test Barber' });
    const prov = v3.provenance as Record<string, unknown>;
    expect(prov.version).toBe('v3');
    expect(typeof prov.overallConfidence).toBe('number');
    expect((prov.overallConfidence as number)).toBeGreaterThan(0);
    expect((prov.overallConfidence as number)).toBeLessThanOrEqual(1);
    expect(prov.enrichmentPipeline).toEqual(['llm_research']);
    expect(typeof prov.generatedAt).toBe('string');
  });

  it('includes google_places in enrichmentPipeline when places data provided', () => {
    const placesData: PlacesResult = {
      place_id: 'ChIJ789', name: 'Test', formatted_address: '',
      phone: null, website: null, rating: null, review_count: null,
      hours: null, geo: null, maps_url: null, photos: [], types: [],
      price_level: null, reviews: [], business_status: null,
    };
    const v3 = transformToV3(mockRawResearch, placesData, { businessName: 'Test' });
    const prov = v3.provenance as Record<string, unknown>;
    expect(prov.enrichmentPipeline).toEqual(['llm_research', 'google_places']);
  });

  it('generates warnings for missing critical fields', () => {
    const sparse: RawResearch = {
      profile: { business_name: 'Sparse Biz', business_type: 'general' },
      social: {},
      brand: {},
      sellingPoints: { selling_points: [] },
      images: {},
    };
    const v3 = transformToV3(sparse, null, { businessName: 'Sparse Biz' });
    const prov = v3.provenance as Record<string, unknown>;
    const warnings = prov.warnings as string[];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('phone'))).toBe(true);
    expect(warnings.some((w) => w.includes('email'))).toBe(true);
    expect(warnings.some((w) => w.includes('website'))).toBe(true);
  });

  it('includes uiPolicy with component thresholds', () => {
    const v3 = transformToV3(mockRawResearch, null, { businessName: 'Test' });
    const ui = v3.uiPolicy as Record<string, Record<string, unknown>>;
    expect(ui.componentThresholds['contact.phone']).toBe(0.85);
    expect(ui.componentThresholds['hero.tagline']).toBe(0.80);
    expect(ui.componentThresholds['images.gallery']).toBe(0.40);
  });

  it('transforms services with enriched fields', () => {
    const v3 = transformToV3(mockRawResearch, null, { businessName: 'Test' });
    const offerings = v3.offerings as Record<string, { value: unknown }>;
    const services = offerings.services.value as Array<Record<string, { value: unknown }>>;
    expect(services.length).toBe(1);
    expect(services[0].name.value).toBe('Haircut');
    expect(services[0].price_from.value).toBe(25);
    expect(services[0].duration_minutes.value).toBe(30);
  });

  it('transforms trust section with reviews', () => {
    const v3 = transformToV3(mockRawResearch, null, { businessName: 'Test' });
    const trust = v3.trust as Record<string, { value: unknown; confidence: number }>;
    const reviews = trust.reviews.value as Record<string, unknown>;
    expect((reviews.aggregate as Record<string, number>).rating).toBe(4.8);
    expect((reviews.aggregate as Record<string, number>).count).toBe(120);
  });

  it('transforms gallery with Google business photos', () => {
    const v3 = transformToV3(mockRawResearch, null, { businessName: 'Test' });
    const media = v3.media as Record<string, { value: unknown; confidence: number }>;
    const gallery = media.gallery.value as Array<Record<string, string>>;
    expect(gallery.length).toBeGreaterThanOrEqual(1);
    expect(gallery[0].url).toBe('https://photos.google.com/1');
  });
});
