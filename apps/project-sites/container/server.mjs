/**
 * Container HTTP server — receives build jobs from the Worker.
 * Runs Claude Code CLI to generate websites.
 */
import http from 'node:http';
import { buildSite } from './build-site.mjs';

const PORT = 8080;

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    return res.end(JSON.stringify({ status: 'ok', service: 'site-builder' }));
  }

  if (req.method === 'POST' && req.url === '/build') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const params = JSON.parse(body);
        console.log(`[build] Starting build for: ${params.businessName} (${params.slug})`);

        // Run the build asynchronously — respond immediately with 202
        res.writeHead(202);
        res.end(JSON.stringify({ status: 'building', slug: params.slug }));

        // Execute the build
        const result = await buildSite(params);
        console.log(`[build] Complete: ${params.slug} — ${result.files.length} files`);
      } catch (err) {
        console.error(`[build] Failed:`, err);
        if (!res.writableEnded) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: String(err) }));
        }
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[container] Site builder ready on :${PORT}`);
});
