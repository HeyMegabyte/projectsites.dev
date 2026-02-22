/**
 * Lightweight E2E test server for Cypress tests.
 *
 * Serves public/index.html and provides mock API stubs that replicate
 * the Worker's middleware behavior (request ID, security headers,
 * payload limits, auth gates) so Cypress can run locally.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.E2E_PORT) || 8787;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 256 * 1024; // 256KB

// MIME types for static serving
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/** Security headers matching securityHeadersMiddleware */
function setSecurityHeaders(res) {
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://unpkg.com https://releases.transloadit.com https://js.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://releases.transloadit.com",
      "img-src 'self' data: https:",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://api.stripe.com https://lottie.host",
      'frame-src https://js.stripe.com',
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '),
  );
}

/** Set request ID header (propagate or generate) */
function setRequestId(req, res) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  return requestId;
}

/** Send JSON response */
function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status);
  res.end(json);
}

/** Read request body as string */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY + 1024) {
        // Slightly over to allow detection
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';

  // ─── Middleware ──────────────────────────────────────
  setSecurityHeaders(res);
  const requestId = setRequestId(req, res);

  // ─── CORS ──────────────────────────────────────────
  const ALLOWED_ORIGINS = [
    'https://sites.megabyte.space',
    'https://sites-staging.megabyte.space',
    'https://bolt.megabyte.space',
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  const origin = req.headers.origin;
  if (origin) {
    const isDashSub =
      /^https:\/\/[a-z0-9-]+-sites\.megabyte\.space$/.test(origin) ||
      /^https:\/\/[a-z0-9-]+-sites-staging\.megabyte\.space$/.test(origin);
    if (ALLOWED_ORIGINS.includes(origin) || isDashSub) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    // Preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // ─── Subdomain routing ─────────────────────────────
  // Detect non-localhost, non-base-domain hosts as subdomain sites
  const host = (req.headers.host || '').split(':')[0];
  const isBaseDomain =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === 'sites.megabyte.space' ||
    host === 'sites-staging.megabyte.space';

  // Check for customer site subdomains: {slug}-sites.megabyte.space
  if (host.endsWith('-sites.megabyte.space') || host.endsWith('-sites-staging.megabyte.space')) {
    return sendJson(res, 404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Site not found',
      },
    });
  }

  if (!isBaseDomain && host.includes('.')) {
    // Unknown subdomain → 404
    return sendJson(res, 404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Site not found',
        request_id: requestId,
      },
    });
  }

  // Payload limit check via content-length
  const contentLength = req.headers['content-length'];
  if (contentLength) {
    const size = Number(contentLength);
    if (!Number.isNaN(size) && size > MAX_BODY) {
      return sendJson(res, 413, {
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds maximum size of ${MAX_BODY} bytes`,
          request_id: requestId,
        },
      });
    }
  }

  // ─── Health ─────────────────────────────────────────
  if (pathname === '/health' && method === 'GET') {
    return sendJson(res, 200, {
      status: 'ok',
      version: '0.1.0',
      environment: 'e2e-test',
      timestamp: new Date().toISOString(),
      latency_ms: 1,
      checks: {
        kv: { status: 'ok', latency_ms: 0 },
        r2: { status: 'ok', latency_ms: 0 },
      },
    });
  }

  // ─── Search API ─────────────────────────────────────
  if (pathname === '/api/search/businesses' && method === 'GET') {
    const q = url.searchParams.get('q');
    if (!q || q.trim().length === 0) {
      return sendJson(res, 400, {
        error: {
          code: 'BAD_REQUEST',
          message: 'Missing required query parameter: q',
          request_id: requestId,
        },
      });
    }
    // Return mock search results
    return sendJson(res, 200, {
      data: [
        {
          place_id: 'ChIJ_mock_1',
          name: `${q} Pizza`,
          address: '123 Main St, New York, NY',
          types: ['restaurant'],
        },
        {
          place_id: 'ChIJ_mock_2',
          name: `${q} Plumbing`,
          address: '456 Oak Ave, Brooklyn, NY',
          types: ['plumber'],
        },
      ],
    });
  }

  // ─── Site Lookup ────────────────────────────────────
  if (pathname === '/api/sites/lookup' && method === 'GET') {
    const placeId = url.searchParams.get('place_id');
    const slug = url.searchParams.get('slug');
    if (!placeId && !slug) {
      return sendJson(res, 400, {
        error: {
          code: 'BAD_REQUEST',
          message: 'Missing required query parameter: place_id or slug',
          request_id: requestId,
        },
      });
    }
    // Default: site not found
    return sendJson(res, 200, { data: { exists: false } });
  }

  // ─── Create from Search (requires auth) ─────────────
  if (pathname === '/api/sites/create-from-search' && method === 'POST') {
    // Check for auth header (mock: accept any Bearer token)
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendJson(res, 401, {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Must be authenticated',
          request_id: requestId,
        },
      });
    }
    let body;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    const businessName = (body.business && body.business.name) || body.business_name || 'custom-website';
    if (!businessName) {
      return sendJson(res, 400, {
        error: {
          code: 'BAD_REQUEST',
          message: 'Missing required field: business_name (or business.name)',
          request_id: requestId,
        },
      });
    }
    const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 63);
    const siteId = `site-e2e-${crypto.randomUUID()}`;
    const workflowInstanceId = `wf-${siteId}`;

    // Store in-memory for status polling
    if (!global.__e2eWorkflows) global.__e2eWorkflows = {};
    global.__e2eWorkflows[siteId] = {
      instanceId: workflowInstanceId,
      status: 'running',
      steps: ['research-profile'],
      createdAt: Date.now(),
    };

    // Simulate workflow progression over time
    setTimeout(() => {
      if (global.__e2eWorkflows[siteId]) {
        global.__e2eWorkflows[siteId].steps.push('research-social', 'research-brand', 'research-selling-points', 'research-images');
      }
    }, 2000);
    setTimeout(() => {
      if (global.__e2eWorkflows[siteId]) {
        global.__e2eWorkflows[siteId].steps.push('generate-website');
      }
    }, 4000);
    setTimeout(() => {
      if (global.__e2eWorkflows[siteId]) {
        global.__e2eWorkflows[siteId].steps.push('generate-privacy-page', 'generate-terms-page', 'score-website');
      }
    }, 6000);
    setTimeout(() => {
      if (global.__e2eWorkflows[siteId]) {
        global.__e2eWorkflows[siteId].steps.push('upload-to-r2', 'update-site-status');
        global.__e2eWorkflows[siteId].status = 'complete';
      }
    }, 8000);

    return sendJson(res, 201, {
      data: {
        site_id: siteId,
        slug,
        status: 'building',
        workflow_instance_id: workflowInstanceId,
      },
    });
  }

  // ─── Workflow Status (auth-gated) ─────────────────────
  const workflowMatch = pathname.match(/^\/api\/sites\/([^/]+)\/workflow$/);
  if (workflowMatch && method === 'GET') {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendJson(res, 401, {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Must be authenticated',
          request_id: requestId,
        },
      });
    }
    const siteId = workflowMatch[1];
    const wf = (global.__e2eWorkflows || {})[siteId];
    if (!wf) {
      return sendJson(res, 200, {
        data: {
          site_id: siteId,
          workflow_available: true,
          instance_id: null,
          workflow_status: null,
          site_status: 'building',
        },
      });
    }
    return sendJson(res, 200, {
      data: {
        site_id: siteId,
        workflow_available: true,
        instance_id: wf.instanceId,
        workflow_status: wf.status,
        workflow_steps_completed: wf.steps,
        workflow_error: null,
        workflow_output: wf.status === 'complete' ? {
          siteId,
          slug: 'test-site',
          version: new Date().toISOString(),
          quality: 0.85,
          pages: ['index.html', 'privacy.html', 'terms.html', 'research.json'],
        } : null,
        site_status: wf.status === 'complete' ? 'published' : 'building',
      },
    });
  }

  // ─── Site Status Poll (for waiting screen) ──────────────
  const siteStatusMatch = pathname.match(/^\/api\/sites\/([^/]+)$/);
  if (siteStatusMatch && method === 'GET') {
    const siteId = siteStatusMatch[1];
    const wf = (global.__e2eWorkflows || {})[siteId];
    if (wf) {
      return sendJson(res, 200, {
        id: siteId,
        slug: siteId.replace(/^site-e2e-/, '').substring(0, 20),
        status: wf.status === 'complete' ? 'published' : 'building',
      });
    }
    return sendJson(res, 200, {
      id: siteId,
      slug: 'unknown-site',
      status: 'building',
    });
  }

  // ─── Pre-built Sites Search ────────────────────────────
  if (pathname === '/api/sites/search' && method === 'GET') {
    return sendJson(res, 200, { data: [] });
  }

  // ─── Chat Export (AI Edit) ────────────────────────────
  const chatMatch = pathname.match(/^\/api\/sites\/by-slug\/([^/]+)\/chat$/);
  if (chatMatch && method === 'GET') {
    const slug = decodeURIComponent(chatMatch[1]);

    // "test-site" is our known mock site with chat data
    if (slug === 'test-site' || slug === 'example-business') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      return sendJson(res, 200, {
        messages: [
          { id: 'msg-1', role: 'user', content: 'Build me a website for my pizza shop called Best Pizza' },
          { id: 'msg-2', role: 'assistant', content: 'I\'ll create a professional website for Best Pizza with a modern design, menu section, and contact information.' },
          { id: 'msg-3', role: 'user', content: 'Add an online ordering section' },
          { id: 'msg-4', role: 'assistant', content: 'I\'ve added an online ordering section with a cart system and checkout flow.' },
        ],
        description: 'Best Pizza Website',
        exportDate: new Date().toISOString(),
      });
    }

    // Unknown slug → 404
    return sendJson(res, 404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Site not found or no version published',
        request_id: requestId,
      },
    });
  }

  // ─── Auth endpoints ─────────────────────────────────
  if (pathname === '/api/auth/magic-link' && method === 'POST') {
    let body;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return sendJson(res, 400, {
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid email address',
          request_id: requestId,
        },
      });
    }
    return sendJson(res, 200, { data: { expires_at: new Date(Date.now() + 600000).toISOString() } });
  }

  if (pathname === '/api/auth/google' && method === 'GET') {
    return sendJson(res, 400, {
      error: {
        code: 'BAD_REQUEST',
        message: 'Missing OAuth configuration',
        request_id: requestId,
      },
    });
  }

  // ─── Webhook endpoints ──────────────────────────────
  if (pathname === '/webhooks/stripe' && method === 'POST') {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      return sendJson(res, 400, {
        error: {
          code: 'BAD_REQUEST',
          message: 'Missing stripe-signature header',
          request_id: requestId,
        },
      });
    }
    return sendJson(res, 401, {
      error: {
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Invalid signature',
        request_id: requestId,
      },
    });
  }

  // ─── Auth-gated API routes (return 401) ─────────────
  const authGatedRoutes = [
    '/api/sites',
    '/api/billing/subscription',
    '/api/billing/entitlements',
    '/api/billing/checkout',
    '/api/hostnames',
    '/api/audit-logs',
  ];

  for (const route of authGatedRoutes) {
    if (pathname === route || pathname.startsWith(route + '/')) {
      return sendJson(res, 401, {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Must be authenticated',
          request_id: requestId,
        },
      });
    }
  }

  // ─── Unknown API routes ─────────────────────────────
  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        request_id: requestId,
      },
    });
  }

  // ─── Static file serving ────────────────────────────
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  } else {
    filePath = path.join(PUBLIC_DIR, pathname);
  }

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
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
    // File not found - try appending .html for extensionless paths (e.g. /privacy → privacy.html)
    if (!path.extname(filePath)) {
      try {
        const htmlPath = filePath + '.html';
        const stat2 = fs.statSync(htmlPath);
        if (stat2.isFile()) {
          const content = fs.readFileSync(htmlPath);
          res.setHeader('Content-Type', 'text/html');
          res.setHeader('Cache-Control', 'public, max-age=60');
          res.writeHead(200);
          res.end(content);
          return;
        }
      } catch {
        // Also not found, fall through
      }
    }
  }

  // Fallback: for SPA paths, serve index.html
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  try {
    const content = fs.readFileSync(indexPath);
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(content);
  } catch {
    sendJson(res, 404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Site not found',
        request_id: requestId,
      },
    });
  }
});

server.listen(PORT, () => {
  console.log(`E2E test server running at http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});
