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
import { badRequest, unauthorized, sanitizeHtml, stripHtml, DOMAINS } from '@project-sites/shared';
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
  nationalPhoneNumber?: string;
  websiteUri?: string;
}

interface GooglePlacesResponse {
  places?: GooglePlace[];
}

search.get('/api/search/businesses', async (c) => {
  const q = c.req.query('q');

  if (!q || q.trim().length === 0) {
    throw badRequest('Missing required query parameter: q');
  }

  // Bound query length to prevent abuse
  const boundedQ = q.trim().slice(0, 200);

  // Build request body with optional location bias from browser geolocation
  const requestBody: Record<string, unknown> = { textQuery: boundedQ };

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
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.id,places.types,places.location,places.nationalPhoneNumber,places.websiteUri',
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
    phone: place.nationalPhoneNumber ?? null,
    website: place.websiteUri ?? null,
  }));

  return c.json({ data });
});

// ─── Google Places Address Autocomplete ──────────────────────

interface AutocompleteSuggestion {
  placePrediction?: {
    placeId: string;
    text?: { text: string };
    structuredFormat?: {
      mainText?: { text: string };
      secondaryText?: { text: string };
    };
  };
}

interface AutocompleteResponse {
  suggestions?: AutocompleteSuggestion[];
}

search.get('/api/search/address', async (c) => {
  const q = c.req.query('q');

  if (!q || q.trim().length < 2) {
    return c.json({ data: [] });
  }

  // Build location bias if coordinates are provided
  const lat = c.req.query('lat');
  const lng = c.req.query('lng');
  let locationBias: Record<string, unknown> | undefined;
  if (lat && lng) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (!isNaN(latitude) && !isNaN(longitude)) {
      locationBias = {
        circle: {
          center: { latitude, longitude },
          radius: 50000.0,
        },
      };
    }
  }

  // Try Autocomplete API first (no restrictive type filter)
  const autocompleteBody: Record<string, unknown> = { input: q };
  if (locationBias) {
    autocompleteBody.locationBias = locationBias;
  }

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': c.env.GOOGLE_PLACES_API_KEY,
      },
      body: JSON.stringify(autocompleteBody),
    });

    if (response.ok) {
      const json = (await response.json()) as AutocompleteResponse;
      const suggestions = (json.suggestions ?? []).slice(0, 8);
      const data = suggestions
        .filter((s) => s.placePrediction)
        .map((s) => ({
          place_id: s.placePrediction!.placeId,
          description: s.placePrediction!.text?.text ?? '',
          main_text: s.placePrediction!.structuredFormat?.mainText?.text ?? '',
          secondary_text: s.placePrediction!.structuredFormat?.secondaryText?.text ?? '',
        }));

      if (data.length > 0) {
        return c.json({ data });
      }
    } else {
      const errorText = await response.text().catch(() => '');
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'search',
          message: 'Places Autocomplete API failed, falling back to Text Search',
          status: response.status,
          body: errorText.slice(0, 500),
          query: q,
        }),
      );
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'search',
        message: 'Places Autocomplete API exception, falling back to Text Search',
        error: String(err),
        query: q,
      }),
    );
  }

  // Fallback: use Text Search API (same API that powers business search)
  const textSearchBody: Record<string, unknown> = { textQuery: q };
  if (locationBias) {
    textSearchBody.locationBias = locationBias;
  }

  try {
    const fallbackResponse = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': c.env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.id',
      },
      body: JSON.stringify(textSearchBody),
    });

    if (!fallbackResponse.ok) {
      return c.json({ data: [] });
    }

    const fallbackJson = (await fallbackResponse.json()) as GooglePlacesResponse;
    const places = (fallbackJson.places ?? []).slice(0, 8);
    const data = places.map((place) => ({
      place_id: place.id ?? '',
      description: place.formattedAddress ?? '',
      main_text: place.displayName?.text ?? '',
      secondary_text: place.formattedAddress ?? '',
    }));

    return c.json({ data });
  } catch {
    return c.json({ data: [] });
  }
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

  // Bound query length to prevent oversized LIKE scans
  const bounded = q.trim().slice(0, 100);
  const searchTerm = `%${bounded}%`;
  const { data } = await dbQuery<SiteSearchRow>(
    c.env.DB,
    'SELECT id, slug, business_name, business_address, google_place_id, status, current_build_version FROM sites WHERE business_name LIKE ? AND deleted_at IS NULL ORDER BY CASE WHEN status = \'published\' THEN 0 WHEN status = \'building\' THEN 1 ELSE 2 END, created_at DESC LIMIT 5',
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

  // Check build limits (3 free, 50 paid)
  const { checkBuildLimit } = await import('../services/build_limits.js');
  const { dbQueryOne } = await import('../services/db.js');
  const sub = await dbQueryOne<{ plan: string }>(c.env.DB, 'SELECT plan FROM subscriptions WHERE org_id = ? AND status = \'active\'', [orgId]);
  const limitCheck = await checkBuildLimit(c.env.DB, orgId, sub?.plan ?? null);
  if (!limitCheck.allowed) {
    return c.json({
      error: {
        code: 'BUILD_LIMIT_REACHED',
        message: `You've used ${limitCheck.used} of ${limitCheck.limit} builds. ${limitCheck.limit === 3 ? 'Upgrade to a paid plan for 50 builds.' : 'Contact support for additional builds.'}`,
      },
    }, 403);
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

  const baseSlug = sanitizedName
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 63) || `site-${Date.now().toString(36)}`;

  // Ensure slug uniqueness: check D1 for existing sites with the same slug
  // and R2 for published content, then append suffix if needed
  const slug = await ensureUniqueSlug(c.env, baseSlug);

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
        businessCategory: body.business?.category ?? undefined,
        googlePlaceId: googlePlaceId ?? undefined,
        additionalContext: additionalContext ?? undefined,
        uploadId: body.upload_id ?? undefined,
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

  // Log audit — site creation
  await writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.created_from_search',
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      business_name: sanitizedName,
      slug,
      google_place_id: googlePlaceId ?? null,
      business_address: businessAddress ?? null,
      mode,
      message: 'New site created: ' + sanitizedName + ' (' + slug + DOMAINS.SITES_SUFFIX + ')',
    },
    request_id: c.get('requestId'),
  });

  // Log workflow pipeline start with detailed info
  await writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'workflow.queued',
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      business_name: sanitizedName,
      slug,
      workflow_instance_id: workflowInstanceId ?? null,
      has_additional_context: !!additionalContext,
      message: 'AI build pipeline queued — will research, generate, and deploy website',
    },
    request_id: c.get('requestId'),
  });

  // Log anticipated build phases so the Logs modal shows pipeline stages
  const buildPhases = [
    { action: 'workflow.phase.research', message: 'Phase 1: Business profile research & data collection' },
    { action: 'workflow.phase.generation', message: 'Phase 2: AI website HTML generation & content creation' },
    { action: 'workflow.phase.deployment', message: 'Phase 3: Upload to CDN & publish live site' },
  ];
  for (const phase of buildPhases) {
    await writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: phase.action,
      target_type: 'site',
      target_id: siteId,
      metadata_json: {
        slug,
        workflow_instance_id: workflowInstanceId ?? null,
        message: phase.message,
      },
      request_id: c.get('requestId'),
    }).catch(() => {});
  }

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

