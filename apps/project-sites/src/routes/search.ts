import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { badRequest, unauthorized } from '@project-sites/shared';
import { createServiceClient, supabaseQuery } from '../services/db.js';
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

  const db = createServiceClient(c.env);

  let query: string;

  if (placeId) {
    query = `google_place_id=eq.${placeId}&deleted_at=is.null&select=id,slug,status,current_build_version`;
  } else {
    query = `slug=eq.${slug}&deleted_at=is.null&select=id,slug,status,current_build_version`;
  }

  const result = await supabaseQuery<SiteRow[]>(db, 'sites', { query });

  if (result.error) {
    throw badRequest(`Lookup failed: ${result.error}`);
  }

  const rows = result.data ?? [];

  if (rows.length === 0) {
    return c.json({ data: { exists: false } });
  }

  const site = rows[0]!;

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

  const db = createServiceClient(c.env);

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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  const result = await supabaseQuery(db, 'sites', {
    method: 'POST',
    body: site,
  });

  if (result.error) {
    throw badRequest(`Failed to create site: ${result.error}`);
  }

  // Enqueue AI workflow
  await c.env.QUEUE.send({
    job_name: 'generate_site',
    site_id: siteId,
    business_name: body.business_name,
    google_place_id: body.google_place_id ?? null,
    additional_context: body.additional_context ?? null,
  });

  // Log audit
  await writeAuditLog(db, {
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
