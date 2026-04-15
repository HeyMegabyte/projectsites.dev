/**
 * Claude Code site builder container on Cloudflare Workers Containers.
 * Receives build jobs, runs Claude Code CLI, uploads results to R2.
 */
import { Container } from '@cloudflare/containers';

export class SiteBuilderContainer extends Container {
  defaultPort = 8080;

  // The container runs node:22-slim — we install Claude Code CLI on start
  // and run a simple HTTP server that handles /build requests
  override async onStart(): Promise<void> {
    // Write the server script into the container
    const serverScript = `
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

// Install Claude Code CLI on first request (lazy install)
let claudeInstalled = false;
function ensureClaude() {
  if (claudeInstalled) return;
  try {
    execSync('which claude', { stdio: 'pipe' });
    claudeInstalled = true;
  } catch {
    console.log('[container] Installing Claude Code CLI...');
    execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit', timeout: 120000 });
    claudeInstalled = true;
    console.log('[container] Claude Code installed');
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    return res.end(JSON.stringify({ status: 'ok', claude: claudeInstalled }));
  }

  if (req.method === 'POST' && req.url === '/build') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const params = JSON.parse(body);
      res.writeHead(202);
      res.end(JSON.stringify({ status: 'building', slug: params.slug }));

      try {
        ensureClaude();
        await buildSite(params);
      } catch (err) {
        console.error('[build] Failed:', err.message);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

async function buildSite(params) {
  const { slug, siteId, businessName, additionalContext, researchData, assetUrls } = params;
  const dir = '/tmp/build-' + slug + '-' + Date.now();
  fs.mkdirSync(dir, { recursive: true });

  console.log('[build] Starting:', businessName, slug);

  // Write context
  fs.writeFileSync(path.join(dir, '_research.json'), JSON.stringify(researchData || {}, null, 2));
  fs.writeFileSync(path.join(dir, '_assets.json'), JSON.stringify(assetUrls || [], null, 2));

  const brand = researchData?.brand || {};
  const prompt = 'Build a stunning website for "' + businessName + '". Read _research.json and _assets.json. Use Tailwind CDN, brand colors ' + (brand.primary_color || '#002868') + '/' + (brand.accent_color || '#BF0A30') + ', fonts ' + (brand.heading_font || 'Merriweather') + '/' + (brand.body_font || 'Source Sans Pro') + '. Include hero, about, services, gallery, contact form, footer. Use CSS gradients (NOT Wikipedia hotlinks). At least 3000 words of real content. Write index.html, robots.txt, sitemap.xml to this directory. ' + (additionalContext || '');

  fs.writeFileSync(path.join(dir, '_prompt.md'), prompt);

  // Run Claude Code
  try {
    execSync(
      'echo "Read _prompt.md and _research.json. Write index.html, robots.txt, sitemap.xml to this directory." | claude --dangerously-skip-permissions -p',
      {
        cwd: dir,
        env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
        timeout: 600000,
        maxBuffer: 100 * 1024 * 1024,
        shell: true,
      }
    );
  } catch (err) {
    console.warn('[build] Claude exited:', err.status);
  }

  // Check for output
  const files = [];
  if (fs.existsSync(path.join(dir, 'index.html'))) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('_')) continue;
      files.push({ name: f, content: fs.readFileSync(path.join(dir, f), 'utf-8') });
    }
  }

  console.log('[build] Generated', files.length, 'files');

  // Upload to R2 via fetch to the binding
  const version = new Date().toISOString().replace(/[:.]/g, '-');
  for (const f of files) {
    const key = 'sites/' + slug + '/' + version + '/' + f.name;
    await fetch('http://r2/' + key, {
      method: 'PUT',
      body: f.content,
      headers: { 'Content-Type': f.name.endsWith('.html') ? 'text/html' : 'text/plain' },
    }).catch(e => console.warn('R2 upload failed:', key, e.message));
  }

  // Manifest
  await fetch('http://r2/sites/' + slug + '/_manifest.json', {
    method: 'PUT',
    body: JSON.stringify({ current_version: version, files: files.map(f => f.name) }),
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => {});

  // Update D1
  await fetch('http://d1/query', {
    method: 'POST',
    body: JSON.stringify({
      sql: "UPDATE sites SET status = 'published', current_build_version = '" + version + "' WHERE id = '" + siteId + "'",
    }),
    headers: { 'Content-Type': 'application/json' },
  }).catch(e => console.warn('D1 update failed:', e.message));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('[build] Done:', slug, files.length, 'files');
}

server.listen(PORT, () => console.log('[container] Ready on :' + PORT));
`;

    // Write server script and start it
    this.monitor.exec(['sh', '-c', `cat > /app/server.js << 'SERVEREOF'\n${serverScript}\nSERVEROF`]);
    this.monitor.exec(['node', '/app/server.js']);
  }
}
