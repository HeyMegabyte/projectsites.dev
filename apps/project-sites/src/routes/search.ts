/**
 * @module routes/search
 * @description Public search and site-creation routes for the homepage SPA.
 *
 * These endpoints power the interactive homepage flow:
 *
 * ```
 * Screen 1 (Search)   → GET  /api/search/businesses   → Google Places proxy
 * Screen 1 (Lookup)   → GET  /api/sites/lookup         → check existing site by place_id/slug
 * Screen 3 (Create)   → POST /api/sites/create-from-search → create site + enqueue AI workflow
 * ```
 *
 * ## Route Map
 *
 * | Method | Path                           | Auth?  | Description                          |
 * | ------ | ------------------------------ | ------ | ------------------------------------ |
 * | GET    | `/api/search/businesses`       | No     | Proxy Google Places Text Search API  |
 * | GET    | `/api/sites/lookup`            | No     | Look up existing site by place_id    |
 * | POST   | `/api/sites/create-from-search`| Yes    | Create a site and queue generation   |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { badRequest, unauthorized, sanitizeHtml, stripHtml } from '@project-sites/shared';
import { dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import { writeAuditLog } from '../services/audit.js';

const search = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Google Places Search ───────────────────────────────────

interface GooglePlace {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  types?: string[];
  location?: { latitude: number; longitude: number };
}

interface GooglePlacesResponse {
  places?: GooglePlace[];
}

search.get('/api/search/businesses', async (c) => {
  const q = c.req.query('q');

  if (!q || q.trim().length === 0) {
    throw badRequest('Missing required query parameter: q');
  }

  // Build request body with optional location bias from browser geolocation
  const requestBody: Record<string, unknown> = { textQuery: q };

  const lat = c.req.query('lat');
  const lng = c.req.query('lng');
  if (lat && lng) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (!isNaN(latitude) && !isNaN(longitude)) {
      requestBody.locationBias = {
        circle: {
          center: { latitude, longitude },
          radius: 50000.0, // 50 km radius
        },
      };
    }
  }

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': c.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.id,places.types,places.location',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'search',
        message: 'Google Places API error',
        status: response.status,
        body: errorText.slice(0, 500),
        query: q,
      }),
    );
    // Return empty results with error info so the UI still works but we can debug
    return c.json({
      data: [],
      _error: {
        status: response.status,
        message: errorText.slice(0, 200),
      },
    });
  }

  const json = (await response.json()) as GooglePlacesResponse;
  const places = (json.places ?? []).slice(0, 10);

  const data = places.map((place) => ({
    place_id: place.id,
    name: place.displayName?.text ?? '',
    address: place.formattedAddress ?? '',
    types: place.types ?? [],
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
  }));

  return c.json({ data });
});

// ─── Site Search (pre-built) ─────────────────────────────────

interface SiteSearchRow {
  id: string;
  slug: string;
  business_name: string;
  business_address: string | null;
  google_place_id: string | null;
  status: string;
  current_build_version: string | null;
}

search.get('/api/sites/search', async (c) => {
  const q = c.req.query('q');

  if (!q || q.trim().length < 2) {
    return c.json({ data: [] });
  }

  const searchTerm = `%${q.trim()}%`;
  const { data } = await dbQuery<SiteSearchRow>(
    c.env.DB,
    'SELECT id, slug, business_name, business_address, google_place_id, status, current_build_version FROM sites WHERE business_name LIKE ? AND deleted_at IS NULL ORDER BY CASE WHEN status = \'published\' THEN 0 ELSE 1 END, created_at DESC LIMIT 5',
    [searchTerm],
  );

  return c.json({
    data: data.map((site) => ({
      site_id: site.id,
      slug: site.slug,
      business_name: site.business_name,
      business_address: site.business_address,
      google_place_id: site.google_place_id,
      status: site.status,
      has_build: site.current_build_version !== null,
    })),
  });
});

// ─── Site Lookup ────────────────────────────────────────────

interface SiteRow {
  id: string;
  slug: string;
  status: string;
  current_build_version: string | null;
}

search.get('/api/sites/lookup', async (c) => {
  const placeId = c.req.query('place_id');
  const slug = c.req.query('slug');

  if (!placeId && !slug) {
    throw badRequest('Missing required query parameter: place_id or slug');
  }

  let site: SiteRow | null;

  if (placeId) {
    site = await dbQueryOne<SiteRow>(
      c.env.DB,
      'SELECT id, slug, status, current_build_version FROM sites WHERE google_place_id = ? AND deleted_at IS NULL',
      [placeId],
    );
  } else {
    site = await dbQueryOne<SiteRow>(
      c.env.DB,
      'SELECT id, slug, status, current_build_version FROM sites WHERE slug = ? AND deleted_at IS NULL',
      [slug!],
    );
  }

  if (!site) {
    return c.json({ data: { exists: false } });
  }

  return c.json({
    data: {
      exists: true,
      site_id: site.id,
      slug: site.slug,
      status: site.status,
      has_build: site.current_build_version !== null,
    },
  });
});

// ─── Create Site from Search ────────────────────────────────

/**
 * Nested business object sent by the homepage SPA (v2 payload format).
 *
 * The frontend wraps business details under a `business` key.
 */
