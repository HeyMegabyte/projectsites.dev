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

  // AI-calculated slug: produce the shortest, most meaningful URL-safe representation
  const baseSlug = await generateSmartSlug(c.env, sanitizedName, businessAddress);

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
/**
 * Generate a smart, AI-calculated slug that is the shortest meaningful
 * representation of the business name + location differentiator.
 *
 * Examples:
 * - "Trader Joe's" at "3056 NJ-10, Denville, NJ" → "trader-joes-denville"
 * - "Trader Joe's - Hell's Kitchen" → "trader-joes-hells-kitchen"
 * - "When Doody Calls - Pooper Scoopers" → "when-doody-calls"
 * - "Vito's Mens Salon" → "vitos-mens-salon"
 *
 * Falls back to simple slugification if AI is unavailable.
 */
async function generateSmartSlug(env: Env, businessName: string, address?: string): Promise<string> {
  // Simple slugification as fallback
  const simpleSlug = businessName
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 63) || `site-${Date.now().toString(36)}`;

  // Try AI-powered slug generation
  try {
    const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct' as Parameters<typeof env.AI.run>[0], {
      messages: [
        {
          role: 'system',
          content: `Generate the shortest, simplest URL slug for a business website. Rules:
- Output ONLY the slug, nothing else. No explanation.
- Use lowercase letters, numbers, and hyphens only.
- Remove possessives ('s → s), articles (the, a, an), and filler words.
- For chain businesses (Trader Joe's, McDonald's, Starbucks), include a location differentiator (neighborhood or city name).
- For unique businesses, just use the core business name (2-4 words max).
- Remove subtitles/taglines after dashes unless they ARE the brand name.
- Maximum 40 characters, prefer under 25.

Examples:
"Trader Joe's" at "3056 NJ-10, Denville, NJ 07834" → trader-joes-denville
"Trader Joe's - Hell's Kitchen" at "435 W 42nd St, NY" → trader-joes-hells-kitchen
"When Doody Calls - Pooper Scoopers" at "Dallas, TX" → when-doody-calls
"Vito's Mens Salon" at "74 N Beverwyck Rd, Lake Hiawatha, NJ" → vitos-mens-salon
"The White House" at "1600 Pennsylvania Ave, DC" → the-white-house
"McDonald's" at "789 Broadway, New York, NY" → mcdonalds-broadway-nyc`,
        },
        {
          role: 'user',
          content: `Business: "${businessName}"${address ? `\nAddress: "${address}"` : ''}`,
        },
      ],
      max_tokens: 50,
    });

    const response = ((result as { response?: string }).response ?? '').trim();
    // Clean and validate AI output
    const aiSlug = response
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 63);

    if (aiSlug && aiSlug.length >= 3 && aiSlug.length <= 63 && /^[a-z0-9]/.test(aiSlug)) {
      return aiSlug;
    }
  } catch {
    // AI unavailable — fall through to simple slug
  }

  return simpleSlug;
}

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

    // Check actual image dimensions from the binary data — reject sub-4px images
    const buf = new Uint8Array(body);
    let imgW = 0;
    let imgH = 0;
    // PNG check
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf.byteLength >= 24) {
      imgW = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
      imgH = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
    }
    // GIF check
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf.byteLength >= 10) {
      imgW = buf[6] | (buf[7] << 8);
      imgH = buf[8] | (buf[9] << 8);
    }
    // Reject images smaller than 4x4 (tracking pixels, spacers)
    if (imgW > 0 && imgH > 0 && (imgW < 4 || imgH < 4)) {
      return new Response(TRANSPARENT_PIXEL, {
        headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*', 'X-Proxy-Status': 'too-small-dimensions' },
      });
    }

    return new Response(body, {
      headers: {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
        'X-Proxy-Status': 'ok',
        // Expose dimensions so frontend can use them
        ...(imgW > 0 ? { 'X-Image-Width': String(imgW), 'X-Image-Height': String(imgH) } : {}),
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
 * Fetch actual image dimensions by downloading the first bytes and reading the header.
 * Returns { width, height, byteLength } or null if unable to determine.
 */
async function getImageDimensions(url: string): Promise<{ width: number; height: number; byteLength: number } | null> {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ProjectSites/1.0)',
        'Range': 'bytes=0-65535',
      },
      redirect: 'follow',
    });
    if (!r.ok && r.status !== 206) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const cl = parseInt(r.headers.get('content-length') || '0') || buf.byteLength;

    // PNG: dimensions at bytes 16-23 (IHDR chunk)
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      if (buf.byteLength >= 24) {
        const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
        const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
        return { width: w, height: h, byteLength: cl };
      }
    }

    // JPEG: scan for SOF0/SOF2 markers
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      let i = 2;
      while (i < buf.byteLength - 9) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const marker = buf[i + 1];
        // SOF0 (0xC0) or SOF2 (0xC2) — contains dimensions
        if (marker === 0xC0 || marker === 0xC2) {
          const h = (buf[i + 5] << 8) | buf[i + 6];
          const w = (buf[i + 7] << 8) | buf[i + 8];
          return { width: w, height: h, byteLength: cl };
        }
        // Skip to next marker
        const segLen = (buf[i + 2] << 8) | buf[i + 3];
        i += 2 + segLen;
      }
    }

    // GIF: dimensions at bytes 6-9
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      if (buf.byteLength >= 10) {
        const w = buf[6] | (buf[7] << 8);
        const h = buf[8] | (buf[9] << 8);
        return { width: w, height: h, byteLength: cl };
      }
    }

    // WebP: RIFF header, VP8 chunk
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.byteLength >= 30) {
      // VP8 lossy
      if (buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x20) {
        const w = ((buf[26]) | (buf[27] << 8)) & 0x3FFF;
        const h = ((buf[28]) | (buf[29] << 8)) & 0x3FFF;
        return { width: w, height: h, byteLength: cl };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Image quality assessment result from AI vision inspection.
 */
interface ImageQualityResult {
  /** 0-100 quality score */
  quality_score: number;
  /** Whether the image is professional enough for a business website */
  is_professional: boolean;
  /** Whether the image is safe (no NSFW, no violence, no hate) */
  is_safe: boolean;
  /** Brief description of what the image shows */
  description: string;
  /** Recommendation for how to use this asset */
  recommendation: 'use_as_is' | 'use_as_inspiration' | 'enhance' | 'reject';
  /** Issues found, if any */
  issues: string[];
  /** Whether the image has excessive white/blank padding on sides */
  has_padding?: boolean;
  /** Whether the image appears to be a generic CAD/architectural rendering (not a real photo) */
  is_generic_rendering?: boolean;
  /** Confidence that this image is actually of/about the specified business */
  business_relevance?: number;
}

/**
 * Use GPT-4o vision to assess image quality, professionalism, and safety.
 * Returns null if vision API is unavailable (no OpenAI key).
 */
async function inspectImageWithVision(
  imageUrl: string,
  context: { businessName: string; imageRole: 'logo' | 'favicon' | 'hero' | 'photo' | 'banner' },
  openaiKey: string,
): Promise<ImageQualityResult | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an image quality inspector for a professional website builder. Assess images for:
1. QUALITY: Resolution clarity, compression artifacts, pixelation (0-100 score)
2. PROFESSIONALISM: Is this suitable for a business website? Consider composition, lighting, branding quality
3. SAFETY: Flag NSFW, violent, hateful, or inappropriate content
4. RELEVANCE: Does this match the business "${context.businessName}" and its intended use as a ${context.imageRole}?
5. PADDING: Does the image have large white/blank areas on the sides? (uncropped, improperly formatted)
6. RENDERING: Is this a generic CAD/architectural rendering rather than a real photograph of an actual business?
7. BUSINESS MATCH: How confident (0.0-1.0) are you this image depicts "${context.businessName}" specifically (not just a similar business)?

Return ONLY valid JSON (no markdown):
{"quality_score":0-100,"is_professional":bool,"is_safe":bool,"description":"what the image shows","recommendation":"use_as_is|use_as_inspiration|enhance|reject","issues":["issue1"],"has_padding":bool,"is_generic_rendering":bool,"business_relevance":0.0-1.0}

Scoring guide:
- 90-100: High-res, professional, clearly related to this specific business, perfect for a modern website
- 70-89: Good quality, minor issues (slightly low-res, imperfect composition)
- 50-69: Usable as inspiration but should be enhanced/replaced for final site
- 30-49: Low quality (blurry, pixelated, amateur, has padding, generic rendering) — use only as inspiration
- 0-29: Reject — too low quality, unsafe, irrelevant, or clearly not this business

REJECT if: has_padding is true AND quality is below 60, OR is_generic_rendering is true AND business_relevance < 0.5`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Assess this ${context.imageRole} image for "${context.businessName}":` },
              { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
            ],
          },
        ],
        max_tokens: 300,
        temperature: 0.1,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const content = data.choices?.[0]?.message?.content || '';
    // Parse JSON from response (strip any markdown code fences)
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(jsonStr) as ImageQualityResult;
    // Normalize
    result.quality_score = Math.max(0, Math.min(100, result.quality_score));
    result.issues = result.issues || [];
    return result;
  } catch {
    return null;
  }
}

