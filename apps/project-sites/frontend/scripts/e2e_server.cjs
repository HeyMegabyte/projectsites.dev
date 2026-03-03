/**
 * E2E test server for the Angular frontend.
 *
 * Serves built Angular files from dist/project-sites-frontend/browser/
 * and mocks all API endpoints for local/CI testing.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.E2E_PORT) || 4300;
const DIST_DIR = path.join(__dirname, '..', 'dist', 'project-sites-frontend', 'browser');
const MAX_BODY = 256 * 1024;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status);
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY + 1024) {
        reject(new Error('TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** In-memory stores */
const workflows = {};
const sessions = {};
const sites = {};

/** Mock sites for admin */
const MOCK_SITES = [
  {
    id: 'site-1',
    business_name: "Vito's Mens Salon",
    business_address: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
    slug: 'vitos-mens-salon',
    status: 'published',
    plan: 'free',
    place_id: 'ChIJ_vitos',
    primary_hostname: null,
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T12:00:00Z',
  },
  {
    id: 'site-2',
    business_name: 'Best Pizza NYC',
    business_address: '456 Oak Ave, Brooklyn, NY',
    slug: 'best-pizza-nyc',
    status: 'building',
    plan: 'free',
    place_id: 'ChIJ_pizza',
    primary_hostname: null,
    created_at: '2026-02-01T08:00:00Z',
    updated_at: '2026-02-01T08:30:00Z',
  },
];

const MOCK_HOSTNAMES = {
  'site-1': [
    { id: 'hn-1', hostname: 'vitossalon.com', status: 'active', is_primary: true, created_at: '2026-01-20T10:00:00Z' },
    { id: 'hn-2', hostname: 'www.vitossalon.com', status: 'pending', is_primary: false, created_at: '2026-01-20T10:05:00Z' },
  ],
  'site-2': [],
};

const MOCK_LOGS = {
  'site-1': [
    { action: 'site.created', created_at: '2026-01-15T10:00:00Z', metadata_json: null },
    { action: 'workflow.started', created_at: '2026-01-15T10:01:00Z', metadata_json: null },
    { action: 'workflow.completed', created_at: '2026-01-15T10:12:00Z', metadata_json: null },
    { action: 'hostname.added', created_at: '2026-01-20T10:00:00Z', metadata_json: '{"hostname":"vitossalon.com"}' },
  ],
  'site-2': [
    { action: 'site.created', created_at: '2026-02-01T08:00:00Z', metadata_json: null },
    { action: 'workflow.started', created_at: '2026-02-01T08:01:00Z', metadata_json: null },
  ],
};