// ─── Improve Prompt with AI ─────────────────────────────────
search.post('/api/sites/improve-prompt', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const businessName = typeof body.business_name === 'string' ? body.business_name.trim() : '';
  const businessAddress = typeof body.business_address === 'string' ? body.business_address.trim() : '';

  if (text.length > 5000) {
    throw badRequest('Text must not exceed 5000 characters');
  }

  // Build the AI improvement prompt
  let systemPrompt: string;
  let userPrompt: string;

  if (!text) {
    // No text provided — generate a template with placeholders
    systemPrompt =
      'You are a professional website copywriter and business consultant. ' +
      'Generate a comprehensive business profile template for a small business portfolio website. ' +
      'Use placeholders in [BRACKETS] for information the business owner needs to fill in. ' +
      'Include sections for: business description, services/products offered, business hours, ' +
      'contact information (phone, email, physical address), about the owner/team, ' +
      'and any unique selling points. Make it professional and ready to customize. ' +
      'Return ONLY the template text, nothing else.';

    userPrompt = 'Generate a business profile template with placeholders for a small business website.';
    if (businessName) {
      userPrompt += '\n\nBusiness name: ' + businessName;
    }
    if (businessAddress) {
      userPrompt += '\nBusiness address: ' + businessAddress;
    }
  } else {
    systemPrompt =
      'You are a professional website copywriter and business consultant. ' +
      'Your job is to take rough notes about a business and improve them into clear, well-structured ' +
      'information that would help an AI build a great website. ' +
      'Fix grammar, spelling, and formatting. Organize the information logically. ' +
      'Where information seems missing or incomplete, insert placeholders in [BRACKETS] and ' +
      'add a brief comment about what should go there. ' +
      'Keep the same general meaning but make it professional and comprehensive. ' +
      'Return ONLY the improved text, nothing else.';

    userPrompt = 'Here is the rough text to improve:\n\n' + text;
    if (businessName) {
      userPrompt += '\n\nBusiness name: ' + businessName;
    }
    if (businessAddress) {
      userPrompt += '\nBusiness address: ' + businessAddress;
    }
  }

  try {
    const ai = c.env.AI;
    if (!ai) {
      // Fallback: return a static template if AI binding not available
      const fallbackText = text || (
        (businessName ? businessName + ' — ' : '[Business Name] — ') +
        'Welcome to our business!\n\n' +
        '[Brief description of what your business does]\n\n' +
        'Services:\n- [Service 1]\n- [Service 2]\n- [Service 3]\n\n' +
        'Hours: [Mon-Fri 9AM-5PM]\n' +
        'Phone: [Your phone number]\n' +
        'Email: [Your email address]\n' +
        'Address: ' + (businessAddress || '[Your business address]')
      );
      return c.json({ data: { improved_text: fallbackText } });
    }

    const result = await ai.run('@cf/meta/llama-3.1-8b-instruct' as Parameters<typeof ai.run>[0], {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    });

    const improved =
      typeof result === 'object' && result !== null && 'response' in result
        ? String((result as { response: string }).response).trim()
        : text;

    return c.json({ data: { improved_text: improved || text } });
  } catch {
    // On AI failure, return original text rather than error
    return c.json({ data: { improved_text: text } });
  }
});

