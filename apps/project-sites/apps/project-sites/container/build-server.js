/**
 * ProjectSites Build Server — runs inside a custom Docker container.
 *
 * Claude Code runs as 'cuser' (non-root) via child_process.
 * The -p flag outputs to stdout — we capture it and write index.html.
 * The server returns all generated files in the HTTP response body.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 8080;
const NL = '\n';

function runClaude(dir, prompt, label, timeoutMs) {
  const inputFile = path.join(dir, '_in_' + label + '.txt');
  fs.writeFileSync(inputFile, prompt);

  // Write a proper shell script with real newlines
  const script = [
    '#!/bin/sh',
    'export ANTHROPIC_API_KEY="' + process.env.ANTHROPIC_API_KEY + '"',
    'export HOME=/home/cuser',
    'cd ' + dir,
    'claude --dangerously-skip-permissions -p < ' + inputFile,
    '',
  ].join(NL);
  fs.writeFileSync('/tmp/run_claude.sh', script, { mode: 0o755 });

  // Give cuser ownership
  try { execSync('chown -R cuser:cuser ' + dir, { stdio: 'pipe' }); } catch {}

  console.log('[' + label + '] Running Claude Code...');
  const t0 = Date.now();
  try {
    const stdout = execSync('su cuser -s /bin/sh -c "sh /tmp/run_claude.sh"', {
      timeout: timeoutMs || 600000,
      maxBuffer: 100 * 1024 * 1024,
      encoding: 'utf-8',
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    console.log('[' + label + '] Done in ' + elapsed + 's, got ' + (stdout || '').length + ' bytes');
    return stdout || '';
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    console.warn('[' + label + '] Failed after ' + elapsed + 's, exit=' + e.status);
    // Return whatever stdout we got (partial output)
    return e.stdout || '';
  }
}

function saveHtml(dir, output) {
  if (!output || output.length < 100) return false;
  let html = output.trim();
  // Strip markdown code fences
  if (html.startsWith('```html')) html = html.substring(7);
  else if (html.startsWith('```')) html = html.substring(3);
  if (html.endsWith('```')) html = html.slice(0, -3);
  html = html.trim();

  if (html.includes('<!DOCTYPE') || html.includes('<!doctype') || html.includes('<html')) {
    // Extract just the HTML part (ignore any text before <!DOCTYPE)
    const docIdx = html.search(/<!doctype|<!DOCTYPE/i);
    if (docIdx > 0) html = html.substring(docIdx);
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    console.log('[save] index.html: ' + html.length + ' bytes');
    return true;
  }
  console.warn('[save] Output does not contain HTML (' + html.substring(0, 100) + '...)');
  return false;
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    return res.end(JSON.stringify({ ok: true, pid: process.pid }));
  }

  if (req.method !== 'POST' || req.url !== '/build') {
    res.writeHead(404);
    return res.end('{}');
  }

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const P = JSON.parse(body);
      console.log('[build] Start:', P.businessName, P.slug);

      // Set API key
      if (P._anthropicKey) {
        process.env.ANTHROPIC_API_KEY = P._anthropicKey;
        console.log('[build] API key set');
      }

      const slug = (P.slug || '').replace(/[^a-z0-9-]/g, '').slice(0, 63);
      const dir = '/tmp/builds/' + slug + '-' + Date.now();
      fs.mkdirSync(dir, { recursive: true });

      // Write context files
      fs.writeFileSync(path.join(dir, '_research.json'), JSON.stringify(P.researchData || {}, null, 2));
      fs.writeFileSync(path.join(dir, '_assets.json'), JSON.stringify(P.assetUrls || [], null, 2));
      if (P.scrapedContent) {
        fs.writeFileSync(path.join(dir, '_scraped.json'),
          typeof P.scrapedContent === 'string' ? P.scrapedContent : JSON.stringify(P.scrapedContent));
      }

      const brand = (P.researchData && P.researchData.brand) || {};
      const colors = brand.colors || {};
      const biz = (P.businessName || '').replace(/"/g, '');
      const cat = ((P.researchData && P.researchData.profile && P.researchData.profile.business_type) || P.businessCategory || '').toLowerCase();
      const ctx = P.additionalContext || '';

      // ═══ STAGE 1: Generate complete website ═══
      const s1 = runClaude(dir,
        'Return ONLY a complete HTML document starting with <!DOCTYPE html>. No explanation. ' +
        'Build a Stripe.com quality website for "' + biz + '". ' +
        'Brand colors: ' + (colors.primary || '#1a1a2e') + '/' + (colors.accent || '#e94560') + '. ' +
        'Include: nav, hero, about, services grid (Unsplash images), contact form, FAQ, footer. ' +
        '6+ CSS animations. 15+ images. SEO meta tags. ' +
        (cat.includes('non-profit') ? 'Add donation CTA and impact counters. ' : '') +
        ctx,
        '1-generate', 600000);
      saveHtml(dir, s1);

      // ═══ STAGE 2: Enhance ═══
      if (fs.existsSync(path.join(dir, 'index.html'))) {
        const currentHtml = fs.readFileSync(path.join(dir, 'index.html'), 'utf-8');
        const s2 = runClaude(dir,
          'Return the COMPLETE modified HTML starting with <!DOCTYPE html>. ' +
          'Current website:\n\n' + currentHtml.slice(0, 50000) + '\n\n' +
          'Improve: 1)Every card has image 2)Dark overlays on text 3)Animations 4)SEO meta 5)Accessibility 6)Responsive',
          '2-enhance', 480000);
        saveHtml(dir, s2);
      }

      // Generate robots.txt + sitemap.xml
      const siteUrl = 'https://' + slug + '.projectsites.dev';
      if (fs.existsSync(path.join(dir, 'index.html'))) {
        fs.writeFileSync(path.join(dir, 'robots.txt'),
          'User-agent: *\nAllow: /\nSitemap: ' + siteUrl + '/sitemap.xml\n');
        fs.writeFileSync(path.join(dir, 'sitemap.xml'),
          '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          '<url><loc>' + siteUrl + '/</loc><lastmod>' + new Date().toISOString().split('T')[0] + '</lastmod></url>\n</urlset>\n');
      }

      // Collect output files
      const files = [];
      if (fs.existsSync(path.join(dir, 'index.html'))) {
        for (const fn of fs.readdirSync(dir)) {
          if (!fn.startsWith('_') && fs.statSync(path.join(dir, fn)).isFile()) {
            files.push({ name: fn, content: fs.readFileSync(path.join(dir, fn), 'utf-8') });
          }
        }
      }

      console.log('[build] Complete:', files.length, 'files');
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}

      res.writeHead(200);
      res.end(JSON.stringify({
        status: files.length > 0 ? 'complete' : 'no_files',
        files: files,
        debug: {
          apiKeySet: !!process.env.ANTHROPIC_API_KEY,
          claudeAvailable: (() => { try { execSync('which claude', { stdio: 'pipe' }); return true; } catch { return false; } })(),
          stage1OutputLength: (s1 || '').length,
          filesProduced: files.map((f) => f.name),
        },
      }));
    } catch (e) {
      console.error('[build] Fatal:', e.message);
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'error', error: e.message, files: [] }));
    }
  });
});

server.listen(PORT, () => {
  console.log('[container] Build server ready on :' + PORT);
  console.log('[container] Claude available:', (() => { try { execSync('which claude', { stdio: 'pipe' }); return 'yes'; } catch { return 'no'; } })());
  console.log('[container] User:', execSync('whoami', { encoding: 'utf-8' }).trim());
});