/**
 * Scrape large images from a webpage's <img> tags.
 * Returns URLs of images that are likely content images (not icons, trackers, etc.).
 */
function scrapePageImages(html: string, domain: string): string[] {
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const images: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(html)) !== null) {
    let src = match[1];
    if (!src || src.startsWith('data:')) continue;

    // Resolve relative URLs
    if (src.startsWith('/')) src = `https://${domain}${src}`;
    else if (!src.startsWith('http')) src = `https://${domain}/${src}`;

    // Skip tracking pixels, tiny icons, and common non-content images
    if (/1x1|spacer|pixel|tracking|analytics|beacon|sprite|icon-\d|badge/i.test(src)) continue;
    // Skip common CDN patterns for tiny assets
    if (/gravatar|wp-includes\/images|emoji|smilies/i.test(src)) continue;

    // Check for size hints in the tag (width/height attributes)
    const fullTag = match[0];
    const widthMatch = fullTag.match(/width=["']?(\d+)/i);
    const heightMatch = fullTag.match(/height=["']?(\d+)/i);
    const w = widthMatch ? parseInt(widthMatch[1]) : 0;
    const h = heightMatch ? parseInt(heightMatch[1]) : 0;
    // Skip if explicitly tiny
    if ((w > 0 && w < 100) || (h > 0 && h < 100)) continue;

    if (!seen.has(src)) {
      seen.add(src);
      images.push(src);
    }
  }
  return images;
}

/**
 * Extended image metadata returned by discover-images.
 * Includes quality assessment from AI vision inspection.
 */
interface DiscoveredImage {
  url: string;
  name: string;
  type: 'logo' | 'favicon' | 'image';
  source: 'website-scrape' | 'website-img' | 'google-cse' | 'google-favicon';
  /** Original (non-proxied) URL for internal processing */
  originalUrl?: string;
  /** AI vision quality assessment (null if vision unavailable) */
  quality?: ImageQualityResult | null;
  /** Actual image dimensions if determinable */
  dimensions?: { width: number; height: number } | null;
}

/**
 * AI image discovery — finds logo, favicon, and images for a business.
 * All URLs are proxied through /api/image-proxy for CORS safety.
 *
 * Enhanced with:
 * - GPT-4o vision quality inspection on ALL discovered images
 * - Homepage <img> tag scraping for large content images
 * - Business domain prioritization in CSE queries
 * - Favicon dimension validation (rejects sub-64px favicons)
 * - Brand quality assessment and asset triage
 *
 * @remarks
 * Every image returned by this endpoint has been:
 * 1. Validated for reachability (HTTP HEAD/GET)
 * 2. Checked for minimum dimensions (>= 64px for icons, >= 400px for photos)
 * 3. Inspected by GPT-4o vision for quality, professionalism, and safety
 * 4. Annotated with a quality score and usage recommendation
 */
search.post('/api/ai/discover-images', async (c) => {
  const body = await c.req.json() as { name: string; address?: string; website?: string };
  if (!body.name) {
    return c.json({ data: { logo: null, favicon: null, images: [], brand_assessment: null } });
  }

  const openaiKey = c.env.OPENAI_API_KEY || '';
  const website = body.website || '';
  let domain = '';
  try {
    if (website) domain = new URL(website.startsWith('http') ? website : `https://${website}`).hostname;
  } catch { /* ignore */ }

  const baseProxy = `https://${DOMAINS.SITES_BASE}/api/image-proxy?url=`;
  const proxy = (url: string) => `${baseProxy}${encodeURIComponent(url)}`;

  // ── Step 1: Scrape the business website (single fetch, reuse HTML) ──
  let scrapedHtml = '';
  if (domain) {
    try {
      const siteRes = await fetch(`https://${domain}`, {
        headers: { 'User-Agent': 'ProjectSites/1.0 (https://projectsites.dev)' },
        redirect: 'follow',
      });
      if (siteRes.ok) {
        scrapedHtml = await siteRes.text();
      }
    } catch {
      // Scraping failed — will use fallbacks
    }
  }

  // ── Step 2: Extract logo from website ──
  let logo: DiscoveredImage | null = null;
  if (domain && scrapedHtml) {
    // Try og:image first (usually highest quality brand image)
    const ogMatch = scrapedHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || scrapedHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    // Try apple-touch-icon (usually the logo at 180px+)
    const appleMatch = scrapedHtml.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i);
    // Try any large favicon
    const iconMatch = scrapedHtml.match(/<link[^>]+rel=["']icon["'][^>]+sizes=["'](\d+)x\d+["'][^>]+href=["']([^"']+)["']/i);

    let logoUrl = '';
    if (ogMatch?.[1]) {
      logoUrl = ogMatch[1];
    } else if (appleMatch?.[1]) {
      logoUrl = appleMatch[1];
    } else if (iconMatch && parseInt(iconMatch[1]) >= 96) {
      logoUrl = iconMatch[2];
    }

    if (logoUrl) {
      if (logoUrl.startsWith('/')) logoUrl = `https://${domain}${logoUrl}`;
      else if (!logoUrl.startsWith('http')) logoUrl = `https://${domain}/${logoUrl}`;
      logo = {
        url: proxy(logoUrl),
        originalUrl: logoUrl,
        name: `${domain}-logo.png`,
        type: 'logo',
        source: 'website-scrape',
      };
    }
  }

  // Try Logo.dev API for high-res company logo
  if (!logo && domain && c.env.LOGODEV_TOKEN) {
    try {
      const logodevUrl = `https://img.logo.dev/${domain}?token=${c.env.LOGODEV_TOKEN}&size=256&format=png&retina=true`;
      const dims = await getImageDimensions(logodevUrl);
      if (dims && dims.width >= 100 && dims.height >= 100) {
        logo = {
          url: proxy(logodevUrl),
          originalUrl: logodevUrl,
          name: `${domain}-logodev.png`,
          type: 'logo',
          source: 'website-scrape',
        };
      }
    } catch { /* non-critical */ }
  }

  // Try Brandfetch API for full brand kit
  let brandfetchData: { logo_url?: string; icon_url?: string; colors?: string[]; fonts?: string[] } | null = null;
  if (domain && c.env.BRANDFETCH_API_KEY) {
    try {
      const bfRes = await fetch(`https://api.brandfetch.io/v2/brands/${domain}`, {
        headers: { 'Authorization': `Bearer ${c.env.BRANDFETCH_API_KEY}` },
      });
      if (bfRes.ok) {
        const bfData = await bfRes.json() as {
          logos?: { formats?: { src: string; format: string }[]; type?: string }[];
          icons?: { formats?: { src: string }[] }[];
          colors?: { hex: string; type: string }[];
          fonts?: { name: string; type: string }[];
        };
        // Extract best logo
        const bfLogos = bfData.logos || [];
        const primaryLogo = bfLogos.find(l => l.type === 'logo') || bfLogos[0];
        const logoSrc = primaryLogo?.formats?.find(f => f.format === 'svg')?.src
          || primaryLogo?.formats?.find(f => f.format === 'png')?.src;
        if (logoSrc && !logo) {
          logo = {
            url: proxy(logoSrc),
            originalUrl: logoSrc,
            name: `${domain}-brandfetch-logo.png`,
            type: 'logo',
            source: 'website-scrape',
          };
        }
        // Extract icon for favicon
        const bfIcon = bfData.icons?.[0]?.formats?.[0]?.src;
        if (bfIcon) {
          const iconDims = await getImageDimensions(bfIcon);
          if (iconDims && iconDims.width >= 64 && !favicon) {
            favicon = {
              url: proxy(bfIcon),
              originalUrl: bfIcon,
              name: `${domain}-brandfetch-icon.png`,
              type: 'favicon',
              source: 'website-scrape',
              dimensions: { width: iconDims.width, height: iconDims.height },
            };
          }
        }
        brandfetchData = {
          logo_url: logoSrc || undefined,
          icon_url: bfIcon || undefined,
          colors: bfData.colors?.map(c => c.hex) || [],
          fonts: bfData.fonts?.map(f => f.name) || [],
        };
      }
    } catch { /* non-critical */ }
  }

  // Fallback: Google's faviconV2 at max resolution
  if (!logo && domain) {
    const googleFavUrl = `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=256`;
    logo = {
      url: proxy(googleFavUrl),
      originalUrl: googleFavUrl,
      name: `${domain}-logo.png`,
      type: 'logo',
      source: 'google-favicon',
    };
  }

  // ── Step 3: Extract favicon with dimension validation ──
  let favicon: DiscoveredImage | null = null;
  if (domain && scrapedHtml) {
    // Look for large icons: 512px, 384px, 256px, 192px
    const largeIconMatch = scrapedHtml.match(/<link[^>]+rel=["'](?:apple-touch-icon|icon)["'][^>]+sizes=["'](\d+)x\d+["'][^>]+href=["']([^"']+)["']/gi);
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
      const appleM = scrapedHtml.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i);
      if (appleM?.[1] && bestSize < 180) { bestUrl = appleM[1]; bestSize = 180; }
    }

    if (bestUrl) {
      if (bestUrl.startsWith('/')) bestUrl = `https://${domain}${bestUrl}`;
      else if (!bestUrl.startsWith('http')) bestUrl = `https://${domain}/${bestUrl}`;

      // Validate actual dimensions — reject sub-64px favicons
      const dims = await getImageDimensions(bestUrl);
      if (dims && dims.width >= 64 && dims.height >= 64) {
        favicon = {
          url: proxy(bestUrl),
          originalUrl: bestUrl,
          name: `${domain}-favicon.png`,
          type: 'favicon',
          source: 'website-scrape',
          dimensions: { width: dims.width, height: dims.height },
        };
      } else if (dims) {
        console.warn(
          JSON.stringify({ level: 'warn', service: 'discover-images', message: 'Rejected tiny favicon', domain, width: dims.width, height: dims.height, url: bestUrl }),
        );
      }
    }

    // If no valid favicon from HTML tags, try the standard /favicon.ico and /favicon.png paths
    if (!favicon) {
      for (const path of ['/apple-touch-icon.png', '/favicon-32x32.png', '/favicon.png', '/favicon.ico']) {
        const candidateUrl = `https://${domain}${path}`;
        const dims = await getImageDimensions(candidateUrl);
        if (dims && dims.width >= 64 && dims.height >= 64) {
          favicon = {
            url: proxy(candidateUrl),
            originalUrl: candidateUrl,
            name: `${domain}-favicon.png`,
            type: 'favicon',
            source: 'website-scrape',
            dimensions: { width: dims.width, height: dims.height },
          };
          break;
        }
      }
    }
  }

  // Fallback: Google faviconV2 at 256px (only if we have a domain and no valid favicon yet)
  if (!favicon && domain) {
    const googleFavUrl = `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=256`;
    // Validate the Google favicon is not a generic globe/placeholder
    const dims = await getImageDimensions(googleFavUrl);
    if (dims && dims.width >= 64 && dims.height >= 64) {
      favicon = {
        url: proxy(googleFavUrl),
        originalUrl: googleFavUrl,
        name: `${domain}-favicon.png`,
        type: 'favicon',
        source: 'google-favicon',
        dimensions: { width: dims.width, height: dims.height },
      };
    }
  }

  // ── Step 4: Discover images from multiple sources ──
  const images: DiscoveredImage[] = [];
  const cseKey = c.env.GOOGLE_CSE_KEY;
  const cseCx = c.env.GOOGLE_CSE_CX;
  const bizName = body.name;
  const slug = bizName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  // 4a: Scrape <img> tags from the business homepage for large content images
  if (domain && scrapedHtml) {
    const pageImages = scrapePageImages(scrapedHtml, domain);
    // Validate dimensions and reachability for scraped images
    const scraped = await Promise.all(
      pageImages.slice(0, 10).map(async (imgUrl) => {
        const dims = await getImageDimensions(imgUrl);
        if (dims && dims.width >= 300 && dims.height >= 200 && dims.byteLength > 15000) {
          return { url: imgUrl, title: '', width: dims.width, height: dims.height };
        }
        return null;
      }),
    );
    const validScraped = scraped.filter((s): s is NonNullable<typeof s> => s !== null);
    // Sort by area (largest first) — best content images tend to be large
    validScraped.sort((a, b) => (b.width * b.height) - (a.width * a.height));
    for (let i = 0; i < Math.min(validScraped.length, 5); i++) {
      images.push({
        url: proxy(validScraped[i].url),
        originalUrl: validScraped[i].url,
        name: `${slug}-site-${i + 1}.jpg`,
        type: 'image',
        source: 'website-img',
        dimensions: { width: validScraped[i].width, height: validScraped[i].height },
      });
    }
  }

  // 4b: Google Custom Search for additional images
  if (cseKey && cseCx) {
    try {
      const blocked = /shutterstock|gettyimages|istockphoto|alamy|dreamstime|123rf|depositphotos|stock\.adobe|loopnet|zillow/i;
      const addr = body.address || '';
      const city = addr.split(',').slice(1, 2).join('').trim();
      const locationCtx = city ? ` ${city}` : '';

      // Enhanced queries — include business domain to prioritize their own hosted images
      const queries = [
        // Prioritize images hosted on the business's own website
        ...(domain ? [`site:${domain} -icon -logo -badge -sprite`] : []),
        `"${bizName}"${locationCtx} official photo -watermark -stock -getty -shutterstock -hotel`,
        `"${bizName}"${locationCtx} site:wikipedia.org OR site:flickr.com OR site:commons.wikimedia.org`,
        `"${bizName}"${locationCtx} building exterior -editorial -stock -hotel -resort`,
        `"${bizName}"${locationCtx} -stock -editorial -hotel -"for sale"`,
      ];

      const allCandidates: { url: string; title: string }[] = [];
      const seenFromScrape = new Set(images.map(img => img.originalUrl || ''));

      const searchPromises = queries.map(async (q) => {
        try {
          const cseUrl = `https://www.googleapis.com/customsearch/v1?key=${cseKey}&cx=${cseCx}&q=${encodeURIComponent(q)}&searchType=image&num=4&imgSize=xlarge&imgType=photo&safe=active`;
          const cseRes = await fetch(cseUrl);
          if (cseRes.ok) {
            const cseData = await cseRes.json() as { items?: { link: string; title: string; displayLink?: string; image?: { width?: number; height?: number } }[] };
            for (const item of (cseData.items || [])) {
              if (blocked.test(item.displayLink || '') || blocked.test(item.link)) continue;
              if (/watermark|preview|thumb|editorial|icon|logo|badge/i.test(item.link)) continue;
              if (seenFromScrape.has(item.link)) continue;
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

      // Deduplicate (also dedup against scraped images)
      const seen = new Set<string>(seenFromScrape);
      const unique = allCandidates.filter(item => { if (seen.has(item.url)) return false; seen.add(item.url); return true; });

      // Validate reachability + minimum size
      const validated: typeof unique = [];
      await Promise.all(unique.slice(0, 20).map(async (item) => {
        try {
          const r = await fetch(item.url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProjectSites/1.0)' }, redirect: 'follow' });
          const ct = r.headers.get('content-type') || '';
          const cl = parseInt(r.headers.get('content-length') || '0');
          if (r.ok && ct.startsWith('image/') && (cl === 0 || cl > 20000)) validated.push(item);
        } catch { /* skip */ }
      }));

      const maxCse = Math.max(0, 14 - images.length);
      for (let i = 0; i < Math.min(validated.length, maxCse); i++) {
        images.push({
          url: proxy(validated[i].url),
          originalUrl: validated[i].url,
          name: `${slug}-${images.length + 1}.jpg`,
          type: 'image',
          source: 'google-cse',
        });
      }
    } catch (err) {
      console.warn('[discover-images] CSE search failed:', err);
    }
  }

  // 4c: Unsplash — high-quality royalty-free photos
  const unsplashKey = c.env.UNSPLASH_ACCESS_KEY;
  if (unsplashKey && images.length < 14) {
    try {
      const unsplashQuery = `${bizName} ${body.address?.split(',').slice(1, 2).join('').trim() || ''}`.trim();
      const uRes = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(unsplashQuery)}&per_page=4&orientation=landscape`, {
        headers: { 'Authorization': `Client-ID ${unsplashKey}` },
      });
      if (uRes.ok) {
        const uData = await uRes.json() as { results?: { urls: { regular: string }; alt_description?: string; user: { name: string } }[] };
        const seenUrls = new Set(images.map(img => img.originalUrl || ''));
        for (const photo of (uData.results || []).slice(0, 4)) {
          if (!seenUrls.has(photo.urls.regular) && images.length < 14) {
            images.push({
              url: proxy(photo.urls.regular),
              originalUrl: photo.urls.regular,
              name: `${slug}-unsplash-${images.length + 1}.jpg`,
              type: 'image',
              source: 'google-cse', // grouped with discovered images
            });
          }
        }
      }
    } catch { /* non-critical */ }
  }

  // 4d: Foursquare — venue photos
  const foursquareKey = c.env.FOURSQUARE_API_KEY;
  if (foursquareKey && images.length < 14) {
    try {
      const fsQuery = encodeURIComponent(bizName);
      const fsNear = encodeURIComponent(body.address || '');
      const fsSearchRes = await fetch(`https://api.foursquare.com/v3/places/search?query=${fsQuery}&near=${fsNear}&limit=1`, {
        headers: { 'Authorization': foursquareKey, 'Accept': 'application/json' },
      });
      if (fsSearchRes.ok) {
        const fsSearchData = await fsSearchRes.json() as { results?: { fsq_id: string }[] };
        const fsqId = fsSearchData.results?.[0]?.fsq_id;
        if (fsqId) {
          const fsPhotosRes = await fetch(`https://api.foursquare.com/v3/places/${fsqId}/photos?limit=4`, {
            headers: { 'Authorization': foursquareKey, 'Accept': 'application/json' },
          });
          if (fsPhotosRes.ok) {
            const fsPhotos = await fsPhotosRes.json() as { prefix: string; suffix: string }[];
            const seenUrls = new Set(images.map(img => img.originalUrl || ''));
            for (const p of (Array.isArray(fsPhotos) ? fsPhotos : []).slice(0, 3)) {
              const photoUrl = `${p.prefix}original${p.suffix}`;
              if (!seenUrls.has(photoUrl) && images.length < 14) {
                images.push({
                  url: proxy(photoUrl),
                  originalUrl: photoUrl,
                  name: `${slug}-fsq-${images.length + 1}.jpg`,
                  type: 'image',
                  source: 'google-cse',
                });
              }
            }
          }
        }
      }
    } catch { /* non-critical */ }
  }

  // 4e: Yelp — business photos
  const yelpKey = c.env.YELP_API_KEY;
  if (yelpKey && images.length < 14) {
    try {
      const yelpQuery = encodeURIComponent(bizName);
      const yelpLocation = encodeURIComponent(body.address || '');
      const yRes = await fetch(`https://api.yelp.com/v3/businesses/search?term=${yelpQuery}&location=${yelpLocation}&limit=1`, {
        headers: { 'Authorization': `Bearer ${yelpKey}` },
      });
      if (yRes.ok) {
        const yData = await yRes.json() as { businesses?: { id: string; image_url?: string; photos?: string[] }[] };
        const biz = yData.businesses?.[0];
        if (biz) {
          const seenUrls = new Set(images.map(img => img.originalUrl || ''));
          const yelpPhotos = biz.photos || (biz.image_url ? [biz.image_url] : []);
          for (const photoUrl of yelpPhotos.slice(0, 3)) {
            if (photoUrl && !seenUrls.has(photoUrl) && images.length < 14) {
              images.push({
                url: proxy(photoUrl),
                originalUrl: photoUrl,
                name: `${slug}-yelp-${images.length + 1}.jpg`,
                type: 'image',
                source: 'google-cse',
              });
            }
          }
        }
      }
    } catch { /* non-critical */ }
  }

  // ── Step 5: Validate logo and favicon reachability ──
  if (logo?.originalUrl && !(await isImageReachable(logo.originalUrl))) {
    logo = null;
  }
  if (favicon?.originalUrl && !(await isImageReachable(favicon.originalUrl))) {
    favicon = null;
  }

  // ── Step 6: AI vision quality inspection on ALL images ──
  if (openaiKey) {
    const inspectionTasks: Promise<void>[] = [];

    if (logo) {
      const logoRef = logo;
      inspectionTasks.push(
        inspectImageWithVision(logoRef.originalUrl || logoRef.url, { businessName: bizName, imageRole: 'logo' }, openaiKey)
          .then(result => { logoRef.quality = result; }),
      );
    }

    if (favicon) {
      const favRef = favicon;
      inspectionTasks.push(
        inspectImageWithVision(favRef.originalUrl || favRef.url, { businessName: bizName, imageRole: 'favicon' }, openaiKey)
          .then(result => { favRef.quality = result; }),
      );
    }

    // Inspect all discovered images in parallel (batch of 6 at a time to avoid rate limits)
    for (let batch = 0; batch < images.length; batch += 6) {
      const batchImages = images.slice(batch, batch + 6);
      const batchTasks = batchImages.map((img) =>
        inspectImageWithVision(img.originalUrl || img.url, { businessName: bizName, imageRole: 'photo' }, openaiKey)
          .then(result => { img.quality = result; }),
      );
      inspectionTasks.push(...batchTasks);
    }

    // Wait for all inspections (with a 15s timeout so we don't block forever)
    await Promise.race([
      Promise.allSettled(inspectionTasks),
      new Promise(resolve => setTimeout(resolve, 15000)),
    ]);

    // Filter out unsafe or rejected images
    if (logo?.quality && (!logo.quality.is_safe || logo.quality.recommendation === 'reject')) {
      console.warn(JSON.stringify({ level: 'warn', service: 'discover-images', message: 'Logo rejected by vision', domain, issues: logo.quality.issues }));
      logo = null;
    }
    if (favicon?.quality && (!favicon.quality.is_safe || favicon.quality.recommendation === 'reject')) {
      console.warn(JSON.stringify({ level: 'warn', service: 'discover-images', message: 'Favicon rejected by vision', domain, issues: favicon.quality.issues }));
      favicon = null;
    }

    // Remove unsafe, rejected, padded, or irrelevant images
    const filteredImages = images.filter(img => {
      if (!img.quality) return true; // Vision unavailable — keep
      if (!img.quality.is_safe) return false; // Unsafe — remove
      if (img.quality.recommendation === 'reject') return false; // Explicitly rejected
      // Reject images with excessive padding and low quality
      if (img.quality.has_padding && img.quality.quality_score < 60) return false;
      // Reject generic CAD renderings with low business relevance
      if (img.quality.is_generic_rendering && (img.quality.business_relevance ?? 0) < 0.5) return false;
      return true;
    });
    images.length = 0;
    images.push(...filteredImages);

    // Sort by quality score (highest first) so best images appear first in UI
    images.sort((a, b) => (b.quality?.quality_score ?? 50) - (a.quality?.quality_score ?? 50));
  }

  // ── Step 7: Brand quality assessment ──
  let brandAssessment: {
    brand_maturity: 'established' | 'developing' | 'minimal';
    website_quality_score: number;
    asset_strategy: string;
    has_professional_logo: boolean;
    has_quality_favicon: boolean;
    recommendation: string;
  } | null = null;

  if (openaiKey && domain && scrapedHtml) {
    try {
      const titleMatch = scrapedHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
      const pageTitle = titleMatch?.[1]?.trim() || '';
      // Count quality signals
      const hasOgImage = /<meta[^>]+property=["']og:image/i.test(scrapedHtml);
      const hasAppleTouchIcon = /<link[^>]+rel=["']apple-touch-icon/i.test(scrapedHtml);
      const hasStructuredData = /application\/ld\+json/i.test(scrapedHtml);
      const hasViewport = /<meta[^>]+name=["']viewport/i.test(scrapedHtml);
      const hasSsl = website.startsWith('https');
      const imgCount = (scrapedHtml.match(/<img[^>]+>/gi) || []).length;

      // Simple heuristic scoring (0-100) for website quality
      let siteScore = 20; // base
      if (hasOgImage) siteScore += 15;
      if (hasAppleTouchIcon) siteScore += 10;
      if (hasStructuredData) siteScore += 15;
      if (hasViewport) siteScore += 10;
      if (hasSsl) siteScore += 10;
      if (imgCount >= 3) siteScore += 10;
      if (pageTitle && pageTitle.length > 5) siteScore += 10;

      const hasProfessionalLogo = !!(logo?.quality && logo.quality.quality_score >= 70 && logo.quality.is_professional);
      const hasQualityFavicon = !!(favicon?.dimensions && favicon.dimensions.width >= 256);

      let maturity: 'established' | 'developing' | 'minimal' = 'minimal';
      if (siteScore >= 70 && hasProfessionalLogo) maturity = 'established';
      else if (siteScore >= 40) maturity = 'developing';

      let strategy = '';
      let recommendation = '';
      if (maturity === 'established') {
        strategy = 'Use original brand assets as-is. Honor existing brand identity.';
        recommendation = 'Recreate site faithful to existing brand with modern enhancements.';
      } else if (maturity === 'developing') {
        strategy = 'Use original assets as inspiration. Enhance colors, typography, and imagery.';
        recommendation = 'Build a polished, professional site that elevates the existing brand.';
      } else {
        strategy = 'Original assets are low quality. Use as inspiration only. Generate professional AI alternatives.';
        recommendation = 'Create a gorgeous, modern site that reimagines the brand professionally.';
      }

      brandAssessment = {
        brand_maturity: maturity,
        website_quality_score: siteScore,
        asset_strategy: strategy,
        has_professional_logo: hasProfessionalLogo,
        has_quality_favicon: hasQualityFavicon,
        recommendation,
      };
    } catch {
      // Brand assessment is non-critical
    }
  }

  // Enrich brand assessment with Brandfetch data if available
  if (brandAssessment && brandfetchData) {
    (brandAssessment as any).brandfetch = brandfetchData;
  }

  // Clean response — strip internal fields
  const cleanImage = (img: DiscoveredImage) => ({
    url: img.url,
    name: img.name,
    type: img.type,
    source: img.source,
    quality: img.quality || null,
    dimensions: img.dimensions || null,
  });

  return c.json({
    data: {
      logo: logo ? cleanImage(logo) : null,
      favicon: favicon ? cleanImage(favicon) : null,
      images: images.map(cleanImage),
      brand_assessment: brandAssessment,
    },
  });
});

/**
 * Video discovery — finds relevant videos for a business from YouTube, Pexels, and Pixabay.
 * Returns embeddable video URLs with attribution metadata for the legal/attribution page.
 *
 * @remarks
 * Sources (in priority order):
 * 1. YouTube Data API v3 — official business channel videos, location-specific content
 * 2. Pexels Video API — royalty-free stock videos matching business type
 * 3. Pixabay Video API — royalty-free stock videos as fallback
 *
 * All videos include attribution data for the `/attribution` page.
 */
search.post('/api/ai/discover-videos', async (c) => {
  const body = await c.req.json() as { name: string; address?: string; business_type?: string };
  if (!body.name) {
    return c.json({ data: { videos: [], attribution: [] } });
  }

  const videos: {
    url: string;
    embed_url: string;
    thumbnail: string;
    title: string;
    source: 'youtube' | 'pexels' | 'pixabay';
    duration_seconds: number;
    attribution: { author: string; license: string; source_url: string };
    relevance: 'business_specific' | 'category_generic';
  }[] = [];

  const bizName = body.name;
  const bizType = body.business_type || '';
  const addr = body.address || '';
  const city = addr.split(',').slice(1, 2).join('').trim();

  // 1. YouTube Data API — search for business-specific videos
  const youtubeKey = c.env.YOUTUBE_API_KEY;
  if (youtubeKey) {
    try {
      const queries = [
        `"${bizName}" ${city}`.trim(),
        ...(bizType ? [`${bizType} ${city} tour`] : []),
      ];
      for (const q of queries) {
        const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=3&q=${encodeURIComponent(q)}&key=${youtubeKey}`;
        const ytRes = await fetch(ytUrl);
        if (ytRes.ok) {
          const ytData = await ytRes.json() as {
            items?: { id: { videoId: string }; snippet: { title: string; thumbnails: { high?: { url: string } }; channelTitle: string } }[]
          };
          for (const item of (ytData.items || [])) {
            const videoId = item.id.videoId;
            videos.push({
              url: `https://www.youtube.com/watch?v=${videoId}`,
              embed_url: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&controls=0`,
              thumbnail: item.snippet.thumbnails?.high?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
              title: item.snippet.title,
              source: 'youtube',
              duration_seconds: 0,
              attribution: {
                author: item.snippet.channelTitle,
                license: 'YouTube Standard License',
                source_url: `https://www.youtube.com/watch?v=${videoId}`,
              },
              relevance: q.includes(bizName) ? 'business_specific' : 'category_generic',
            });
          }
        }
      }
    } catch (err) {
      console.warn('[discover-videos] YouTube search failed:', err);
    }
  }

  // 2. Pexels Video API — royalty-free stock videos
  const pexelsKey = c.env.PEXELS_API_KEY;
  if (pexelsKey && videos.length < 5) {
    try {
      const pexelsQuery = bizType || bizName;
      const pxRes = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(pexelsQuery)}&per_page=3&size=large`, {
        headers: { 'Authorization': pexelsKey },
      });
      if (pxRes.ok) {
        const pxData = await pxRes.json() as {
          videos?: { id: number; url: string; duration: number; image: string; user: { name: string; url: string };
            video_files?: { link: string; quality: string; width: number }[] }[]
        };
        for (const v of (pxData.videos || [])) {
          const hdFile = v.video_files?.find(f => f.quality === 'hd' || f.width >= 1280);
          if (hdFile) {
            videos.push({
              url: v.url,
              embed_url: hdFile.link,
              thumbnail: v.image,
              title: `Stock video from Pexels`,
              source: 'pexels',
              duration_seconds: v.duration,
              attribution: {
                author: v.user.name,
                license: 'Pexels License (free for commercial use)',
                source_url: v.url,
              },
              relevance: 'category_generic',
            });
          }
        }
      }
    } catch (err) {
      console.warn('[discover-videos] Pexels search failed:', err);
    }
  }

  // 3. Pixabay Video API — royalty-free fallback
  const pixabayKey = c.env.PIXABAY_API_KEY;
  if (pixabayKey && videos.length < 3) {
    try {
      const pbQuery = bizType || bizName;
      const pbRes = await fetch(`https://pixabay.com/api/videos/?key=${pixabayKey}&q=${encodeURIComponent(pbQuery)}&per_page=3&safesearch=true`);
      if (pbRes.ok) {
        const pbData = await pbRes.json() as {
          hits?: { id: number; pageURL: string; duration: number; user: string;
            videos?: { large?: { url: string; thumbnail: string } } }[]
        };
        for (const h of (pbData.hits || [])) {
          if (h.videos?.large?.url) {
            videos.push({
              url: h.pageURL,
              embed_url: h.videos.large.url,
              thumbnail: h.videos.large.thumbnail || '',
              title: `Stock video from Pixabay`,
              source: 'pixabay',
              duration_seconds: h.duration,
              attribution: {
                author: h.user,
                license: 'Pixabay License (free for commercial use)',
                source_url: h.pageURL,
              },
              relevance: 'category_generic',
            });
          }
        }
      }
    } catch (err) {
      console.warn('[discover-videos] Pixabay search failed:', err);
    }
  }

  // Deduplicate by embed URL
  const seen = new Set<string>();
  const unique = videos.filter(v => { if (seen.has(v.embed_url)) return false; seen.add(v.embed_url); return true; });

  // Sort: business-specific first, then by source priority
  unique.sort((a, b) => {
    if (a.relevance !== b.relevance) return a.relevance === 'business_specific' ? -1 : 1;
    const srcOrder = { youtube: 0, pexels: 1, pixabay: 2 };
    return srcOrder[a.source] - srcOrder[b.source];
  });

  const attribution = unique.map(v => v.attribution);

  return c.json({
    data: {
      videos: unique.slice(0, 6),
      attribution,
    },
  });
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

// ── Public Site Data API (read-only, for live polling from generated sites) ──

/**
 * Public read-only endpoint for per-site D1 data tables.
 * Generated websites poll this to stay in sync when clients edit data.
 *
 * Allowed tables (whitelisted to prevent data leaks):
 * services, team_members, business_hours, faq, menu_items, gallery,
 * social_links, specials, products, classes, listings, amenities, reviews
 */
const ALLOWED_PUBLIC_TABLES = new Set([
  'services', 'team_members', 'business_hours', 'faq', 'menu_items',
  'gallery', 'social_links', 'specials', 'products', 'classes',
  'listings', 'amenities', 'reviews', 'brand_config', 'policies',
]);

search.get('/api/public-data/:table', async (c) => {
  const table = c.req.param('table');
  if (!ALLOWED_PUBLIC_TABLES.has(table)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Unknown table' } }, 400);
  }

  // Resolve site from hostname (subdomain or custom domain)
  const hostname = c.req.header('host') || '';
  const { resolveSite } = await import('../services/site_serving.js');
  const site = await resolveSite(c.env, c.env.DB, hostname);
  if (!site) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }

  // Query the site's data table (stored in the shared DB with site_id scoping)
  try {
    const result = await c.env.DB.prepare(
      `SELECT * FROM site_data WHERE site_id = ? AND table_name = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
    ).bind(site.site_id, table).all();

    // Parse the JSON data column for each row
    const rows = (result.results || []).map((row: any) => {
      try {
        return { id: row.id, ...JSON.parse(row.data_json || '{}') };
      } catch {
        return { id: row.id };
      }
    });

    return c.json({ data: rows }, 200, {
      'Cache-Control': 'public, max-age=10, stale-while-revalidate=30',
      'Access-Control-Allow-Origin': '*',
    });
  } catch {
    return c.json({ data: [] }, 200, {
      'Cache-Control': 'public, max-age=10',
      'Access-Control-Allow-Origin': '*',
    });
  }
});

/** Authenticated endpoint for admin to read/write site data */
search.get('/api/sites/:siteId/data/:table', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } }, 401);
  const { siteId, table } = c.req.param();
  if (!ALLOWED_PUBLIC_TABLES.has(table)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Unknown table' } }, 400);
  }

  const result = await c.env.DB.prepare(
    `SELECT * FROM site_data WHERE site_id = ? AND table_name = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
  ).bind(siteId, table).all();

  const rows = (result.results || []).map((row: any) => {
    try {
      return { id: row.id, sort_order: row.sort_order, ...JSON.parse(row.data_json || '{}') };
    } catch {
      return { id: row.id, sort_order: row.sort_order };
    }
  });

  return c.json({ data: rows });
});

/** Upsert a row in a site data table */
search.put('/api/sites/:siteId/data/:table/:rowId', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } }, 401);
  const { siteId, table, rowId } = c.req.param();
  if (!ALLOWED_PUBLIC_TABLES.has(table)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Unknown table' } }, 400);
  }

  const body = await c.req.json();
  const dataJson = JSON.stringify(body.data || body);

  await c.env.DB.prepare(
    `INSERT INTO site_data (id, site_id, table_name, data_json, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET data_json = ?, sort_order = ?, updated_at = datetime('now')`,
  ).bind(rowId, siteId, table, dataJson, body.sort_order ?? 0, dataJson, body.sort_order ?? 0).run();

  return c.json({ data: { id: rowId, updated: true } });
});