// ─── Generate Expert Prompt (OpenAI Research → bolt.diy Prompt) ──

search.post('/api/sites/generate-prompt', async (c) => {
  const userId = c.get('userId');
  const orgId = c.get('orgId');

  if (!userId || !orgId) {
    throw unauthorized('Authentication required');
  }

  const body = await c.req.json().catch(() => ({}));
  const businessName = typeof body.business_name === 'string' ? body.business_name.trim() : '';
  const businessAddress = typeof body.business_address === 'string' ? body.business_address.trim() : '';
  const businessPhone = typeof body.business_phone === 'string' ? body.business_phone.trim() : '';
  const googlePlaceId = typeof body.google_place_id === 'string' ? body.google_place_id.trim() : '';
  const additionalContext = typeof body.additional_context === 'string' ? body.additional_context.trim() : '';
  const siteId = typeof body.site_id === 'string' ? body.site_id.trim() : '';

  if (!businessName) {
    throw badRequest('business_name is required');
  }

  if (!c.env.OPENAI_API_KEY) {
    throw badRequest('OpenAI API key is not configured. Cannot run research pipeline.');
  }

  const { researchAndFormulatePrompt } = await import('../services/openai_research.js');

  const result = await researchAndFormulatePrompt(c.env, {
    businessName,
    businessAddress: businessAddress || undefined,
    businessPhone: businessPhone || undefined,
    googlePlaceId: googlePlaceId || undefined,
    additionalContext: additionalContext || undefined,
  });

  // If a site ID was provided, store the research data in R2
  if (siteId) {
    const site = await dbQueryOne<{ slug: string; current_build_version: string | null }>(
      c.env.DB,
      'SELECT slug, current_build_version FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
      [siteId, orgId],
    );

    if (site) {
      const version = site.current_build_version || new Date().toISOString().replace(/[:.]/g, '-');
      await c.env.SITES_BUCKET.put(
        `sites/${site.slug}/${version}/research.json`,
        JSON.stringify({ profile: result.profile, brand: result.brand, sellingPoints: result.sellingPoints, social: result.social }, null, 2),
        { httpMetadata: { contentType: 'application/json' } },
      );
    }
  }

  // Audit log
  await writeAuditLog(c.env.DB, {
    org_id: orgId,
    user_id: userId,
    action: 'research.generate_prompt',
    resource_type: 'site',
    resource_id: siteId || null,
    metadata: { business_name: businessName, model: c.env.RESEARCH_MODEL || 'o3-mini' },
  }).catch(() => { /* best-effort */ });

  return c.json({
    data: {
      prompt: result.expertPrompt,
      research: {
        profile: result.profile,
        brand: result.brand,
        sellingPoints: result.sellingPoints,
        social: result.social,
      },
    },
  });
});

// ─── Slug Uniqueness Helper ──────────────────────────────────

/**
 * Ensure the slug is unique by checking both D1 (sites table) and R2.
 * Appends incrementing suffix (-2, -3, ...) if already taken.
 * Falls back to random suffix after 10 attempts.
 */
async function ensureUniqueSlug(env: Env, slug: string): Promise<string> {
  let candidate = slug;

  for (let attempt = 0; attempt < 10; attempt++) {
    // Check D1 for existing site with this slug (include deleted — unique constraint spans all rows)
    const existingInDb = await dbQueryOne<{ id: string }>(
      env.DB,
      'SELECT id FROM sites WHERE slug = ?',
      [candidate],
    );

    if (!existingInDb) {
      // Also check R2 for orphaned content
      const manifestInR2 = await env.SITES_BUCKET.get(`sites/${candidate}/_manifest.json`);
      if (!manifestInR2) {
        return candidate;
      }
    }

    candidate = `${slug}-${attempt + 2}`;
  }

  // All attempts exhausted — use random suffix
  return `${slug}-${Date.now().toString(36).slice(-4)}`;
}

/**
 * AI-powered business categorization.
 * Uses Workers AI to classify a business into one of the predefined categories.
 */
