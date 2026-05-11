/**
 * @module services/google_places
 *
 * @description
 * Google Places API client that enriches AI-generated sites with
 * verified, first-party business data — hours, phone, website, geo,
 * photos, reviews, ratings, types, and the canonical `maps.google.com`
 * deep-link. Used by the workflow's `google-places-lookup` step
 * (`workflows/site-generation.ts`) AFTER the deterministic profile
 * scrape to overwrite uncertain LLM-inferred fields with ground truth.
 *
 * Two-step API dance (Places API "Classic" Text Search + Place Details
 * — NOT Places API New v1 — because the classic endpoint returns
 * formatted hours + photo references in one round-trip, and v1's per-
 * request field-mask billing model is harder to estimate at our scale):
 *
 * 1. `Text Search` (`/place/textsearch/json`) — fuzzy match
 *    `"${name} ${address}"` → returns top result's `place_id`.
 * 2. `Place Details` (`/place/details/json`) — fetch the 16 fields we
 *    care about scoped to that `place_id`.
 *
 * Cost: 2 billable requests per call ($0.017 Text + $0.017 Details +
 * $0.007 per photo URL if `photos[]` length matters — Photo URLs are
 * built but NOT pre-resolved, so the photo billing only fires when the
 * site actually loads the image). Brian's monthly Places budget is
 * monitored via PostHog `funnel_places_lookup` event.
 *
 * Failure modes (all collapse to `null` return, never throw):
 * - `apiKey` missing → silent skip (local dev, free tier).
 * - HTTP non-2xx → swallowed (rate limit, outage, network).
 * - Status `ZERO_RESULTS` → silent skip (legitimate "not found").
 * - Status `OVER_QUERY_LIMIT` / `REQUEST_DENIED` → silent skip + warn
 *   (quota exhausted; downstream uses scraped fallback).
 * - JSON parse error → swallowed via outer try/catch.
 *
 * @example
 * ```ts
 * import { lookupBusiness } from './services/google_places.js';
 *
 * const result = await lookupBusiness(
 *   env.GOOGLE_PLACES_API_KEY,
 *   "Vito's Mens Salon",
 *   '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
 * );
 * if (result) {
 *   // result.phone === '+1 973-335-1234'
 *   // result.hours[0] === { day: 'Sunday', open: null, close: null, closed: true }
 * }
 * ```
 *
 * @see {@link https://developers.google.com/maps/documentation/places/web-service/search Text Search}
 * @see {@link https://developers.google.com/maps/documentation/places/web-service/details Place Details}
 */