const MOCK_FILES = {
  'site-1': [
    { path: 'index.html', content: '<html><body><h1>Vitos Salon</h1></body></html>', size: 50 },
    { path: 'styles/main.css', content: 'body { font-family: sans-serif; }', size: 35 },
    { path: 'privacy.html', content: '<html><body><h1>Privacy</h1></body></html>', size: 48 },
  ],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);

  // ─── Health ───────────────────────────────────────────
  if (pathname === '/health' && method === 'GET') {
    return sendJson(res, 200, { status: 'ok', environment: 'e2e-test' });
  }

  // ─── Search businesses ────────────────────────────────
  if (pathname === '/api/search/businesses' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (q.length < 2) {
      return sendJson(res, 200, { data: [] });
    }
    return sendJson(res, 200, {
      data: [
        { place_id: 'ChIJ_mock_1', name: `${q} Pizza`, address: '123 Main St, New York, NY', types: ['restaurant'], lat: 40.7128, lng: -74.006 },
        { place_id: 'ChIJ_mock_2', name: `${q} Plumbing`, address: '456 Oak Ave, Brooklyn, NY', types: ['plumber'], lat: 40.6782, lng: -73.9442 },
      ],
    });
  }

  // ─── Sites search ─────────────────────────────────────
  if (pathname === '/api/sites/search' && method === 'GET') {
    return sendJson(res, 200, { data: [] });
  }

  // ─── Site lookup ──────────────────────────────────────
  if (pathname === '/api/sites/lookup' && method === 'GET') {
    return sendJson(res, 200, { data: null });
  }

  // ─── Auth: magic link ─────────────────────────────────
  if (pathname === '/api/auth/magic-link' && method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'Invalid email address' } });
    }
    const token = 'e2e-token-' + crypto.randomUUID();
    sessions[token] = { email: body.email, userId: 'user-e2e-1', orgId: 'org-e2e-1' };
    return sendJson(res, 200, { data: { token, expires_at: new Date(Date.now() + 600000).toISOString() } });
  }

  // ─── Auth: google ─────────────────────────────────────
  if (pathname === '/api/auth/google' && method === 'GET') {
    return sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'OAuth not configured in E2E' } });
  }

  // ─── Auth: contact form ───────────────────────────────
  if (pathname === '/api/contact' && method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
    if (!body.name || !body.email || !body.message) {
      return sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'All fields required' } });
    }
    return sendJson(res, 200, { data: { success: true } });
  }

  // ─── Auth gate check ──────────────────────────────────
  const authHeader = req.headers['authorization'];
  const isAuthed = authHeader && authHeader.startsWith('Bearer ') && sessions[authHeader.slice(7)];

  // ─── Auth: me ──────────────────────────────────────────
  if (pathname === '/api/auth/me' && method === 'GET') {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    const session = sessions[authHeader.slice(7)];
    return sendJson(res, 200, { data: { id: session.userId, email: session.email, org_id: session.orgId } });
  }

  // ─── Create from search ───────────────────────────────
  if (pathname === '/api/sites/create-from-search' && method === 'POST') {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
    const name = (body.business && body.business.name) || body.business_name || 'custom-site';
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 63);
    const siteId = 'site-e2e-' + crypto.randomUUID();

    workflows[siteId] = { status: 'running', steps: ['research-profile'], createdAt: Date.now() };
    setTimeout(() => { if (workflows[siteId]) workflows[siteId].steps.push('research-social', 'research-brand'); }, 2000);
    setTimeout(() => { if (workflows[siteId]) workflows[siteId].steps.push('generate-website'); }, 4000);
    setTimeout(() => { if (workflows[siteId]) { workflows[siteId].steps.push('upload-to-r2', 'update-site-status'); workflows[siteId].status = 'complete'; } }, 6000);

    return sendJson(res, 201, { data: { site_id: siteId, slug, status: 'building', workflow_instance_id: 'wf-' + siteId } });
  }

  // ─── List sites ───────────────────────────────────────
  if (pathname === '/api/sites' && method === 'GET') {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    return sendJson(res, 200, { data: MOCK_SITES });
  }

  // ─── Get single site ─────────────────────────────────
  const siteMatch = pathname.match(/^\/api\/sites\/([^/]+)$/);
  if (siteMatch && method === 'GET') {
    const siteId = siteMatch[1];
    const found = MOCK_SITES.find((s) => s.id === siteId);
    if (found) return sendJson(res, 200, { data: found });
    const wf = workflows[siteId];
    if (wf) return sendJson(res, 200, { data: { id: siteId, slug: 'new-site', status: wf.status === 'complete' ? 'published' : 'building' } });
    return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Site not found' } });
  }

  // ─── Update site ──────────────────────────────────────
  const siteUpdateMatch = pathname.match(/^\/api\/sites\/([^/]+)$/);
  if (siteUpdateMatch && (method === 'PATCH' || method === 'PUT')) {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
    const found = MOCK_SITES.find((s) => s.id === siteUpdateMatch[1]);
    if (found) {
      Object.assign(found, body);
      return sendJson(res, 200, { data: found });
    }
    return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Site not found' } });
  }

  // ─── Delete site ──────────────────────────────────────
  const siteDeleteMatch = pathname.match(/^\/api\/sites\/([^/]+)$/);
  if (siteDeleteMatch && method === 'DELETE') {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    return sendJson(res, 200, { data: { success: true } });
  }

  // ─── Reset site ───────────────────────────────────────
  const resetMatch = pathname.match(/^\/api\/sites\/([^/]+)\/reset$/);
  if (resetMatch && method === 'POST') {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    return sendJson(res, 200, { data: { site_id: resetMatch[1], status: 'building' } });
  }

  // ─── Workflow status ──────────────────────────────────
  const wfMatch = pathname.match(/^\/api\/sites\/([^/]+)\/workflow$/);
  if (wfMatch && method === 'GET') {
    const siteId = wfMatch[1];
    const wf = workflows[siteId];
    if (wf) {
      return sendJson(res, 200, {
        data: {
          status: wf.status,
          current_step: wf.steps[wf.steps.length - 1],
          steps: wf.steps.map((s) => ({ name: s, status: wf.status === 'complete' ? 'completed' : 'running' })),
          error: null,
        },
      });
    }
    // For mock sites, return a completed workflow
    return sendJson(res, 200, {
      data: {
        status: 'complete',
        current_step: 'update-site-status',
        steps: [
          { name: 'research-profile', status: 'completed' },
          { name: 'generate-website', status: 'completed' },
          { name: 'upload-to-r2', status: 'completed' },
        ],
        error: null,
      },
    });
  }

  // ─── Deploy ZIP ───────────────────────────────────────
  const deployMatch = pathname.match(/^\/api\/sites\/([^/]+)\/deploy$/);
  if (deployMatch && method === 'POST') {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    return sendJson(res, 200, { data: { success: true } });
  }

  // ─── Hostnames ────────────────────────────────────────
  const hostnamesMatch = pathname.match(/^\/api\/sites\/([^/]+)\/hostnames$/);
  if (hostnamesMatch && method === 'GET') {
    const siteId = hostnamesMatch[1];
    return sendJson(res, 200, { data: MOCK_HOSTNAMES[siteId] || [] });
  }
  if (hostnamesMatch && method === 'POST') {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
    const newHostname = {
      id: 'hn-' + crypto.randomUUID().substring(0, 8),
      hostname: body.hostname || 'example.com',
      status: 'pending',
      is_primary: false,
      created_at: new Date().toISOString(),
    };
    const siteId = hostnamesMatch[1];
    if (!MOCK_HOSTNAMES[siteId]) MOCK_HOSTNAMES[siteId] = [];
    MOCK_HOSTNAMES[siteId].push(newHostname);
    return sendJson(res, 201, { data: newHostname });
  }

  // ─── Hostname actions (set primary, delete) ───────────
  const hostnameActionMatch = pathname.match(/^\/api\/sites\/([^/]+)\/hostnames\/([^/]+)$/);
  if (hostnameActionMatch && method === 'DELETE') {
    return sendJson(res, 200, { data: { success: true } });
  }
  const hostnamePrimaryMatch = pathname.match(/^\/api\/sites\/([^/]+)\/hostnames\/([^/]+)\/primary$/);
  if (hostnamePrimaryMatch && method === 'POST') {
    return sendJson(res, 200, { data: { success: true } });
  }

  // ─── Files ────────────────────────────────────────────
  const filesMatch = pathname.match(/^\/api\/sites\/([^/]+)\/files$/);
  if (filesMatch && method === 'GET') {
    const siteId = filesMatch[1];
    return sendJson(res, 200, { data: MOCK_FILES[siteId] || [] });
  }
  const fileUpdateMatch = pathname.match(/^\/api\/sites\/([^/]+)\/files\/(.+)$/);
  if (fileUpdateMatch && (method === 'PUT' || method === 'POST')) {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
    return sendJson(res, 200, { data: { path: fileUpdateMatch[2] || body.path, content: body.content || '', size: (body.content || '').length } });
  }

  // ─── Logs ─────────────────────────────────────────────
  const logsMatch = pathname.match(/^\/api\/sites\/([^/]+)\/logs$/);
  if (logsMatch && method === 'GET') {
    const siteId = logsMatch[1];
    return sendJson(res, 200, { data: MOCK_LOGS[siteId] || [] });
  }

  // ─── Audit logs ───────────────────────────────────────
  if (pathname === '/api/audit-logs' && method === 'GET') {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    return sendJson(res, 200, { data: [] });
  }

  // ─── Domain summary ────────────────────────────────────
  if (pathname === '/api/admin/domains/summary' && method === 'GET') {
    return sendJson(res, 200, { data: { total: 2, active: 1, pending: 1, failed: 0 } });
  }

  // ─── Billing ──────────────────────────────────────────
  if (pathname === '/api/billing/checkout' && method === 'POST') {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    return sendJson(res, 200, { data: { client_secret: 'cs_test_mock', session_id: 'cs_mock_1' } });
  }
  if (pathname === '/api/billing/subscription' && method === 'GET') {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    return sendJson(res, 200, { data: { status: 'active', plan: 'free' } });
  }
  if (pathname === '/api/billing/portal' && method === 'POST') {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    return sendJson(res, 200, { data: { portal_url: 'https://billing.stripe.com/mock-portal' } });
  }

  // ─── Webhooks ─────────────────────────────────────────
  if (pathname === '/webhooks/stripe' && method === 'POST') {
    return sendJson(res, 401, { error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Invalid signature' } });
  }

  // ─── Slug check ─────────────────────────────────────
  if (pathname === '/api/slug/check' && method === 'GET') {
    return sendJson(res, 200, { data: { available: true } });
  }

  // ─── Address search ─────────────────────────────────
  if (pathname === '/api/search/address' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    return sendJson(res, 200, {
      data: q.length >= 2
        ? [{ description: `${q}, New York, NY`, place_id: 'ChIJ_addr_1' }]
        : [],
    });
  }

  // ─── Validate business ─────────────────────────────
  if (pathname === '/api/validate-business' && method === 'POST') {
    return sendJson(res, 200, { data: { valid: true } });
  }

  // ─── Embedded checkout ─────────────────────────────
  if (pathname === '/api/billing/embedded-checkout' && method === 'POST') {
    if (!isAuthed) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } });
    return sendJson(res, 200, { data: { client_secret: 'cs_test_mock_secret' } });
  }

  // ─── Unknown API routes ───────────────────────────────
  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
  }

  // ─── Static file serving from Angular build ───────────
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(DIST_DIR, 'index.html');
  } else {
    filePath = path.join(DIST_DIR, pathname);
  }

  // Prevent directory traversal
  if (!filePath.startsWith(DIST_DIR)) {
    return sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'Access denied' } });
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      const content = fs.readFileSync(filePath);
      res.setHeader('Content-Type', getContentType(filePath));
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.writeHead(200);
      res.end(content);
      return;
    }
  } catch {
    // fall through
  }

  // SPA fallback: serve index.html for Angular routes
  try {
    const content = fs.readFileSync(path.join(DIST_DIR, 'index.html'));
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(content);
  } catch {
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Frontend not built. Run npm run build:prod first.' } });
  }
});

server.listen(PORT, () => {
  console.warn(`Angular E2E server running at http://localhost:${PORT}`);
});

process.on('SIGINT', () => { server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