search.post('/api/ai/categorize', async (c) => {
  const body = await c.req.json() as { name: string; address?: string; types?: string[] };
  if (!body.name) {
    return c.json({ data: { category: '' } });
  }

  const categories = [
    'Restaurant / Café', 'Salon / Barbershop', 'Legal / Law Firm',
    'Medical / Healthcare', 'Retail / Shop', 'Technology / SaaS',
    'Construction / Home Services', 'Fitness / Gym', 'Real Estate',
    'Photography / Creative', 'Automotive', 'Education / Tutoring',
    'Financial / Accounting', 'Other',
  ];

  try {
    const prompt = `Classify this business into exactly one category. Respond with ONLY the category name, nothing else.

Business: "${body.name}"${body.address ? ` at ${body.address}` : ''}${body.types?.length ? ` (types: ${body.types.join(', ')})` : ''}

Categories: ${categories.join(', ')}

Category:`;

    const result = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 30,
      temperature: 0,
    }) as { response?: string };

    const raw = (result.response || '').trim();
    // Find the best matching category from the response
    const matched = categories.find((cat) => raw.includes(cat)) ||
      categories.find((cat) => raw.toLowerCase().includes(cat.toLowerCase().split(' / ')[0])) ||
      '';

    return c.json({ data: { category: matched } });
  } catch (err) {
    console.warn('[ai/categorize] AI call failed:', err);
    return c.json({ data: { category: '' } });
  }
});

/**
 * Contact form handler — receives form submissions from generated sites
 * and forwards them via SendGrid/Resend to the business email.
 */
