/**
 * Mock API server for E2E tests.
 * Serves the Angular build + mocks all /api/* endpoints.
 *
 * Usage: node scripts/e2e_server.cjs [port]
 * Default port: 4300
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '4300', 10);
const DIST = path.join(__dirname, '..', 'dist', 'project-sites-frontend', 'browser');

// ─── Mock data ────────────────────────────────────

const MOCK_USER = {
  id: 'user-001',
  email: 'test@example.com',
  org_id: 'org-001',
};

const MOCK_SITE = {
  id: 'site-001',
  slug: 'vitos-mens-salon',
  business_name: "Vito's Mens Salon",
  business_address: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
  status: 'published',
  plan: 'paid',
  current_build_version: 1,
  primary_hostname: null,
  created_at: '2026-03-01T12:00:00Z',
  updated_at: '2026-03-10T15:30:00Z',
};

const MOCK_SITE_2 = {
  id: 'site-002',
  slug: 'hey-pizza',
  business_name: 'Hey Pizza',
  business_address: '100 Main St, Newark, NJ 07102',
  status: 'building',
  plan: null,
  current_build_version: null,
  primary_hostname: null,
  created_at: '2026-04-01T12:00:00Z',
  updated_at: '2026-04-10T15:30:00Z',
};

const MOCK_SITES = [MOCK_SITE, MOCK_SITE_2];

let siteIdCounter = 1;
let snapshotIdCounter = 2;
const buildAssetPolls = {}; // Track poll count per site for drip-feed

// ─── Stateful snapshot store (per-site) ──────────
const siteSnapshots = new Map();
// Pre-populate site-001 with an "initial" snapshot
siteSnapshots.set('site-001', [
  { id: 'snap-001', snapshot_name: 'initial', build_version: '1', description: 'Initial AI build', created_at: '2026-03-10T15:30:00Z' },
]);

const MOCK_FILES = [
  { key: 'sites/vitos-mens-salon/1/index.html', size: 12400, uploaded: '2026-03-10T15:30:00Z' },
  { key: 'sites/vitos-mens-salon/1/privacy.html', size: 4800, uploaded: '2026-03-10T15:30:00Z' },
  { key: 'sites/vitos-mens-salon/1/terms.html', size: 5100, uploaded: '2026-03-10T15:30:00Z' },
  { key: 'sites/vitos-mens-salon/1/css/styles.css', size: 3200, uploaded: '2026-03-10T15:30:00Z' },
  { key: 'sites/vitos-mens-salon/1/css/responsive.css', size: 1400, uploaded: '2026-03-10T15:30:00Z' },
  { key: 'sites/vitos-mens-salon/1/js/main.js', size: 1800, uploaded: '2026-03-10T15:30:00Z' },
  { key: 'sites/vitos-mens-salon/1/js/analytics.js', size: 650, uploaded: '2026-03-10T15:30:00Z' },
  { key: 'sites/vitos-mens-salon/1/images/logo.png', size: 45000, uploaded: '2026-03-10T15:30:00Z' },
  { key: 'sites/vitos-mens-salon/1/images/hero.jpg', size: 128000, uploaded: '2026-03-10T15:30:00Z' },
];

const MOCK_FILE_CONTENT = '<!DOCTYPE html>\n<html>\n<head><title>Test</title></head>\n<body><h1>Hello World</h1></body>\n</html>';

const MOCK_LOGS = [
  { id: 'log-001', action: 'site.created', created_at: '2026-03-01T12:00:00Z', metadata_json: '{"business_name":"Vito\'s Mens Salon","slug":"vitos-mens-salon","mode":"search"}' },
  { id: 'log-002', action: 'workflow.started', created_at: '2026-03-01T12:01:00Z', metadata_json: '{"business_name":"Vito\'s Mens Salon","slug":"vitos-mens-salon","has_context":true,"has_assets":false}' },
  { id: 'log-003', action: 'workflow.status_update', created_at: '2026-03-01T12:01:05Z', metadata_json: '{"status":"building","phase":"research"}' },
  { id: 'log-004', action: 'workflow.step.profile_research_started', created_at: '2026-03-01T12:01:10Z', metadata_json: '{"business_name":"Vito\'s Mens Salon","business_address":"74 N Beverwyck Rd, Lake Hiawatha, NJ 07034"}' },
  { id: 'log-005', action: 'workflow.step.google_places_enriched', created_at: '2026-03-01T12:01:30Z', metadata_json: '{"rating":4.8,"review_count":127,"photo_count":24,"has_phone":true,"has_website":true,"has_hours":true}' },
  { id: 'log-006', action: 'workflow.debug.llm_output', created_at: '2026-03-01T12:02:00Z', metadata_json: '{"step":"research-profile","output_length":3842,"model":"llama-3.1-70b"}' },
  { id: 'log-007', action: 'workflow.debug.validation_failed', created_at: '2026-03-01T12:02:05Z', metadata_json: '{"step":"research-social","zod_details":"review_platforms.0.rating: Expected string, received number; review_platforms.0.url: Required"}' },
  { id: 'log-008', action: 'workflow.step.profile_research_complete', created_at: '2026-03-01T12:02:10Z', metadata_json: '{"business_type":"Mens Salon / Barbershop","services_count":12,"city":"Lake Hiawatha","state":"NJ","elapsed_ms":60000}' },
  { id: 'log-009', action: 'workflow.step.parallel_research_started', created_at: '2026-03-01T12:02:15Z', metadata_json: '{"steps":["research-social","research-brand","research-selling-points","research-images"]}' },
  { id: 'log-010', action: 'workflow.step.parallel_research_complete', created_at: '2026-03-01T12:03:00Z', metadata_json: '{"website_url":"https://vitos-salon.com","elapsed_ms":45000}' },
  { id: 'log-011', action: 'workflow.step.html_generation_complete', created_at: '2026-03-01T12:04:00Z', metadata_json: '{"html_size_kb":28.5,"elapsed_ms":35000}' },
  { id: 'log-012', action: 'workflow.step.legal_and_scoring_complete', created_at: '2026-03-01T12:04:30Z', metadata_json: '{"quality_score":87,"elapsed_ms":15000}' },
  { id: 'log-013', action: 'workflow.step.upload_to_r2_complete', created_at: '2026-03-01T12:04:45Z', metadata_json: '{"version":"1","slug":"vitos-mens-salon","elapsed_ms":3200}' },
  { id: 'log-014', action: 'workflow.completed', created_at: '2026-03-01T12:05:00Z', metadata_json: '{"url":"https://vitos-mens-salon.projectsites.dev","quality_score":87,"total_seconds":240}' },
  { id: 'log-015', action: 'file.updated', created_at: '2026-03-05T10:00:00Z', metadata_json: '{"file_key":"sites/vitos-mens-salon/1/index.html","size":12800}' },
];

const MOCK_HOSTNAMES = [
  { id: 'hn-001', hostname: 'www.vitos-salon.com', status: 'active', is_primary: true },
];

// ─── Helpers ────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath)) {
    // SPA fallback
    const indexPath = path.join(DIST, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(indexPath));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const ct = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct });
  res.end(fs.readFileSync(filePath));
}

// ─── Routes ────────────────────────────────────

// Track created sites for workflow testing
const createdSites = new Map();

async function handleAPI(req, res, urlPath) {
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
    res.end();
    return;
  }

  // Auth
  if (urlPath === '/api/auth/me' && method === 'GET') {
    return json(res, { data: MOCK_USER });
  }
  if (urlPath === '/api/auth/magic-link' && method === 'POST') {
    return json(res, { data: { token: 'mock-token-123', identifier: 'test@example.com' } });
  }

  // Search
  if (urlPath.startsWith('/api/search/businesses') && method === 'GET') {
    const searchQ = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('q') || '';
    const qLower = searchQ.toLowerCase();

    // White House results
    if (qLower.includes('white house')) {
      return json(res, { data: [
        { name: 'The White House', address: '1600 Pennsylvania Avenue NW, Washington, DC 20500', place_id: 'place-whitehouse', phone: '(202) 456-1111', website: 'https://www.whitehouse.gov', types: ['tourist_attraction', 'point_of_interest', 'establishment', 'local_government_office'] },
        { name: 'White House Visitor Center', address: '1450 Pennsylvania Avenue NW, Washington, DC 20230', place_id: 'place-whitehouse-vc', phone: '(202) 208-1631', website: 'https://www.nps.gov/whho', types: ['tourist_attraction', 'museum', 'point_of_interest'] },
      ] });
    }

    // When Doody Calls results
    if (qLower.includes('doody') || qLower.includes('pooper')) {
      return json(res, { data: [
        { name: 'When Doody Calls - Pooper Scoopers', address: '123 Clean St, Dallas, TX 75201', place_id: 'place-whendoodycalls', phone: '(214) 555-POOP', website: 'https://whendoodycalls.com', types: ['point_of_interest', 'establishment', 'home_goods_store'] },
      ] });
    }

    // "Hey" results — long list to test dropdown z-index/overlay
    // Simulates Google Places: returns all matching businesses, filtered by query
    const heyBusinesses = [
      { name: 'Hey Pizza', address: '100 Main St, Newark, NJ 07102', place_id: 'place-hey-pizza', phone: '(973) 555-0001', website: 'https://heypizza.com', types: ['restaurant', 'food', 'meal_delivery'] },
      { name: 'Hey Salon & Spa', address: '200 Broad St, Newark, NJ 07102', place_id: 'place-hey-salon', phone: '(973) 555-0002', website: 'https://heysalon.com', types: ['hair_care', 'beauty_salon', 'spa'] },
      { name: 'Hey Tech Solutions', address: '300 Market St, Newark, NJ 07102', place_id: 'place-hey-tech', phone: '(973) 555-0003', website: 'https://heytech.io', types: ['point_of_interest', 'establishment'] },
      { name: 'Hey Fitness Gym', address: '400 Park Ave, Newark, NJ 07102', place_id: 'place-hey-gym', phone: '(973) 555-0004', website: 'https://heyfitness.com', types: ['gym', 'health', 'point_of_interest'] },
      { name: 'Hey Legal Associates', address: '500 Court St, Newark, NJ 07102', place_id: 'place-hey-legal', phone: '(973) 555-0005', website: 'https://heylegal.com', types: ['lawyer', 'point_of_interest'] },
      { name: 'Hey Medical Center', address: '600 Hospital Dr, Newark, NJ 07102', place_id: 'place-hey-medical', phone: '(973) 555-0006', website: 'https://heymedical.com', types: ['doctor', 'health', 'hospital'] },
      { name: 'Hey Auto Repair', address: '700 Motor Ave, Newark, NJ 07102', place_id: 'place-hey-auto', phone: '(973) 555-0007', types: ['car_repair', 'point_of_interest'] },
      { name: 'Hey Photo Studio', address: '800 Art Blvd, Newark, NJ 07102', place_id: 'place-hey-photo', phone: '(973) 555-0008', website: 'https://heyphoto.com', types: ['photographer', 'point_of_interest'] },
      { name: 'Hey Dental Care', address: '900 Smile Rd, Newark, NJ 07102', place_id: 'place-hey-dental', phone: '(973) 555-0009', website: 'https://heydental.com', types: ['dentist', 'health'] },
      { name: 'Hey Realty Group', address: '1000 Property Ln, Newark, NJ 07102', place_id: 'place-hey-realty', phone: '(973) 555-0010', website: 'https://heyrealty.com', types: ['real_estate_agency', 'point_of_interest'] },
    ];
    const heyMatches = heyBusinesses.filter(b => b.name.toLowerCase().includes(qLower));
    if (heyMatches.length > 0) {
      return json(res, { data: heyMatches });
    }

    // Default results
    return json(res, { data: [
      { name: "Vito's Mens Salon", address: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034', place_id: 'place-vitos', phone: '(973) 123-4567', website: 'https://vitos-salon.com', types: ['hair_care', 'beauty_salon'] },
      { name: 'Lake Hiawatha Deli', address: '88 N Beverwyck Rd, Lake Hiawatha, NJ 07034', place_id: 'place-deli', types: ['restaurant'] },
    ] });
  }
  if (urlPath.startsWith('/api/sites/search') && method === 'GET') {
    return json(res, { data: [] });
  }
  if (urlPath.startsWith('/api/sites/lookup') && method === 'GET') {
    return json(res, { data: null });
  }
  if (urlPath.startsWith('/api/search/address') && method === 'GET') {
    return json(res, { data: [
      { description: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034', place_id: 'place-addr-1' },
      { description: '88 N Beverwyck Rd, Lake Hiawatha, NJ 07034', place_id: 'place-addr-2' },
    ] });
  }

  // Sites CRUD
  if (urlPath === '/api/sites' && method === 'GET') {
    const allSites = [...MOCK_SITES, ...createdSites.values()];
    return json(res, { data: allSites });
  }

  // Create site
  if (urlPath === '/api/sites/create-from-search' && method === 'POST') {
    const body = await readBody(req);
    const newId = `site-new-${++siteIdCounter}`;
    // AI-smart slug generation (mock): use shortest meaningful representation
    const rawName = (body.business?.name || 'new-site');
    const address = (body.business?.address || '');
    const city = address.split(',').slice(1, 2).join('').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    let slug = rawName.toLowerCase().replace(/'/g, '').replace(/\s*-\s*.+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    // For chain brands, append city/neighborhood for disambiguation
    const chains = ['trader-joes', 'mcdonalds', 'starbucks', 'dunkin', 'subway', 'target', 'walmart', 'costco'];
    if (chains.some(c => slug.startsWith(c)) && city) {
      slug = slug + '-' + city;
    }
    // Check if name already has a location qualifier (e.g., "Trader Joe's - Hell's Kitchen")
    const qualifier = rawName.match(/\s*-\s*(.+)$/);
    if (qualifier && chains.some(c => slug.startsWith(c))) {
      slug = rawName.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }
    slug = slug.substring(0, 63);
    const newSite = {
      id: newId,
      slug,
      business_name: body.business?.name || 'New Site',
      business_address: body.business?.address || '',
      status: 'building',
      plan: null,
      current_build_version: null,
      primary_hostname: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      _step: 0, // internal: track build progress
      _created_at: Date.now(), // internal: for progressive log timing
    };
    createdSites.set(newId, newSite);
    // Auto-progress the build — timing matches the progressive logs
    // If name includes "FAILTEST", simulate a build error
    const isErrorBuild = rawName.toLowerCase().includes('failtest');
    const statuses = isErrorBuild
      ? ['building', 'imaging', 'error']
      : ['building', 'imaging', 'generating', 'uploading', 'published'];
    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step < statuses.length) {
        newSite.status = statuses[step];
        newSite.updated_at = new Date().toISOString();
        if (statuses[step] === 'published') {
          newSite.current_build_version = 1;
          // Auto-create "initial" snapshot when site publishes
          const snaps = siteSnapshots.get(newId) || [];
          snaps.push({
            id: 'snap-' + (++snapshotIdCounter),
            snapshot_name: 'initial',
            build_version: '1',
            description: 'Initial AI build',
            created_at: new Date().toISOString(),
          });
          siteSnapshots.set(newId, snaps);
          clearInterval(interval);
        }
        if (statuses[step] === 'error') {
          clearInterval(interval);
        }
      } else {
        clearInterval(interval);
      }
    }, 2500);
    return json(res, { data: newSite });
  }

  // Get single site
  const siteMatch = urlPath.match(/^\/api\/sites\/([^/]+)$/);
  if (siteMatch && method === 'GET') {
    const site = createdSites.get(siteMatch[1]) || (siteMatch[1] === 'site-001' ? MOCK_SITE : null);
    if (site) return json(res, { data: site });
    return json(res, { error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }

  // Update site
  if (siteMatch && method === 'PATCH') {
    const body = await readBody(req);
    const site = createdSites.get(siteMatch[1]) || (siteMatch[1] === 'site-001' ? { ...MOCK_SITE } : null);
    if (!site) return json(res, { error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
    Object.assign(site, body, { updated_at: new Date().toISOString() });
    return json(res, { data: site });
  }

  // Delete site
  if (siteMatch && method === 'DELETE') {
    createdSites.delete(siteMatch[1]);
    return json(res, {});
  }

  // Reset site
  const resetMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/reset$/);
  if (resetMatch && method === 'POST') {
    const body = await readBody(req);
    const site = createdSites.get(resetMatch[1]) || { ...MOCK_SITE };
    site.status = 'building';
    site.business_name = body.business?.name || site.business_name;
    return json(res, { data: site });
  }

  // Workflow
  const workflowMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/workflow$/);
  if (workflowMatch && method === 'GET') {
    const site = createdSites.get(workflowMatch[1]);
    if (site) {
      const statusMap = { building: 1, generating: 3, uploading: 5, published: 6 };
      return json(res, { data: { status: site.status, steps_completed: statusMap[site.status] || 0, total_steps: 7 } });
    }
    return json(res, { data: { status: 'published', steps_completed: 7, total_steps: 7 } });
  }

  // Files
  const filesMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/files$/);
  if (filesMatch && method === 'GET') {
    return json(res, { data: { files: MOCK_FILES, prefix: 'sites/vitos-mens-salon/v1/', version: 'v1' } });
  }

  const fileMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/files\/(.+)$/);
  if (fileMatch && method === 'GET') {
    return json(res, { data: { content: MOCK_FILE_CONTENT } });
  }
  if (fileMatch && method === 'PUT') {
    return json(res, {});
  }
  if (fileMatch && method === 'DELETE') {
    return json(res, {});
  }

  // Deploy
  const deployMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/deploy$/);
  if (deployMatch && method === 'POST') {
    return json(res, { data: { message: 'Deployed successfully' } });
  }

  // Logs
  const logsMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/logs$/);
  if (logsMatch && method === 'GET') {
    const siteId = logsMatch[1];
    const site = createdSites.get(siteId);
    if (site && site._created_at) {
      // For newly created sites, drip-feed logs based on time elapsed
      const elapsed = Date.now() - site._created_at;
      const progressiveLogs = [];
      const t = (ms) => new Date(site._created_at + ms).toISOString();
      const id = (n) => `log-${siteId}-${n}`;

      progressiveLogs.push({ id: id(1), action: 'site.created_from_search', created_at: t(0), metadata_json: JSON.stringify({ slug: site.slug, message: 'Site created' }) });

      if (elapsed > 500) progressiveLogs.push({ id: id(2), action: 'workflow.started', created_at: t(500), metadata_json: JSON.stringify({ business_name: site.business_name, slug: site.slug, message: 'Workflow started' }) });

      if (elapsed > 1500) progressiveLogs.push({ id: id(3), action: 'workflow.step.profile_research_started', created_at: t(1500), metadata_json: JSON.stringify({ business_name: site.business_name, message: 'Researching business profile' }) });

      if (elapsed > 3500) progressiveLogs.push({ id: id(4), action: 'workflow.step.profile_research_complete', created_at: t(3500), metadata_json: JSON.stringify({ business_type: 'salon', services_count: 5, elapsed_ms: 2000, message: 'Profile research complete' }) });

      if (elapsed > 4000) progressiveLogs.push({ id: id(5), action: 'workflow.step.google_places_enriched', created_at: t(4000), metadata_json: JSON.stringify({ rating: 4.5, review_count: 42, photo_count: 8, message: 'Google Places data enriched' }) });

      if (elapsed > 4500) progressiveLogs.push({ id: id(6), action: 'workflow.step.parallel_research_started', created_at: t(4500), metadata_json: JSON.stringify({ steps: ['social', 'brand', 'USPs', 'images'], message: 'Starting parallel research' }) });

      if (elapsed > 7000) progressiveLogs.push({ id: id(7), action: 'workflow.step.parallel_research_complete', created_at: t(7000), metadata_json: JSON.stringify({ website_url: 'https://example.com', elapsed_ms: 2500, message: 'All research streams complete' }) });

      if (elapsed > 7500) progressiveLogs.push({ id: id(8), action: 'workflow.step.structure_plan_started', created_at: t(7500), metadata_json: JSON.stringify({ message: 'Planning site structure with GPT-4o-mini' }) });

      if (elapsed > 8500) progressiveLogs.push({ id: id(9), action: 'workflow.step.structure_plan_complete', created_at: t(8500), metadata_json: JSON.stringify({ page_count: 6, pages: ['index.html', 'about.html', 'services.html', 'contact.html', 'privacy.html', 'terms.html'], message: 'Structure planned: 6 pages' }) });

      if (elapsed > 9000) progressiveLogs.push({ id: id(10), action: 'workflow.step.multipage_generation_started', created_at: t(9000), metadata_json: JSON.stringify({ message: 'Generating all pages with GPT-4o' }) });

      if (elapsed > 12000) progressiveLogs.push({ id: id(11), action: 'workflow.step.multipage_generation_complete', created_at: t(12000), metadata_json: JSON.stringify({ file_count: 8, model_used: 'gpt-4o', total_size_kb: 156, message: 'Generated 8 files with gpt-4o' }) });

      if (elapsed > 12500) progressiveLogs.push({ id: id(12), action: 'workflow.step.legal_and_scoring_complete', created_at: t(12500), metadata_json: JSON.stringify({ quality_score: 82, model_used: 'gpt-4o', message: 'Quality gate passed · Score: 82/100' }) });

      if (elapsed > 13000) progressiveLogs.push({ id: id(13), action: 'workflow.step.optimization_started', created_at: t(13000), metadata_json: JSON.stringify({ message: 'Optimizing generated files' }) });

      if (elapsed > 13500) progressiveLogs.push({ id: id(14), action: 'workflow.step.upload_started', created_at: t(13500), metadata_json: JSON.stringify({ file_count: 10, message: 'Uploading 10 files to R2 CDN' }) });

      if (elapsed > 14500) progressiveLogs.push({ id: id(15), action: 'workflow.step.upload_to_r2_complete', created_at: t(14500), metadata_json: JSON.stringify({ version: '2026-03-18', slug: site.slug, file_count: 10, page_count: 6, model_used: 'gpt-4o', elapsed_ms: 1000, message: '10 files uploaded · Version: 2026-03-18' }) });

      if (elapsed > 15000) progressiveLogs.push({ id: id(16), action: 'workflow.completed', created_at: t(15000), metadata_json: JSON.stringify({ url: `https://${site.slug}.projectsites.dev`, quality_score: 82, model_used: 'gpt-4o', page_count: 6, total_seconds: 15, message: 'Site published · 6 pages · gpt-4o · 15s · Score: 82/100' }) });

      // Return newest first (like real API)
      return json(res, { data: progressiveLogs.reverse() });
    }
    return json(res, { data: MOCK_LOGS });
  }

  // Hostnames
  const hostnamesMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/hostnames$/);
  if (hostnamesMatch && method === 'GET') {
    return json(res, { data: MOCK_HOSTNAMES });
  }
  if (hostnamesMatch && method === 'POST') {
    const body = await readBody(req);
    return json(res, { data: { id: `hn-${Date.now()}`, hostname: body.hostname, status: 'pending', is_primary: false } });
  }

  const hostnameIdMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/hostnames\/([^/]+)$/);
  if (hostnameIdMatch && method === 'DELETE') {
    return json(res, {});
  }

  const primaryMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/hostnames\/([^/]+)\/primary$/);
  if (primaryMatch && method === 'PUT') {
    return json(res, {});
  }

  // Billing
  if (urlPath === '/api/billing/subscription' && method === 'GET') {
    return json(res, { data: { plan: 'paid', status: 'active' } });
  }
  if (urlPath === '/api/billing/entitlements' && method === 'GET') {
    return json(res, { data: { topBarHidden: true, maxCustomDomains: 5, chatEnabled: true, analyticsEnabled: true } });
  }
  if (urlPath === '/api/billing/portal' && method === 'POST') {
    return json(res, { data: { portal_url: 'https://billing.stripe.com/mock' } });
  }
  if (urlPath === '/api/billing/embedded-checkout' && method === 'POST') {
    return json(res, { data: { client_secret: 'cs_mock' } });
  }

  // Domain summary
  if (urlPath === '/api/admin/domains/summary' && method === 'GET') {
    return json(res, { data: { total: 2, active: 1, pending: 1, failed: 0 } });
  }

  // Slug check
  if (urlPath.startsWith('/api/slug/check') && method === 'GET') {
    return json(res, { data: { available: true } });
  }

  // Contact
  if (urlPath === '/api/contact' && method === 'POST') {
    return json(res, {});
  }

  // AI categorization
  // AI categorization with simulated web search — analyses name, types, address, and website
  if (urlPath === '/api/ai/categorize' && method === 'POST') {
    const body = await readBody(req);
    const name = (body.name || '').toLowerCase();
    const types = (body.types || []).join(' ').toLowerCase();
    const address = (body.address || '').toLowerCase();
    const website = (body.website || '').toLowerCase();
    const all = `${name} ${types} ${address} ${website}`;

    let category = 'Other';

    // Salon / Barbershop
    if (/salon|barber|hair|beauty|spa|grooming|nails|waxing/.test(all)) category = 'Salon / Barbershop';
    // Restaurant / Café
    else if (/restaurant|pizza|cafe|café|grill|diner|bistro|bakery|sushi|food|meal|kitchen|taco|burger|bbq|brew/.test(all)) category = 'Restaurant / Café';
    // Fitness / Gym (check before Medical — "gym" + "health" types should be Fitness, not Medical)
    else if (/fitness|gym|crossfit|yoga|pilates|workout|training|forge|martial/.test(all)) category = 'Fitness / Gym';
    // Medical / Healthcare
    else if (/dental|dentist|medical|healthcare|doctor|clinic|hospital|therapy|chiro|pharma|urgent/.test(all)) category = 'Medical / Healthcare';
    // Technology / SaaS
    else if (/tech|software|solution|digital|systems|cloud|app|saas|startup|cyber|data/.test(all)) category = 'Technology / SaaS';
    // Legal / Law Firm
    else if (/law|legal|attorney|counsel|lawyer|litigation|firm/.test(all)) category = 'Legal / Law Firm';
    // Photography / Creative
    else if (/photo|studio|creative|design|art|gallery|film|video|media/.test(all)) category = 'Photography / Creative';
    // Real Estate
    else if (/real.?estate|realt|properties|homes|mortgage|housing/.test(all)) category = 'Real Estate';
    // Construction / Home Services
    else if (/construct|plumb|electric|roofing|hvac|landscap|remodel|handyman|painting|flooring/.test(all)) category = 'Construction / Home Services';
    // Automotive
    else if (/auto|motor|car|tire|mechanic|body.?shop|dealer|repair.*car/.test(all)) category = 'Automotive';
    // Education / Tutoring
    else if (/school|tutor|academy|learning|education|university|college|preschool/.test(all)) category = 'Education / Tutoring';
    // Financial / Accounting
    else if (/account|tax|financial|invest|insurance|bank|wealth|cpa|bookkeep/.test(all)) category = 'Financial / Accounting';
    // Retail / Shop (includes delivery, courier, logistics, express services)
    else if (/shop|store|boutique|market|retail|outlet|emporium|express|deliver|courier|logistics|ship|택배|parcel|postal|freight/.test(all)) category = 'Retail / Shop';

    return json(res, { data: { category } });
  }

  // AI image discovery — simulates web search for logo, favicon, and images
  // In production this calls Google Custom Search, Clearbit Logo API, and website scraping
  if (urlPath === '/api/ai/discover-images' && method === 'POST') {
    const body = await readBody(req);
    const rawName = body.name || '';
    const name = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const website = (body.website || '').toLowerCase();
    const baseUrl = `http://localhost:${PORT}/mock-img`;

    // Helper: proxy external URLs through /api/image-proxy to avoid CORS issues
    const proxy = (externalUrl) => `http://localhost:${PORT}/api/image-proxy?url=${encodeURIComponent(externalUrl)}`;

    // Business-specific image discovery (simulates real web search results)
    // All URLs proxied through /api/image-proxy for CORS safety
    const knownBrands = {
      'the-white-house': {
        logo: { url: proxy('https://www.whitehouse.gov/wp-content/uploads/2021/01/wh_social-share.png'), name: 'white-house-logo.png', type: 'logo', source: 'website-scrape', quality: { quality_score: 90, is_professional: true, is_safe: true, description: 'Official White House social share image', recommendation: 'use_as_is', issues: [] } },
        favicon: { url: proxy('https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://www.whitehouse.gov&size=256'), name: 'white-house-favicon.png', type: 'favicon', source: 'google-favicon', quality: { quality_score: 85, is_professional: true, is_safe: true, description: 'White House favicon', recommendation: 'use_as_is', issues: [] }, dimensions: { width: 256, height: 256 } },
        images: [
          { url: proxy('https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/White_House_north_and_south_sides.jpg/800px-White_House_north_and_south_sides.jpg'), name: 'white-house-front.jpg', type: 'image', source: 'wikimedia', quality: { quality_score: 95, is_professional: true, is_safe: true, description: 'White House north facade', recommendation: 'use_as_is', issues: [] } },
          { url: proxy('https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/WhiteHouseSouthFacade.JPG/800px-WhiteHouseSouthFacade.JPG'), name: 'white-house-south.jpg', type: 'image', source: 'wikimedia', quality: { quality_score: 92, is_professional: true, is_safe: true, description: 'White House south facade', recommendation: 'use_as_is', issues: [] } },
          { url: proxy('https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/White_House_aerial_photo.jpg/800px-White_House_aerial_photo.jpg'), name: 'white-house-aerial.jpg', type: 'image', source: 'wikimedia', quality: { quality_score: 88, is_professional: true, is_safe: true, description: 'Aerial view of White House', recommendation: 'use_as_is', issues: [] } },
          { url: proxy('https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Seal_of_the_President_of_the_United_States.svg/480px-Seal_of_the_President_of_the_United_States.svg.png'), name: 'presidential-seal.png', type: 'image', source: 'wikimedia', quality: { quality_score: 85, is_professional: true, is_safe: true, description: 'Presidential seal', recommendation: 'use_as_is', issues: [] } },
        ],
        brand_assessment: { brand_maturity: 'established', website_quality_score: 95, asset_strategy: 'Use original brand assets as-is.', has_professional_logo: true, has_quality_favicon: true, recommendation: 'Recreate site faithful to existing brand with modern enhancements.' },
      },
      'when-doody-calls': {
        logo: { url: proxy('https://whendoodycalls.com/wp-content/uploads/2017/02/Web_Banner3.jpg'), name: 'whendoodycalls-logo.jpg', type: 'logo', source: 'website-scrape', quality: { quality_score: 45, is_professional: false, is_safe: true, description: 'Banner image with logo text and phone number overlay. Low resolution, dated design.', recommendation: 'use_as_inspiration', issues: ['Low resolution', 'Phone number on image', 'Dated design'] } },
        favicon: null,
        images: [
          { url: proxy('https://whendoodycalls.com/wp-content/uploads/2017/02/Web_Banner3.jpg'), name: 'when-doody-calls-banner.jpg', type: 'image', source: 'website-img', quality: { quality_score: 45, is_professional: false, is_safe: true, description: 'Company banner with logo, dog illustration, and phone number. Dated aesthetic but recognizable brand identity.', recommendation: 'use_as_inspiration', issues: ['Low resolution', 'Phone number overlay', 'Dated design'] } },
        ],
        brand_assessment: { brand_maturity: 'minimal', website_quality_score: 25, asset_strategy: 'Original assets are low quality. Use as inspiration only. Generate professional AI alternatives.', has_professional_logo: false, has_quality_favicon: false, recommendation: 'Create a gorgeous, modern site that reimagines the brand professionally.' },
      },
    };

    // Check if we have known brand data
    const brandKey = Object.keys(knownBrands).find(k => name.includes(k));
    if (brandKey) {
      return json(res, { data: knownBrands[brandKey] });
    }

    // Fallback: generate mock images based on name (simulates generic web search)
    return json(res, {
      data: {
        logo: {
          url: `${baseUrl}/${encodeURIComponent(name + '-logo')}`,
          name: `${name}-logo.png`,
          type: 'logo',
          source: 'web-search',
          quality: { quality_score: 70, is_professional: true, is_safe: true, description: 'Generic logo', recommendation: 'use_as_is', issues: [] },
        },
        favicon: {
          url: `${baseUrl}/${encodeURIComponent(name + '-icon')}`,
          name: `${name}-icon.png`,
          type: 'favicon',
          source: 'web-search',
          quality: { quality_score: 65, is_professional: true, is_safe: true, description: 'Generic favicon', recommendation: 'use_as_is', issues: [] },
          dimensions: { width: 256, height: 256 },
        },
        images: [
          { url: `${baseUrl}/${encodeURIComponent(name + '-hero')}`, name: `${name}-hero.jpg`, type: 'image', source: 'web-search', quality: { quality_score: 75, is_professional: true, is_safe: true, description: 'Hero image', recommendation: 'use_as_is', issues: [] } },
          { url: `${baseUrl}/${encodeURIComponent(name + '-storefront')}`, name: `${name}-storefront.jpg`, type: 'image', source: 'web-search', quality: { quality_score: 72, is_professional: true, is_safe: true, description: 'Storefront image', recommendation: 'use_as_is', issues: [] } },
          { url: `${baseUrl}/${encodeURIComponent(name + '-team')}`, name: `${name}-team.jpg`, type: 'image', source: 'web-search', quality: { quality_score: 68, is_professional: true, is_safe: true, description: 'Team photo', recommendation: 'use_as_is', issues: [] } },
        ],
        brand_assessment: null,
      },
    });
  }

  // Video discovery
  if (urlPath === '/api/ai/discover-videos' && method === 'POST') {
    const body = await readBody(req);
    const name = (body.name || '').toLowerCase();
    return json(res, {
      data: {
        videos: [
          {
            url: 'https://www.youtube.com/watch?v=mock-video-1',
            embed_url: 'https://www.youtube.com/embed/mock-video-1?autoplay=1&mute=1&loop=1',
            thumbnail: `http://localhost:${PORT}/mock-img/video-thumb-1`,
            title: `${body.name || 'Business'} Tour`,
            source: 'youtube',
            duration_seconds: 120,
            attribution: { author: 'Mock Channel', license: 'YouTube Standard License', source_url: 'https://www.youtube.com/watch?v=mock-video-1' },
            relevance: name.includes('trader') ? 'business_specific' : 'category_generic',
          },
          {
            url: 'https://www.pexels.com/video/mock-1/',
            embed_url: `http://localhost:${PORT}/mock-img/video-pexels-1`,
            thumbnail: `http://localhost:${PORT}/mock-img/video-pexels-thumb-1`,
            title: 'Stock footage',
            source: 'pexels',
            duration_seconds: 30,
            attribution: { author: 'Mock Photographer', license: 'Pexels License', source_url: 'https://www.pexels.com/video/mock-1/' },
            relevance: 'category_generic',
          },
        ],
        attribution: [
          { author: 'Mock Channel', license: 'YouTube Standard License', source_url: 'https://www.youtube.com/watch?v=mock-video-1' },
          { author: 'Mock Photographer', license: 'Pexels License', source_url: 'https://www.pexels.com/video/mock-1/' },
        ],
      },
    });
  }

  // Validate business
  if (urlPath === '/api/validate-business' && method === 'POST') {
    return json(res, { data: { valid: true } });
  }

  // Asset upload (multipart — mock just returns upload_id)
  if (urlPath === '/api/assets/upload' && method === 'POST') {
    return json(res, {
      data: {
        upload_id: 'upload-mock-' + Date.now(),
        assets: [
          { key: 'uploads/mock/logo/logo.png', name: 'logo.png', size: 45000, type: 'image/png', url: 'uploads/mock/logo/logo.png' },
        ],
      },
    });
  }

  // Build assets listing — drip-feeds progressively based on poll count
  const buildAssetsMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/build-assets$/);
  if (buildAssetsMatch && method === 'GET') {
    const siteId = buildAssetsMatch[1];
    if (!buildAssetPolls[siteId]) buildAssetPolls[siteId] = 0;
    buildAssetPolls[siteId]++;
    const pollCount = buildAssetPolls[siteId];

    const allAssets = [
      { key: 'assets/logo.png', name: 'logo.png', type: 'png', size: 45000, confidence: 85, source: 'generated' },
      { key: 'assets/icon-512.png', name: 'icon-512.png', type: 'png', size: 12000, confidence: 95, source: 'generated' },
      { key: 'assets/hero-main.png', name: 'hero-main.png', type: 'png', size: 210000, confidence: 80, source: 'generated' },
      { key: 'assets/hero-interior.png', name: 'hero-interior.png', type: 'png', size: 185000, confidence: 75, source: 'generated' },
      { key: 'assets/service-haircut.png', name: 'service-haircut.png', type: 'png', size: 95000, confidence: 70, source: 'generated' },
      { key: 'assets/service-shave.png', name: 'service-shave.png', type: 'png', size: 88000, confidence: 70, source: 'generated' },
      { key: 'assets/service-coloring.png', name: 'service-coloring.png', type: 'png', size: 91000, confidence: 65, source: 'generated' },
      { key: 'assets/team-photo.png', name: 'team-photo.png', type: 'png', size: 156000, confidence: 60, source: 'generated' },
      { key: 'assets/storefront.png', name: 'storefront.png', type: 'png', size: 175000, confidence: 55, source: 'discovered' },
      { key: 'assets/gallery-1.png', name: 'gallery-1.png', type: 'png', size: 120000, confidence: 45, source: 'discovered' },
    ];

    // Drip-feed: show 2 assets per poll, up to all 10
    const visibleCount = Math.min(pollCount * 2, allAssets.length);
    const visible = allAssets.slice(0, visibleCount).map((a) => ({
      ...a,
      url: `http://localhost:${PORT}/mock-img/${encodeURIComponent(a.name.replace('.png', ''))}`,
      uploaded: new Date(Date.now() - (allAssets.length - visibleCount) * 1000).toISOString(),
    }));

    return json(res, { data: visible });
  }

  // Files export (for bolt.diy AI Edit)
  const filesExportMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/files-export$/);
  if (filesExportMatch && method === 'GET') {
    return json(res, {
      data: {
        files: {
          'index.html': '<!DOCTYPE html><html><head><title>Mock Site</title></head><body><h1>Hello</h1></body></html>',
          'css/styles.css': 'body { margin: 0; font-family: sans-serif; }',
          'js/main.js': 'console.log("Hello world");',
        },
        prefix: 'sites/vitos-mens-salon/1/',
        version: '1',
      },
    });
  }

  // Publish from bolt.diy (files + chat) — also auto-creates a snapshot
  const publishBoltMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/publish-bolt$/);
  if (publishBoltMatch && method === 'POST') {
    const siteId = publishBoltMatch[1];
    const site = createdSites.get(siteId) || (siteId === 'site-001' ? MOCK_SITE : null);
    const slug = site?.slug || 'unknown';
    const snaps = siteSnapshots.get(siteId) || [];
    const editSnap = {
      id: 'snap-' + (++snapshotIdCounter),
      snapshot_name: 'edit-' + new Date().toISOString().slice(0, 16).replace(/[:.T]/g, '-'),
      build_version: String(snaps.length + 1),
      description: 'Published from AI editor',
      created_at: new Date().toISOString(),
    };
    snaps.push(editSnap);
    siteSnapshots.set(siteId, snaps);
    return json(res, {
      data: {
        slug,
        version: editSnap.build_version,
        url: `https://${slug}.projectsites.dev`,
      },
    });
  }

  // Dynamic chat export by slug — mirrors the real endpoint that reads files from R2
  // Includes realistic file types (text-only, binary files filtered out — matching production behavior)
  const chatBySlugMatch = urlPath.match(/^\/api\/sites\/by-slug\/([^/]+)\/chat$/);
  if (chatBySlugMatch && method === 'GET') {
    const chatSlug = chatBySlugMatch[1];
    const businessName = chatSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const now = new Date().toISOString();

    // Realistic mock files — text-only (binary files like .mp4, .png, .jpg are filtered by production endpoint)
    const mockFiles = [
      { path: 'index.html', content: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>' + businessName + '</title>\n<link rel="stylesheet" href="styles.css">\n</head>\n<body class="bg-gray-900 text-white">\n<nav class="fixed top-0 w-full bg-black/80 p-4">\n<a href="index.html">' + businessName + '</a>\n<a href="about.html">About</a>\n<a href="services.html">Services</a>\n<a href="contact.html">Contact</a>\n</nav>\n<main class="pt-20">\n<section class="min-h-screen flex items-center justify-center">\n<h1 class="text-5xl font-bold">' + businessName + '</h1>\n<p>Welcome to our website</p>\n</section>\n</main>\n<footer class="p-8 text-center text-gray-500">&copy; 2026 ' + businessName + '</footer>\n<script src="main.js"></script>\n</body>\n</html>' },
      { path: 'about.html', content: '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>About - ' + businessName + '</title><link rel="stylesheet" href="styles.css"></head><body class="bg-gray-900 text-white"><h1>About ' + businessName + '</h1><p>Learn more about our story.</p></body></html>' },
      { path: 'services.html', content: '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"><title>Services - ' + businessName + '</title><link rel="stylesheet" href="styles.css"></head><body class="bg-gray-900 text-white"><h1>Our Services</h1><ul><li>Service 1</li><li>Service 2</li></ul></body></html>' },
      { path: 'contact.html', content: '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"><title>Contact - ' + businessName + '</title><link rel="stylesheet" href="styles.css"></head><body class="bg-gray-900 text-white"><h1>Contact</h1><form action="/api/contact" method="POST"><input name="name" placeholder="Name" required><input name="email" type="email" placeholder="Email" required><textarea name="message" placeholder="Message" required></textarea><button type="submit">Send</button></form></body></html>' },
      { path: 'styles.css', content: ':root {\n  --bg-primary: #0a0a1a;\n  --accent: #64ffda;\n  --text: #e0e0e0;\n}\nbody { font-family: Inter, sans-serif; background: var(--bg-primary); color: var(--text); margin: 0; }\nnav { display: flex; gap: 1rem; }\nnav a { color: var(--accent); text-decoration: none; }\nfooter { border-top: 1px solid rgba(100,255,218,0.1); }' },
      { path: 'main.js', content: '// ' + businessName + ' website scripts\ndocument.addEventListener("DOMContentLoaded", () => {\n  console.log("' + businessName + ' loaded");\n});' },
      { path: 'robots.txt', content: 'User-agent: *\nAllow: /\n\nSitemap: https://' + chatSlug + '.projectsites.dev/sitemap.xml' },
      { path: 'sitemap.xml', content: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>https://' + chatSlug + '.projectsites.dev/</loc></url>\n<url><loc>https://' + chatSlug + '.projectsites.dev/about.html</loc></url>\n<url><loc>https://' + chatSlug + '.projectsites.dev/services.html</loc></url>\n<url><loc>https://' + chatSlug + '.projectsites.dev/contact.html</loc></url>\n</urlset>' },
      { path: 'package.json', content: '{"name":"' + chatSlug + '","version":"1.0.0","private":true}' },
    ];

    const fileActions = mockFiles.map((f) =>
      '<boltAction type="file" filePath="' + f.path + '">\n' + f.content + '\n</boltAction>'
    );

    const assistantContent = 'I\'ve built a professional website for ' + businessName + ' with ' + mockFiles.length + ' files.\n\n' +
      '<boltArtifact id="site-' + chatSlug + '" title="' + businessName + ' Website">\n' +
      fileActions.join('\n') + '\n' +
      '</boltArtifact>';

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    return res.end(JSON.stringify({
      messages: [
        { id: 'msg-user-' + chatSlug, role: 'user', content: 'Build a professional website for ' + businessName, createdAt: now },
        { id: 'msg-asst-' + chatSlug, role: 'assistant', content: assistantContent, createdAt: now },
      ],
      description: businessName + ' Website',
      exportDate: now,
    }));
  }

  // File listing endpoint — returns metadata without content
  const filesBySlugMatch = urlPath.match(/^\/api\/sites\/by-slug\/([^/]+)\/files$/);
  if (filesBySlugMatch && method === 'GET') {
    const fileSlug = filesBySlugMatch[1];
    const mockFileList = [
      { path: 'index.html', size: 1024, etag: '"abc123"', extension: '.html' },
      { path: 'about.html', size: 512, etag: '"abc124"', extension: '.html' },
      { path: 'services.html', size: 480, etag: '"abc125"', extension: '.html' },
      { path: 'contact.html', size: 620, etag: '"abc126"', extension: '.html' },
      { path: 'styles.css', size: 340, etag: '"abc127"', extension: '.css' },
      { path: 'main.js', size: 128, etag: '"abc128"', extension: '.js' },
      { path: 'robots.txt', size: 80, etag: '"abc129"', extension: '.txt' },
      { path: 'sitemap.xml', size: 420, etag: '"abc130"', extension: '.xml' },
      { path: 'package.json', size: 64, etag: '"abc131"', extension: '.json' },
      { path: 'images/hero.jpg', size: 245000, etag: '"img001"', extension: '.jpg' },
      { path: 'images/logo.png', size: 32000, etag: '"img002"', extension: '.png' },
      { path: 'videos/intro.mp4', size: 5200000, etag: '"vid001"', extension: '.mp4' },
    ];
    return json(res, {
      slug: fileSlug,
      version: 'v1-mock',
      fileCount: mockFileList.length,
      files: mockFileList,
    });
  }

  // Generate prompt (AI research pipeline)
  if (urlPath === '/api/sites/generate-prompt' && method === 'POST') {
    return json(res, {
      data: {
        prompt: 'Create a modern, gorgeous, animated website for Vito\'s Mens Salon...',
        research: {
          profile: { business_type: 'salon', description: 'A premium mens salon' },
          brand: { primary_color: '#1a1a2e', accent_color: '#e94560' },
        },
      },
    });
  }

  // ─── Snapshots (stateful per-site) ──────────────

  const snapshotsMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/snapshots$/);
  if (snapshotsMatch && method === 'GET') {
    const siteId = snapshotsMatch[1];
    const snaps = siteSnapshots.get(siteId) || [];
    // Return newest first
    return json(res, { data: [...snaps].reverse() });
  }
  if (snapshotsMatch && method === 'POST') {
    const siteId = snapshotsMatch[1];
    const body = await readBody(req);
    const snaps = siteSnapshots.get(siteId) || [];
    const newSnap = {
      id: 'snap-' + (++snapshotIdCounter),
      snapshot_name: body.name || 'snapshot',
      build_version: String(snaps.length + 1),
      description: body.description || null,
      created_at: new Date().toISOString(),
    };
    snaps.push(newSnap);
    siteSnapshots.set(siteId, snaps);
    return json(res, { data: newSnap });
  }

  const snapshotDeleteMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/snapshots\/([^/]+)$/);
  if (snapshotDeleteMatch && method === 'DELETE') {
    const siteId = snapshotDeleteMatch[1];
    const snapId = snapshotDeleteMatch[2];
    const snaps = siteSnapshots.get(siteId) || [];
    siteSnapshots.set(siteId, snaps.filter(s => s.id !== snapId));
    return json(res, {});
  }

  const snapshotRevertMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/snapshots\/revert$/);
  if (snapshotRevertMatch && method === 'POST') {
    const siteId = snapshotRevertMatch[1];
    const body = await readBody(req);
    const snaps = siteSnapshots.get(siteId) || [];
    const target = snaps.find(s => s.id === body.snapshot_id);
    if (!target) return json(res, { error: { code: 'NOT_FOUND', message: 'Snapshot not found' } }, 404);
    // Revert creates a new snapshot with the old name + "-restored"
    const revertedSnap = {
      id: 'snap-' + (++snapshotIdCounter),
      snapshot_name: target.snapshot_name + '-restored',
      build_version: String(snaps.length + 1),
      description: `Reverted to ${target.snapshot_name}`,
      created_at: new Date().toISOString(),
    };
    snaps.push(revertedSnap);
    siteSnapshots.set(siteId, snaps);
    return json(res, { data: { message: 'Reverted successfully', snapshot_name: target.snapshot_name } });
  }

  // ─── Analytics ──────────────────────────────────

  const analyticsMatch = urlPath.match(/^\/api\/analytics\/([^/]+)$/);
  if (analyticsMatch && method === 'GET') {
    return json(res, { data: {
      pageviews: 1234, unique_visitors: 567, bounce_rate: 42.5,
      avg_session_duration: 125,
      top_pages: [{ path: '/', views: 800 }, { path: '/about', views: 234 }, { path: '/services', views: 200 }],
      daily: [
        { date: '2026-04-14', pageviews: 180, visitors: 85 },
        { date: '2026-04-15', pageviews: 165, visitors: 78 },
        { date: '2026-04-16', pageviews: 210, visitors: 98 },
        { date: '2026-04-17', pageviews: 195, visitors: 90 },
        { date: '2026-04-18', pageviews: 220, visitors: 105 },
        { date: '2026-04-19', pageviews: 145, visitors: 68 },
        { date: '2026-04-20', pageviews: 119, visitors: 43 },
      ],
    } });
  }

  // ─── Notifications ──────────────────────────────

  if (urlPath === '/api/notifications' && method === 'GET') {
    return json(res, { data: [
      { id: 'notif-001', type: 'build_complete', message: 'Your site vitos-mens-salon is live!', read: false, created_at: '2026-04-20T15:30:00Z' },
      { id: 'notif-002', type: 'domain_verified', message: 'Domain www.vitos-salon.com verified', read: true, created_at: '2026-04-19T10:00:00Z' },
    ] });
  }

  const notifReadMatch = urlPath.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (notifReadMatch && method === 'PATCH') {
    return json(res, {});
  }

  if (urlPath === '/api/notifications/read-all' && method === 'POST') {
    return json(res, {});
  }

  // ─── Feedback ──────────────────────────────────

  if (urlPath === '/api/feedback' && method === 'GET') {
    return json(res, { data: [] });
  }
  if (urlPath === '/api/feedback' && method === 'POST') {
    return json(res, { data: { id: 'fb-' + Date.now() } });
  }

  // ─── Changelog ──────────────────────────────────

  if (urlPath === '/api/changelog' && method === 'GET') {
    return json(res, { data: [
      { id: 'cl-001', title: 'Multi-page AI generation', description: 'Sites now generate 5-8 gorgeous pages with shadcn/ui components.', created_at: '2026-04-15T00:00:00Z' },
      { id: 'cl-002', title: 'Snapshot system', description: 'Create and revert to snapshots of your site.', created_at: '2026-04-10T00:00:00Z' },
    ] });
  }

  // ─── Google OAuth (mock redirect) ──────────────

  if (urlPath === '/api/auth/google' && method === 'GET') {
    res.writeHead(302, { Location: '/?token=mock-token-123&email=test@example.com&auth_callback=1' });
    res.end();
    return;
  }

  // ─── GitHub OAuth (mock redirect) ─────────────

  if (urlPath === '/api/auth/github' && method === 'GET') {
    res.writeHead(302, { Location: '/?token=mock-gh-token-456&email=dev@github.com&auth_callback=1' });
    res.end();
    return;
  }

  // ─── Contact form submissions (per-site) ──────

  const submissionsMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/submissions$/);
  if (submissionsMatch && method === 'GET') {
    return json(res, { data: [
      { id: 'sub-001', name: 'Jane Doe', email: 'jane@example.com', phone: '555-0101', message: 'I want to book an appointment for Saturday', created_at: '2026-04-20T10:00:00Z', read: false },
      { id: 'sub-002', name: 'Bob Smith', email: 'bob@example.com', phone: '', message: 'Do you offer group discounts?', created_at: '2026-04-19T14:30:00Z', read: true },
      { id: 'sub-003', name: 'Alice Chen', email: 'alice@example.com', phone: '555-0303', message: 'Great website! Love the new design.', created_at: '2026-04-18T09:15:00Z', read: true },
    ] });
  }

  // ─── Social links save ────────────────────────

  const socialMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/social$/);
  if (socialMatch && method === 'PATCH') {
    return json(res, { data: { saved: true } });
  }

  // ─── Integrations save ────────────────────────

  const integrationsMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/integrations$/);
  if (integrationsMatch && method === 'PATCH') {
    return json(res, { data: { saved: true } });
  }

  // ─── Email routing config ─────────────────────

  const emailRoutingMatch = urlPath.match(/^\/api\/sites\/([^/]+)\/email\/routing$/);
  if (emailRoutingMatch && method === 'GET') {
    return json(res, { data: { enabled: false, forwarding_address: null, catch_all: false, rules: [] } });
  }
  if (emailRoutingMatch && method === 'POST') {
    const body = await readBody(req);
    return json(res, { data: { enabled: true, forwarding_address: body.forwarding_address || 'owner@example.com', catch_all: body.catch_all || false, rules: [{ from: 'contact@', to: body.forwarding_address }] } });
  }

  // ─── Domain search ────────────────────────────

  if (urlPath === '/api/domains/search' && method === 'GET') {
    const q = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('q') || 'example';
    return json(res, { data: [
      { domain: `${q}.com`, available: true, price: '$12.99/yr' },
      { domain: `${q}.dev`, available: true, price: '$15.99/yr' },
      { domain: `${q}.io`, available: false, price: null },
    ] });
  }

  // ─── AI image edit ──────────────────────────────

  if (urlPath === '/api/ai/edit-image' && method === 'POST') {
    return json(res, { data: { url: `http://localhost:${PORT}/mock-img/ai-edited-${Date.now()}` } });
  }

  // ─── Site deletion with options ─────────────────

  const deleteSiteOptionsMatch = urlPath.match(/^\/api\/sites\/([^/]+)$/);
  if (deleteSiteOptionsMatch && method === 'DELETE') {
    createdSites.delete(deleteSiteOptionsMatch[1]);
    return json(res, {});
  }

  // Fallback
  json(res, { error: { code: 'NOT_FOUND', message: `No mock for ${method} ${urlPath}` } }, 404);
}

// ─── Server ────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const urlPath = url.pathname;

  // Health endpoint (not under /api/)
  if (urlPath === '/health' && req.method === 'GET') {
    return json(res, { status: 'ok', version: '1.0.0', timestamp: new Date().toISOString(), kv_latency_ms: 2, r2_latency_ms: 3 });
  }

  // API routes
  if (urlPath.startsWith('/api/') || urlPath.startsWith('/webhooks/')) {
    return handleAPI(req, res, urlPath);
  }

  // CORS image proxy — fetches external images and serves them with proper headers
  if (urlPath.startsWith('/api/image-proxy')) {
    const imageUrl = url.searchParams.get('url');
    if (!imageUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }
    try {
      const https = require('https');
      const http2 = require('http');
      const fetcher = imageUrl.startsWith('https') ? https : http2;
      fetcher.get(imageUrl, { headers: { 'User-Agent': 'ProjectSites/1.0' } }, (proxyRes) => {
        const ct = proxyRes.headers['content-type'] || 'image/png';
        res.writeHead(200, {
          'Content-Type': ct,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400',
        });
        proxyRes.pipe(res);
      }).on('error', () => {
        // On fetch error, serve a placeholder SVG instead
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#1a1a2e"/><text x="100" y="100" text-anchor="middle" fill="#64ffda" font-size="12">Image</text></svg>`;
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Access-Control-Allow-Origin': '*' });
        res.end(svg);
      });
    } catch {
      res.writeHead(500);
      res.end('Proxy error');
    }
    return;
  }

  // Mock placeholder images for build assets
  if (urlPath.startsWith('/mock-img/')) {
    const label = decodeURIComponent(urlPath.replace('/mock-img/', '')).replace(/-/g, ' ');
    const colors = ['#1a1a2e', '#16213e', '#0f3460', '#533483', '#2b2d42', '#1b263b', '#283618', '#3c1642', '#0b1622', '#1a1423'];
    const accents = ['#e94560', '#64ffda', '#7c3aed', '#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#06b6d4', '#a855f7', '#ef4444'];
    const idx = Math.abs([...label].reduce((a, c) => a + c.charCodeAt(0), 0)) % colors.length;
    const bg = colors[idx];
    const accent = accents[idx];
    const w = 400;
    const h = label.includes('hero') ? 250 : label.includes('logo') || label.includes('icon') ? 300 : 300;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${bg}"/>
          <stop offset="100%" style="stop-color:${accent}20"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <circle cx="${w * 0.5}" cy="${h * 0.38}" r="${Math.min(w, h) * 0.15}" fill="${accent}30" stroke="${accent}" stroke-width="2"/>
      <text x="${w / 2}" y="${h * 0.72}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" font-weight="700" fill="${accent}">${label.substring(0, 30)}</text>
      <text x="${w / 2}" y="${h * 0.82}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#ffffff60">AI Generated</text>
    </svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
    res.end(svg);
    return;
  }

  // Mock bolt.diy editor page — serves a minimal page that implements PS_ postMessage protocol
  if (urlPath === '/mock-editor' || urlPath.startsWith('/mock-editor/')) {
    const html = `<!DOCTYPE html>
<html><head><title>Mock Bolt Editor</title></head>
<body style="margin:0;background:#0a0a1a;color:#fff;font-family:sans-serif;padding:20px">
<div id="status">Editor loading...</div>
<div id="files" style="margin-top:20px;font-size:12px;color:#64748b"></div>
<script>
  // Notify parent that editor is ready
  setTimeout(function() {
    document.getElementById('status').textContent = 'Editor ready';
    window.parent.postMessage({ type: 'PS_BOLT_READY' }, '*');
  }, 500);

  // Listen for file requests from parent
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'PS_REQUEST_FILES') {
      // Return mock files after a short delay
      setTimeout(function() {
        window.parent.postMessage({
          type: 'PS_FILES_READY',
          correlationId: e.data.correlationId,
          files: {
            '/home/project/index.html': '<!DOCTYPE html><html><head><title>Edited Site</title></head><body><h1>Hello World - Edited!</h1><p>This content was modified in the AI editor.</p></body></html>',
            '/home/project/css/styles.css': 'body { margin: 0; font-family: sans-serif; background: #0a0a1a; color: #fff; }',
            '/home/project/js/main.js': 'document.addEventListener("DOMContentLoaded", function() { console.warn("Site loaded"); });'
          },
          chat: {
            messages: [
              { id: 'msg-1', role: 'user', content: 'Edit the heading', createdAt: new Date().toISOString() },
              { id: 'msg-2', role: 'assistant', content: 'I updated the heading to Hello World - Edited!', createdAt: new Date().toISOString() }
            ],
            description: 'Edited site',
            exportDate: new Date().toISOString()
          }
        }, '*');
      }, 300);
    }
    if (e.data && e.data.type === 'PS_SUBMIT_PROMPT') {
      document.getElementById('status').textContent = 'Generating...';
      setTimeout(function() {
        document.getElementById('status').textContent = 'Generation complete';
        window.parent.postMessage({ type: 'PS_GENERATION_STATUS', status: 'complete' }, '*');
      }, 1000);
    }
  });
</script>
</body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
    res.end(html);
    return;
  }

  // Static files
  let filePath = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath);
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.warn(`E2E mock server running at http://localhost:${PORT}`);
});
