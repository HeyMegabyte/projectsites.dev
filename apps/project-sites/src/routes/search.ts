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
import { badRequest, unauthorized } from '@project-sites/shared';
import { dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import { writeAuditLog } from '../services/audit.js';

const search = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Google Places Search ───────────────────────────────────

interface GooglePlace {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  types?: string[];
}

interface GooglePlacesResponse {
  places?: GooglePlace[];
}

search.get('/api/search/businesses', async (c) => {
  const q = c.req.query('q');

  if (!q || q.trim().length === 0) {
    throw badRequest('Missing required query parameter: q');
  }

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': c.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.id,places.types',
    },
    body: JSON.stringify({ textQuery: q }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw badRequest(`Google Places API error: ${errorText}`);
  }

  const json = (await response.json()) as GooglePlacesResponse;
  const places = (json.places ?? []).slice(0, 10);

  const data = places.map((place) => ({
    place_id: place.id,
    name: place.displayName?.text ?? '',
    address: place.formattedAddress ?? '',
    types: place.types ?? [],
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

interface CreateFromSearchBody {
  business_name: string;
  business_address?: string;
  google_place_id?: string;
  additional_context?: string;
}

search.post('/api/sites/create-from-search', async (c) => {
  const orgId = c.get('orgId');

  if (!orgId) {
    throw unauthorized('Must be authenticated');
  }

  const body = (await c.req.json()) as CreateFromSearchBody;

  if (!body.business_name || body.business_name.trim().length === 0) {
    throw badRequest('Missing required field: business_name');
  }

  const slug = body.business_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 63);

  const siteId = crypto.randomUUID();

  const site = {
    id: siteId,
    org_id: orgId,
    slug,
    business_name: body.business_name,
    business_phone: null,
    business_email: null,
    business_address: body.business_address ?? null,
    google_place_id: body.google_place_id ?? null,
    bolt_chat_id: null,
    current_build_version: null,
    status: 'queued',
    lighthouse_score: null,
    lighthouse_last_run: null,
    deleted_at: null,
  };

  const result = await dbInsert(c.env.DB, 'sites', site);

  if (result.error) {
    throw badRequest(`Failed to create site: ${result.error}`);
  }

  // Enqueue AI workflow (if Queues is enabled)
  if (c.env.QUEUE) {
    await c.env.QUEUE.send({
      job_name: 'generate_site',
      site_id: siteId,
      business_name: body.business_name,
      google_place_id: body.google_place_id ?? null,
      additional_context: body.additional_context ?? null,
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
      business_name: body.business_name,
      google_place_id: body.google_place_id ?? null,
    },
    request_id: c.get('requestId'),
  });

  return c.json(
    {
      data: {
        site_id: siteId,
        slug,
        status: 'queued',
      },
    },
    201,
  );
});

export { search };