search.post('/api/contact-form/:slug', async (c) => {
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => ({})) as {
    name?: string; email?: string; phone?: string; message?: string;
  };

  if (!body.name || !body.email || !body.message) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Name, email, and message are required' } }, 400);
  }

  try {
    const { dbQueryOne } = await import('../services/db.js');
    const site = await dbQueryOne<{ id: string; business_name: string; contact_email?: string }>(
      c.env.DB,
      'SELECT id, business_name, contact_email FROM sites WHERE slug = ? AND deleted_at IS NULL',
      [slug],
    );
    if (!site) return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);

    const toEmail = site.contact_email || '';
    if (!toEmail) return c.json({ error: { code: 'CONFIG_ERROR', message: 'No contact email configured' } }, 400);

    const htmlBody = `<h2>New Contact Form Submission</h2><p><strong>From:</strong> ${body.name} (${body.email})</p>${body.phone ? `<p><strong>Phone:</strong> ${body.phone}</p>` : ''}<p><strong>Message:</strong></p><p>${body.message.replace(/\n/g, '<br>')}</p><hr><p style="color:#888;font-size:12px;">Sent via ${site.business_name} on projectsites.dev</p>`;

    if (c.env.SENDGRID_API_KEY) {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${c.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: toEmail }] }],
          from: { email: 'noreply@megabyte.space', name: `${site.business_name} Website` },
          reply_to: { email: body.email, name: body.name },
          subject: `New message from ${body.name} via your website`,
          content: [{ type: 'text/html', value: htmlBody }],
        }),
      });
    } else if (c.env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${c.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${site.business_name} <noreply@megabyte.space>`,
          to: [toEmail],
          reply_to: body.email,
          subject: `New message from ${body.name} via your website`,
          html: htmlBody,
        }),
      });
    }

    return c.json({ data: { success: true } });
  } catch (err) {
    console.warn('[contact-form] Error:', err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to send' } }, 500);
  }
});

/**
 * Site preview — serves the site's index.html from R2 directly.
 * Used by the admin panel to show site previews without triggering CF challenges.
 */
search.get('/api/sites/:slug/preview', async (c) => {
  const slug = c.req.param('slug');
  if (!slug) return c.text('Missing slug', 400);

  try {
    // Read manifest to find current version
    const manifest = await c.env.SITES_BUCKET.get(`sites/${slug}/_manifest.json`);
    if (!manifest) {
      return c.text('Site not found', 404);
    }
    const manifestData = await manifest.json() as { current_version?: string };
    const version = manifestData.current_version;
    if (!version) return c.text('No published version', 404);

    // Serve index.html from R2
    const html = await c.env.SITES_BUCKET.get(`sites/${slug}/${version}/index.html`);
    if (!html) return c.text('HTML not found', 404);

    let content = await html.text();
    // Inject base tag so relative URLs resolve correctly
    content = content.replace('<head>', `<head><base href="https://${slug}.${DOMAINS.SITES_SUFFIX}/">`);

    return new Response(content, {
      headers: {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
        'X-Frame-Options': 'ALLOWALL',
      },
    });
  } catch {
    return c.text('Preview error', 500);
  }
});

const TRANSPARENT_PIXEL = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
  0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x62, 0x00, 0x00, 0x00, 0x02,
  0x00, 0x01, 0xE5, 0x27, 0xDE, 0xFC, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
]);

/**
 * Image proxy — fetches external images and serves with CORS headers.
 * All discovered images route through this so the frontend can display them
 * without CORS issues, and we can later download them for site generation.
 */
search.get('/api/image-proxy', async (c) => {
  const imageUrl = c.req.query('url');
  if (!imageUrl) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing url parameter' } }, 400);
  }

  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ProjectSites/1.0; +https://projectsites.dev)',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': imageUrl,
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      // Return 1x1 transparent PNG instead of 502 so the img element doesn't break
      return new Response(TRANSPARENT_PIXEL, {
        headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*', 'X-Proxy-Status': 'failed' },
      });
    }

    const ct = res.headers.get('content-type') || 'image/png';
    // Validate it's actually an image
    if (!ct.startsWith('image/') && !ct.includes('octet-stream')) {
      return new Response(TRANSPARENT_PIXEL, {
        headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*', 'X-Proxy-Status': 'not-image' },
      });
    }

    const body = await res.arrayBuffer();
    // Reject tiny responses (likely error pages, 1x1 tracking pixels, or loading placeholders)
    if (body.byteLength < 500) {
      return new Response(TRANSPARENT_PIXEL, {
        headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*', 'X-Proxy-Status': 'too-small' },
      });
    }

    return new Response(body, {
      headers: {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
        'X-Proxy-Status': 'ok',
      },
    });
  } catch {
    return new Response(TRANSPARENT_PIXEL, {
      headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*', 'X-Proxy-Status': 'error' },
    });
  }
});

/** Validate that a URL points to a real, loadable image (HEAD check) */
async function isImageReachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProjectSites/1.0)' },
      redirect: 'follow',
    });
    const ct = r.headers.get('content-type') || '';
    return r.ok && (ct.startsWith('image/') || ct.includes('octet-stream'));
  } catch {
    return false;
  }
}

/**
 * AI image discovery — finds logo, favicon, and images for a business.
 * All URLs are proxied through /api/image-proxy for CORS safety.
 */
search.post('/api/ai/discover-images', async (c) => {
  const body = await c.req.json() as { name: string; address?: string; website?: string };
  if (!body.name) {
    return c.json({ data: { logo: null, favicon: null, images: [] } });
  }

  const website = body.website || '';
  let domain = '';
  try {
    if (website) domain = new URL(website.startsWith('http') ? website : `https://${website}`).hostname;
  } catch { /* ignore */ }

  const baseProxy = `https://${DOMAINS.SITES_BASE}/api/image-proxy?url=`;
  const proxy = (url: string) => `${baseProxy}${encodeURIComponent(url)}`;

  // Logo: scrape the website's og:image or apple-touch-icon (best logo source)
  let logo = null;
  if (domain) {
    try {
      const siteRes = await fetch(`https://${domain}`, {
        headers: { 'User-Agent': 'ProjectSites/1.0 (https://projectsites.dev)' },
        redirect: 'follow',
      });
      if (siteRes.ok) {
        const html = await siteRes.text();
        // Try og:image first (usually highest quality brand image)
        const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        // Try apple-touch-icon (usually the logo at 180px+)
        const appleMatch = html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i);
        // Try any large favicon
        const iconMatch = html.match(/<link[^>]+rel=["']icon["'][^>]+sizes=["'](\d+)x\d+["'][^>]+href=["']([^"']+)["']/i);

        let logoUrl = '';
        if (ogMatch?.[1]) {
          logoUrl = ogMatch[1];
        } else if (appleMatch?.[1]) {
          logoUrl = appleMatch[1];
        } else if (iconMatch && parseInt(iconMatch[1]) >= 96) {
          logoUrl = iconMatch[2];
        }

        if (logoUrl) {
          // Resolve relative URLs
          if (logoUrl.startsWith('/')) logoUrl = `https://${domain}${logoUrl}`;
          else if (!logoUrl.startsWith('http')) logoUrl = `https://${domain}/${logoUrl}`;
          logo = {
            url: proxy(logoUrl),
            name: `${domain}-logo.png`,
            type: 'logo',
            source: 'website-scrape',
          };
        }
      }
    } catch {
      // Scraping failed — will fall back below
    }

    // Fallback: use Google's faviconV2 at max resolution as the logo
    if (!logo) {
      logo = {
        url: proxy(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=256`),
        name: `${domain}-logo.png`,
        type: 'logo',
        source: 'google-favicon',
      };
    }
  }

  // Favicon: try apple-touch-icon / large icon from the site first (for 512px+), then Google faviconV2
  let favicon = null;
  if (domain) {
    try {
      const siteRes = logo ? null : await fetch(`https://${domain}`, {
        headers: { 'User-Agent': 'ProjectSites/1.0' },
        redirect: 'follow',
      }).catch(() => null);
      // Reuse HTML from logo scrape if available, otherwise fetch
      let html = '';
      if (!siteRes) {
        // Logo scrape already ran — re-fetch just for favicon extraction
        const r = await fetch(`https://${domain}`, {
          headers: { 'User-Agent': 'ProjectSites/1.0' },
          redirect: 'follow',
        }).catch(() => null);
        if (r?.ok) html = await r.text();
      }

      if (html) {
        // Look for large icons: 512px, 384px, 256px, 192px apple-touch-icon
        const largeIconMatch = html.match(/<link[^>]+rel=["'](?:apple-touch-icon|icon)["'][^>]+sizes=["'](\d+)x\d+["'][^>]+href=["']([^"']+)["']/gi);
        let bestUrl = '';
        let bestSize = 0;
        if (largeIconMatch) {
          for (const tag of largeIconMatch) {
            const sizeM = tag.match(/sizes=["'](\d+)/i);
            const hrefM = tag.match(/href=["']([^"']+)["']/i);
            if (sizeM && hrefM) {
              const s = parseInt(sizeM[1]);
              if (s > bestSize) { bestSize = s; bestUrl = hrefM[1]; }
            }
          }
        }
        // Also try apple-touch-icon without sizes (usually 180px)
        if (!bestUrl || bestSize < 180) {
          const appleM = html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i);
          if (appleM?.[1] && bestSize < 180) { bestUrl = appleM[1]; bestSize = 180; }
        }

        if (bestUrl) {
          if (bestUrl.startsWith('/')) bestUrl = `https://${domain}${bestUrl}`;
          else if (!bestUrl.startsWith('http')) bestUrl = `https://${domain}/${bestUrl}`;
          favicon = {
            url: proxy(bestUrl),
            name: `${domain}-favicon.png`,
            type: 'favicon',
            source: 'website-scrape',
          };
        }
      }
    } catch { /* fall through to Google */ }

    // Fallback: Google faviconV2 at 256px
    if (!favicon) {
      favicon = {
        url: proxy(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=256`),
        name: `${domain}-favicon.png`,
        type: 'favicon',
        source: 'google-favicon',
      };
    }
  }

  // Images: use AI to determine the best search queries, then Google Custom Search
  const images: { url: string; name: string; type: string; source: string }[] = [];
  const cseKey = c.env.GOOGLE_CSE_KEY;
  const cseCx = c.env.GOOGLE_CSE_CX;

  if (cseKey && cseCx) {
    try {
      const bizName = body.name;
      const slug = bizName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      // Blocklist: stock photo sites with watermarks
      const blocked = /shutterstock|gettyimages|istockphoto|alamy|dreamstime|123rf|depositphotos|stock\.adobe|loopnet|zillow/i;

      // Build location context for disambiguation
      const addr = body.address || '';
      const city = addr.split(',').slice(1, 2).join('').trim();
      const locationCtx = city ? ` ${city}` : '';

      // Focused queries — include location to disambiguate, prefer official sources
      const queries = [
        `"${bizName}"${locationCtx} official photo -watermark -stock -getty -shutterstock -hotel`,
        `"${bizName}"${locationCtx} site:wikipedia.org OR site:flickr.com OR site:commons.wikimedia.org`,
        `"${bizName}"${locationCtx} building exterior -editorial -stock -hotel -resort`,
        `"${bizName}"${locationCtx} interior -watermark -stock -hotel`,
        `"${bizName}"${locationCtx} -stock -editorial -hotel -"for sale"`,
      ];

      // Search and filter
      const allCandidates: { url: string; title: string }[] = [];
      const searchPromises = queries.map(async (q) => {
        try {
          const cseUrl = `https://www.googleapis.com/customsearch/v1?key=${cseKey}&cx=${cseCx}&q=${encodeURIComponent(q)}&searchType=image&num=4&imgSize=xlarge&imgType=photo&safe=active`;
          const cseRes = await fetch(cseUrl);
          if (cseRes.ok) {
            const cseData = await cseRes.json() as { items?: { link: string; title: string; displayLink?: string; image?: { width?: number; height?: number } }[] };
            for (const item of (cseData.items || [])) {
              if (blocked.test(item.displayLink || '') || blocked.test(item.link)) continue;
              if (/watermark|preview|thumb|editorial|icon|logo|badge/i.test(item.link)) continue;
              // Skip tiny images (< 400px in either dimension)
              const imgW = item.image?.width || 0;
              const imgH = item.image?.height || 0;
              if (imgW > 0 && imgW < 400) continue;
              if (imgH > 0 && imgH < 400) continue;
              allCandidates.push({ url: item.link, title: item.title || '' });
            }
          }
        } catch { /* skip */ }
      });
      await Promise.all(searchPromises);

      // Deduplicate
      const seen = new Set<string>();
      const unique = allCandidates.filter(c => { if (seen.has(c.url)) return false; seen.add(c.url); return true; });

      // Validate reachability + minimum size
      const validated: typeof unique = [];
      await Promise.all(unique.slice(0, 20).map(async (c) => {
        try {
          const r = await fetch(c.url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProjectSites/1.0)' }, redirect: 'follow' });
          const ct = r.headers.get('content-type') || '';
          const cl = parseInt(r.headers.get('content-length') || '0');
          if (r.ok && ct.startsWith('image/') && (cl === 0 || cl > 20000)) validated.push(c);
        } catch { /* skip */ }
      }));

      for (let i = 0; i < Math.min(validated.length, 14); i++) {
        images.push({ url: proxy(validated[i].url), name: `${slug}-${i + 1}.jpg`, type: 'image', source: 'google-cse' });
      }
    } catch (err) {
      console.warn('[discover-images] CSE search failed:', err);
    }
  }

  // Validate logo and favicon are actually reachable images
  if (logo) {
    // Extract the original URL from the proxy URL
    const logoOriginal = decodeURIComponent(logo.url.split('url=')[1] || '');
    if (logoOriginal && !(await isImageReachable(logoOriginal))) {
      logo = null;
    }
  }
  if (favicon) {
    const favOriginal = decodeURIComponent(favicon.url.split('url=')[1] || '');
    if (favOriginal && !(await isImageReachable(favOriginal))) {
      favicon = null;
    }
  }

  return c.json({ data: { logo, favicon, images } });
});