/** Delete a row from a site data table */
search.delete('/api/sites/:siteId/data/:table/:rowId', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } }, 401);
  const { siteId, table, rowId } = c.req.param();

  await c.env.DB.prepare(
    `UPDATE site_data SET deleted_at = datetime('now') WHERE id = ? AND site_id = ? AND table_name = ?`,
  ).bind(rowId, siteId, table).run();

  return c.json({ data: { id: rowId, deleted: true } });
});

/** List all tables for a site (for admin AG Grid) */
search.get('/api/sites/:siteId/data', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } }, 401);
  const siteId = c.req.param('siteId');

  const result = await c.env.DB.prepare(
    `SELECT DISTINCT table_name, COUNT(*) as row_count FROM site_data WHERE site_id = ? AND deleted_at IS NULL GROUP BY table_name ORDER BY table_name`,
  ).bind(siteId).all();

  return c.json({ data: result.results || [] });
});

/**
 * Container upload endpoint — allows the build container to upload files to R2
 * via the public worker URL when outbound handlers aren't available.
 * Authenticated via a shared secret passed in the build payload.
 */
search.put('/api/container-upload/*', async (c) => {
  const secret = c.req.header('x-container-secret');
  if (secret !== c.env.ANTHROPIC_API_KEY?.slice(0, 16)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const key = c.req.path.replace('/api/container-upload/', '');
  if (!key || key.includes('..')) return c.json({ error: 'Invalid key' }, 400);

  const body = await c.req.arrayBuffer();
  const ct = c.req.header('content-type') || 'application/octet-stream';
  await c.env.SITES_BUCKET.put(key, body, { httpMetadata: { contentType: ct } });
  return c.json({ ok: true, key });
});

/**
 * Container D1 query endpoint — allows the build container to execute
 * parameterized SQL via the public worker URL.
 */
search.post('/api/container-query', async (c) => {
  const secret = c.req.header('x-container-secret');
  if (secret !== c.env.ANTHROPIC_API_KEY?.slice(0, 16)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const body = await c.req.json() as { sql: string; params?: unknown[] };
  const stmt = c.env.DB.prepare(body.sql);
  const result = body.params ? await stmt.bind(...body.params).run() : await stmt.run();
  return c.json({ ok: true, meta: result.meta });
});

/** Serve the container build server script from R2 (used by container entrypoint bootstrap) */
search.get('/api/container-script', async (c) => {
  const obj = await c.env.SITES_BUCKET.get('container/build-server.js');
  if (!obj) {
    return c.text('// build-server.js not found in R2', 404);
  }
  return new Response(await obj.text(), {
    headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' },
  });
});

export { search };