export interface PlacesResult {
  place_id: string;
  name: string;
  formatted_address: string;
  phone: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  hours: Array<{ day: string; open: string | null; close: string | null; closed: boolean }> | null;
  geo: { lat: number; lng: number } | null;
  maps_url: string | null;
  photos: Array<{ url: string; attribution: string; width: number; height: number }>;
  types: string[];
  price_level: number | null;
  reviews: Array<{ text: string; author: string; rating: number; time: string }>;
  business_status: string | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Resolve a business to its Google Places ground-truth record by
 * fuzzy-matching name + address, then fetching the full Place Details
 * payload. Fire-and-forget — failures collapse to `null`, never throw.
 *
 * @param apiKey          - `GOOGLE_PLACES_API_KEY` Worker secret.
 *   Empty/undefined short-circuits to `null` (local dev pattern).
 * @param businessName    - Display name as the user entered it
 *   (e.g. `"Vito's Mens Salon"`). Used in Text Search query alongside
 *   address for fuzzy disambiguation between chains.
 * @param businessAddress - Free-form address string (any format Google
 *   geocodes — full street + city + state + ZIP best, but partials
 *   like `"NYC"` also work). Concatenated with name for query.
 *
 * @returns Fully-populated `PlacesResult` on match, `null` on any
 *   failure (missing key, no results, network error, rate limit,
 *   non-OK status). Caller MUST handle `null` — never throws.
 *
 * @remarks
 * Hours normalization: Google returns `periods[]` indexed 0-6 (Sun-Sat)
 * with `time: "HHMM"` format. We expand this to a stable 7-element
 * array of `{ day, open, close, closed }` so downstream JSON-LD
 * `LocalBusiness.openingHoursSpecification` can be built without
 * re-indexing logic in the prompt. Missing periods → `closed: true`.
 *
 * Photo capping: returns top 10 photos. The classic Photo URL is
 * built (not resolved) — billing only fires when the rendered site
 * actually loads the image, so building 10 is free at the API layer.
 *
 * Review capping: returns top 5 reviews (Google's default sort
 * already prioritizes "most relevant"; we don't re-sort).
 *
 * Phone preference: `international_phone_number` (E.164 form) over
 * `formatted_phone_number` (locale form) when both present. Downstream
 * `tel:` href + JSON-LD prefer E.164.
 *
 * @throws Never — all errors swallowed via outer try/catch + `console.warn`.
 *
 * @example
 * ```ts
 * const place = await lookupBusiness(
 *   env.GOOGLE_PLACES_API_KEY,
 *   'Stripe HQ',
 *   '510 Townsend St, San Francisco, CA',
 * );
 * // place.geo === { lat: 37.7672, lng: -122.4023 }
 * // place.types === ['point_of_interest', 'establishment']
 * ```
 */
export async function lookupBusiness(
  apiKey: string | undefined,
  businessName: string,
  businessAddress: string,
): Promise<PlacesResult | null> {
  if (!apiKey) return null;

  try {
    // Step 1: Text Search to find the place
    const query = `${businessName} ${businessAddress}`.trim();
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return null;

    const searchData = (await searchRes.json()) as {
      results: Array<{ place_id: string; name: string; formatted_address: string; geometry: { location: { lat: number; lng: number } } }>;
      status: string;
    };

    if (searchData.status !== 'OK' || !searchData.results?.length) return null;

    const placeId = searchData.results[0].place_id;

    // Step 2: Place Details for full info
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,formatted_phone_number,international_phone_number,website,rating,user_ratings_total,opening_hours,geometry,photos,types,price_level,reviews,url,business_status&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl);
    if (!detailsRes.ok) return null;

    const detailsData = (await detailsRes.json()) as {
      result: {
        name: string;
        formatted_address: string;
        formatted_phone_number?: string;
        international_phone_number?: string;
        website?: string;
        rating?: number;
        user_ratings_total?: number;
        opening_hours?: {
          periods?: Array<{
            open: { day: number; time: string };
            close?: { day: number; time: string };
          }>;
          weekday_text?: string[];
        };
        geometry?: { location: { lat: number; lng: number } };
        photos?: Array<{ photo_reference: string; width: number; height: number; html_attributions: string[] }>;
        types?: string[];
        price_level?: number;
        reviews?: Array<{ text: string; author_name: string; rating: number; relative_time_description: string }>;
        url?: string;
        business_status?: string;
      };
      status: string;
    };

    if (detailsData.status !== 'OK') return null;

    const d = detailsData.result;

    // Parse hours
    let hours: PlacesResult['hours'] = null;
    if (d.opening_hours?.periods) {
      hours = DAY_NAMES.map((dayName, idx) => {
        const period = d.opening_hours!.periods!.find((p) => p.open.day === idx);
        if (!period) return { day: dayName, open: null as string | null, close: null as string | null, closed: true };
        const openTime = formatTime(period.open.time);
        const closeTime = period.close ? formatTime(period.close.time) : null;
        return { day: dayName, open: openTime, close: closeTime, closed: false };
      });
    }

    // Build photo URLs
    const photos = (d.photos || []).slice(0, 10).map((p) => ({
      url: `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${p.width}&photo_reference=${p.photo_reference}&key=${apiKey}`,
      attribution: p.html_attributions?.[0] || '',
      width: p.width,
      height: p.height,
    }));

    // Build reviews
    const reviews = (d.reviews || []).slice(0, 5).map((r) => ({
      text: r.text,
      author: r.author_name,
      rating: r.rating,
      time: r.relative_time_description,
    }));

    return {
      place_id: placeId,
      name: d.name,
      formatted_address: d.formatted_address,
      phone: d.international_phone_number || d.formatted_phone_number || null,
      website: d.website || null,
      rating: d.rating ?? null,
      review_count: d.user_ratings_total ?? null,
      hours,
      geo: d.geometry?.location ?? null,
      maps_url: d.url ?? null,
      photos,
      types: d.types || [],
      price_level: d.price_level ?? null,
      reviews,
      business_status: d.business_status ?? null,
    };
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      service: 'google_places',
      message: 'Google Places lookup failed',
      error: err instanceof Error ? err.message : String(err),
    }));
    return null;
  }
}

/** Convert "0930" → "9:30 AM" */
function formatTime(time: string): string {
  const h = parseInt(time.substring(0, 2), 10);
  const m = time.substring(2);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m} ${period}`;
}