/**
 * AI image edit — generates a new image from a text prompt using OpenAI DALL-E 3.
 * Returns a proxied URL to the generated image.
 */
search.post('/api/ai/edit-image', async (c) => {
  const body = await c.req.json() as { prompt: string; originalUrl?: string };
  if (!body.prompt?.trim()) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Prompt is required' } }, 400);
  }

  const openaiKey = c.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return c.json({ error: { code: 'CONFIG_ERROR', message: 'OpenAI API key not configured' } }, 500);
  }

  try {
    // If original image URL provided, first describe it with GPT-4o Vision, then edit
    let editPrompt = body.prompt;
    if (body.originalUrl) {
      try {
        const descRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'user', content: [
                { type: 'text', text: 'Describe this image in detail — subject, colors, composition, style, setting. Be specific.' },
                { type: 'image_url', image_url: { url: body.originalUrl } },
              ] },
            ],
            max_tokens: 300,
          }),
        });
        if (descRes.ok) {
          const descData = await descRes.json() as { choices: { message: { content: string } }[] };
          const description = descData.choices?.[0]?.message?.content || '';
          if (description) {
            editPrompt = `Starting from this image: ${description}\n\nNow apply this edit: ${body.prompt}\n\nGenerate the modified version of this same image with the edit applied.`;
          }
        }
      } catch { /* fall through to raw prompt */ }
    }

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: editPrompt,
        n: 1,
        size: '1024x1024',
        response_format: 'url',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn('[edit-image] DALL-E error:', err);
      return c.json({ error: { code: 'AI_ERROR', message: 'Image generation failed' } }, 502);
    }

    const data = await res.json() as { data?: { url: string }[] };
    const imageUrl = data.data?.[0]?.url;
    if (!imageUrl) {
      return c.json({ error: { code: 'AI_ERROR', message: 'No image returned' } }, 502);
    }

    // Proxy the generated image through our endpoint for CORS
    const baseProxy = `https://${DOMAINS.SITES_BASE}/api/image-proxy?url=`;
    return c.json({
      data: {
        url: `${baseProxy}${encodeURIComponent(imageUrl)}`,
        prompt: body.prompt,
      },
    });
  } catch (err) {
    console.warn('[edit-image] Error:', err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Image generation failed' } }, 500);
  }
});