interface BusinessPayload {
  name: string;
  address?: string;
  place_id?: string;
  phone?: string;
  website?: string;
  types?: string[];
}

/**
 * Request body for POST /api/sites/create-from-search.
 *
 * Supports two payload formats for backward compatibility:
 *
 * **v1 (flat):** `{ business_name, business_address, google_place_id, additional_context }`
 *
 * **v2 (nested):** `{ mode, business: { name, address, place_id, phone, website, types }, additional_context }`
 */
interface CreateFromSearchBody {
  /** @deprecated Use `business.name` instead */
  business_name?: string;
  /** @deprecated Use `business.address` instead */
  business_address?: string;
  /** @deprecated Use `business.place_id` instead */
  google_place_id?: string;
  additional_context?: string;
  /** Nested business object (v2 format from homepage SPA) */
  business?: BusinessPayload;
  /** Creation mode: 'business' or 'custom' */
  mode?: string;
}

search.post('/api/sites/create-from-search', async (c) => {
  const orgId = c.get('orgId');

  if (!orgId) {
    throw unauthorized('Must be authenticated');
  }

  const body = (await c.req.json()) as CreateFromSearchBody;

  // Normalize: support both v1 (flat) and v2 (nested business object) payload formats
  const mode = body.mode ?? null;
  const businessName = body.business?.name || body.business_name || (mode === 'custom' ? 'Custom Website' : null);
  const businessAddress = body.business?.address || body.business_address;
  const googlePlaceId = body.business?.place_id || body.google_place_id;
  const businessPhone = body.business?.phone ?? null;

  if (!businessName || businessName.trim().length === 0) {
    throw badRequest('Missing required field: business_name (or business.name)');
  }

  // Validate and sanitize text inputs
  if (businessName.length > 200) {
    throw badRequest('Business name must be 200 characters or fewer');
  }

  const additionalContext = body.additional_context
    ? sanitizeHtml(String(body.additional_context).slice(0, 5000))
    : null;

  if (businessAddress && String(businessAddress).length > 500) {
    throw badRequest('Business address must be 500 characters or fewer');
  }

  // Strip HTML tags from business name
  const sanitizedName = stripHtml(businessName).trim();
  if (!sanitizedName) {
    throw badRequest('Business name cannot be empty after sanitization');
  }

  if (mode) {
    console.warn(`[create-from-search] mode=${mode}, business=${sanitizedName}`);
  }

  const slug = sanitizedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 63);

  const siteId = crypto.randomUUID();

  const site = {
    id: siteId,
    org_id: orgId,
    slug,
    business_name: sanitizedName,
    business_phone: businessPhone,
    business_email: null,
    business_address: businessAddress ?? null,
    google_place_id: googlePlaceId ?? null,
    bolt_chat_id: null,
    current_build_version: null,
    status: 'building',
    lighthouse_score: null,
    lighthouse_last_run: null,
    deleted_at: null,
  };

  const result = await dbInsert(c.env.DB, 'sites', site);

  if (result.error) {
    throw badRequest(`Failed to create site: ${result.error}`);
  }

  // Trigger AI site generation workflow
  let workflowInstanceId: string | null = null;
  if (c.env.SITE_WORKFLOW) {
    const instance = await c.env.SITE_WORKFLOW.create({
      id: siteId,
      params: {
        siteId,
        slug,
        businessName: sanitizedName,
        businessAddress: businessAddress ?? undefined,
        businessPhone: businessPhone ?? undefined,
        googlePlaceId: googlePlaceId ?? undefined,
        additionalContext: additionalContext ?? undefined,
        orgId: orgId,
      },
    });
    workflowInstanceId = instance.id;
  } else if (c.env.QUEUE) {
    // Fallback to queue if workflow binding is unavailable
    await c.env.QUEUE.send({
      job_name: 'generate_site',
      site_id: siteId,
      business_name: sanitizedName,
      google_place_id: googlePlaceId ?? null,
      additional_context: additionalContext,
    });
  }

  // Log audit
  await writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.created_from_search',
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      business_name: sanitizedName,
      google_place_id: googlePlaceId ?? null,
      mode,
    },
    request_id: c.get('requestId'),
  });

  return c.json(
    {
      data: {
        site_id: siteId,
        slug,
        status: 'building',
        workflow_instance_id: workflowInstanceId,
      },
    },
    201,
  );
});

export { search };