// ── Domain Availability (public, for conversion flow) ──────────────
search.get('/api/domains/availability', async (c) => {
  const name = c.req.query('name')?.trim().replace(/[^a-z0-9-]/gi, '').toLowerCase();
  if (!name || name.length < 2) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Name must be at least 2 characters' } }, 400);
  }

  const apiKey = c.env.WHOISXML_API_KEY;

  // Strip TLD if provided, keep the base name
  const baseName = name.replace(/\.[a-z]+$/i, '');
  // Check exact name across popular TLDs + creative variations likely to be available
  const exactTlds = ['com', 'net', 'io', 'co', 'dev', 'site'];
  const variations = [
    ...exactTlds.map((tld) => `${baseName}.${tld}`),
    `get${baseName}.com`,
    `my${baseName}.com`,
    `${baseName}hq.com`,
    `the${baseName}.com`,
    `${baseName}.app`,
    `${baseName}.org`,
  ];
  // Deduplicate
  const domains = [...new Set(variations)];

  /**
   * RDAP fallback for domain availability checks.
   * Verisign (.com/.net) is queried directly; others go through rdap.org bootstrap.
   * RDAP returns 404 for unregistered domains and 200 for registered ones.
   * Used when WhoisXML credits are exhausted or API key is missing.
   */
  const rdapServers: Record<string, string> = {
    com: 'https://rdap.verisign.com/com/v1/domain',
    net: 'https://rdap.verisign.com/net/v1/domain',
  };

  async function checkViaRdap(domain: string): Promise<{ domain: string; available: boolean }> {
    try {
      const tld = domain.split('.').pop() || '';
      const server = rdapServers[tld];
      const url = server ? `${server}/${domain}` : `https://rdap.org/domain/${domain}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const rdapRes = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { Accept: 'application/rdap+json' },
      });
      clearTimeout(timeoutId);
      // 404 = not registered = available; 200 = registered = unavailable
      const available = rdapRes.status === 404;
      return { domain, available };
    } catch (err) {
      // Network error or timeout — conservatively mark as unknown/unavailable
      console.warn(`[domain-availability] RDAP check failed for ${domain}:`, err);
      return { domain, available: false };
    }
  }

  // Check all TLDs in parallel via WhoisXML (with RDAP fallback)
  const results = await Promise.allSettled(
    domains.map(async (domain) => {
      // Check KV cache first (5 min TTL)
      const cacheKey = `domavail:${domain}`;
      const cached = await c.env.CACHE_KV.get(cacheKey);
      if (cached !== null) {
        return { domain, available: cached === '1' };
      }

      // If no API key, go straight to RDAP fallback
      if (!apiKey) {
        const result = await checkViaRdap(domain);
        await c.env.CACHE_KV.put(cacheKey, result.available ? '1' : '0', { expirationTtl: 300 }).catch(() => {});
        return result;
      }

      const res = await fetch(
        `https://domain-availability.whoisxmlapi.com/api/v1?apiKey=${apiKey}&domainName=${encodeURIComponent(domain)}&credits=DA`,
      );

      // Parse body regardless of status — WhoisXML may return 200 with error body
      const data = (await res.json().catch(() => ({}))) as {
        DomainInfo?: { domainAvailability?: string };
        code?: number;
        messages?: string;
      };

      // Fall back to RDAP if: non-OK status, error code in body, or credits exhausted message
      const isApiError =
        !res.ok ||
        (typeof data.code === 'number' && data.code >= 400) ||
        (typeof data.messages === 'string' && data.messages.toLowerCase().includes('credit'));

      if (isApiError || !data.DomainInfo) {
        console.warn(
          `[domain-availability] WhoisXML failed for ${domain} (status=${res.status}, code=${data.code}, msg=${data.messages}), using RDAP fallback`,
        );
        const result = await checkViaRdap(domain);
        await c.env.CACHE_KV.put(cacheKey, result.available ? '1' : '0', { expirationTtl: 300 }).catch(() => {});
        return result;
      }

      const available = data.DomainInfo.domainAvailability === 'AVAILABLE';

      // Cache for 5 minutes
      await c.env.CACHE_KV.put(cacheKey, available ? '1' : '0', { expirationTtl: 300 }).catch(() => {});

      return { domain, available };
    }),
  );

  const data = results
    .filter((r): r is PromiseFulfilledResult<{ domain: string; available: boolean }> => r.status === 'fulfilled')
    .map((r) => r.value);

  return c.json({ data });
});

// ── Conversion Checkout (public, creates Stripe session) ───────────
search.post('/api/conversion/checkout', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    slug?: string;
    domain?: string;
    email?: string;
  };

  if (!body.slug) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing slug' } }, 400);
  }

  const { dbQueryOne } = await import('../services/db.js');
  const site = await dbQueryOne<{ id: string; slug: string; org_id: string; business_name: string }>(
    c.env.DB,
    'SELECT id, slug, org_id, business_name FROM sites WHERE slug = ? AND deleted_at IS NULL',
    [body.slug],
  );
  if (!site) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }

  try {
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][recurring][interval]', 'month');
    params.set('line_items[0][price_data][unit_amount]', '5000');
    params.set('line_items[0][price_data][product_data][name]', `${site.business_name} Website — Pro Plan`);
    params.set('line_items[0][price_data][product_data][description]', `Custom domain, AI editing, analytics, priority support`);
    params.set('line_items[0][quantity]', '1');
    params.set('metadata[site_id]', site.id);
    params.set('metadata[slug]', site.slug);
    params.set('metadata[org_id]', site.org_id);
    params.set('metadata[domain]', body.domain || '');
    params.set('metadata[source]', 'conversion-flow');
    params.set('success_url', `https://${site.slug}.${DOMAINS.SITES_SUFFIX}/?upgraded=1`);
    params.set('cancel_url', `https://${site.slug}.${DOMAINS.SITES_SUFFIX}/`);
    if (body.email) params.set('customer_email', body.email);

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!stripeRes.ok) {
      const errText = await stripeRes.text();
      console.warn('[conversion-checkout] Stripe error:', errText);
      return c.json({ error: { code: 'STRIPE_ERROR', message: 'Checkout creation failed' } }, 500);
    }

    const session = (await stripeRes.json()) as { url: string };
    return c.json({ data: { checkout_url: session.url } });
  } catch (err) {
    console.warn('[conversion-checkout] Error:', err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Checkout creation failed' } }, 500);
  }
});

export { search };
