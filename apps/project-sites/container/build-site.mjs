/**
 * Build a website using Claude Code CLI.
 * 1. Scrapes existing site (if any) — sitemap-first, then 4-level crawl
 * 2. Combines with research data
 * 3. Runs Claude Code CLI to generate the full website
 * 4. Uploads files to R2
 * 5. Updates D1 status
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { scrapeSite } from './scrape-site.mjs';

/**
 * Build a complete website for a business.
 */
export async function buildSite(params) {
  const {
    slug, siteId, orgId, businessName, businessAddress, businessPhone,
    businessWebsite, businessEmail, additionalContext,
    researchData, assetUrls, structurePlan, r2Url, d1Url
  } = params;

  const outputDir = `/tmp/build-${slug}-${Date.now()}`;
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`[build] Starting: ${businessName} (${slug})`);

  // Step 1: Deep scrape existing website
  let scrapedData = null;
  if (businessWebsite) {
    try {
      scrapedData = await scrapeSite(businessWebsite);
      // Save scraped data for Claude Code to read
      fs.writeFileSync(path.join(outputDir, '_scraped.json'), JSON.stringify(scrapedData, null, 2));
      console.log(`[build] Scraped ${scrapedData?.pages?.length || 0} pages from ${businessWebsite}`);
    } catch (err) {
      console.warn(`[build] Scrape failed: ${err.message}`);
    }
  }

  // Step 2: Save research data for Claude Code
  fs.writeFileSync(path.join(outputDir, '_research.json'), JSON.stringify(researchData || {}, null, 2));
  fs.writeFileSync(path.join(outputDir, '_assets.json'), JSON.stringify(assetUrls || [], null, 2));
  fs.writeFileSync(path.join(outputDir, '_plan.json'), JSON.stringify(structurePlan || {}, null, 2));

  // Step 3: Build the Claude Code prompt
  const scrapedSummary = scrapedData ? summarizeScrape(scrapedData) : 'No existing website found.';
  const researchSummary = summarizeResearch(researchData || {});
  const assetList = (assetUrls || []).map((a, i) => `${i + 1}. ${a.url || a}`).join('\n');

  const prompt = `You are building a $100,000 quality website for "${businessName}".

EXISTING WEBSITE DATA (scraped — clone the content, DRAMATICALLY improve the design):
${scrapedSummary}

RESEARCH:
${researchSummary}

ADDITIONAL CONTEXT: ${additionalContext || 'None'}

BRAND ASSETS (use ALL of these as <img> elements):
${assetList || 'No assets provided — use CSS gradients as placeholders.'}

REQUIREMENTS:
- Self-contained HTML files. Use <script src="https://cdn.tailwindcss.com"></script>
- Tailwind config block with brand colors and fonts
- Google Fonts via CDN <link>
- index.html: full single-page site with hero (bg image + gradient overlay), about, services, gallery, contact form, footer
- Contact form POSTs to https://projectsites.dev/api/contact-form/${slug}
- Sticky nav with logo, links, mobile hamburger
- IntersectionObserver scroll-reveal animations
- Glassmorphism cards, hover effects, gradient text
- JSON-LD LocalBusiness schema
- Also generate robots.txt and sitemap.xml

Create all files in the current directory.`;

  // Write prompt to file so Claude Code can read it
  fs.writeFileSync(path.join(outputDir, '_prompt.md'), prompt);

  // Step 4: Run Claude Code CLI
  console.log(`[build] Running Claude Code CLI...`);
  try {
    execSync(
      `claude --print --dangerously-skip-permissions "Read _prompt.md, _scraped.json, _research.json, and _assets.json. Then generate all the website files in this directory based on the prompt. Create index.html, robots.txt, sitemap.xml, and any other needed files. Write the actual files to disk — do NOT just output JSON."`,
      {
        cwd: outputDir,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          HOME: process.env.HOME || '/root',
        },
        timeout: 300000, // 5 minute timeout
        maxBuffer: 50 * 1024 * 1024,
        stdio: 'pipe',
      }
    );
  } catch (err) {
    console.warn(`[build] Claude Code exited with error (may still have generated files):`, err.message?.substring(0, 200));
  }

  // Step 5: Read generated files
  const files = readFilesRecursive(outputDir)
    .filter(f => !f.path.startsWith('_')) // Exclude our temp files
    .filter(f => !f.path.includes('node_modules'));

  console.log(`[build] Generated ${files.length} files`);

  if (files.length === 0 || !files.some(f => f.path === 'index.html')) {
    throw new Error('Claude Code did not generate index.html');
  }

  // Step 6: Upload to R2
  const version = new Date().toISOString().replace(/[:.]/g, '-');
  for (const file of files) {
    const key = `sites/${slug}/${version}/${file.path}`;
    const ct = getContentType(file.path);
    try {
      await fetch(`${r2Url}/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': ct },
        body: file.content,
      });
    } catch (err) {
      console.warn(`[build] R2 upload failed: ${key}`, err.message);
    }
  }

  // Update manifest
  await fetch(`${r2Url}/sites/${slug}/_manifest.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      current_version: version,
      updated_at: new Date().toISOString(),
      files: files.map(f => f.path),
      model: 'claude-code-cli',
      build_method: 'container',
    }),
  }).catch(() => {});

  // Step 7: Update D1 status
  await fetch(`${d1Url}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `UPDATE sites SET status = 'published', current_build_version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      params: [version, siteId],
    }),
  }).catch(err => console.warn('[build] D1 update failed:', err.message));

  // Cleanup
  fs.rmSync(outputDir, { recursive: true, force: true });
  console.log(`[build] Complete: ${slug} — ${files.length} files, version ${version}`);
  return { files, slug, version };
}

function summarizeScrape(data) {
  if (!data?.pages?.length) return 'No pages scraped.';
  const homepage = data.pages[0];
  const parts = [
    `Site: ${data.domain}`,
    `Pages scraped: ${data.pages.length}`,
    `Total images: ${data.totalImages}`,
    `Total videos: ${data.totalVideos}`,
    '',
    `HOMEPAGE (${homepage.title}):`,
    homepage.meta?.description ? `Description: ${homepage.meta.description}` : '',
    homepage.headings?.h1?.length ? `H1: ${homepage.headings.h1.join(' | ')}` : '',
    homepage.headings?.h2?.length ? `H2: ${homepage.headings.h2.join(' | ')}` : '',
    homepage.paragraphs?.length ? `Content:\n${homepage.paragraphs.join('\n')}` : '',
    homepage.images?.length ? `Images: ${homepage.images.map(i => i.alt || i.src).join(', ')}` : '',
    homepage.videos?.length ? `Videos: ${homepage.videos.map(v => v.src).join(', ')}` : '',
  ];

  // Add subpage summaries
  for (const pg of data.pages.slice(1, 10)) {
    parts.push('');
    parts.push(`PAGE: ${pg.title} (${pg.url})`);
    if (pg.headings?.h1?.length) parts.push(`  H1: ${pg.headings.h1.join(' | ')}`);
    if (pg.paragraphs?.length) parts.push(`  Content: ${pg.paragraphs.slice(0, 3).join(' ')}`);
  }

  // Nav structure
  if (data.globalNav?.length) {
    parts.push('');
    parts.push(`NAV: ${data.globalNav.map(n => n.text).join(' | ')}`);
  }

  return parts.filter(Boolean).join('\n').substring(0, 8000);
}

function summarizeResearch(data) {
  const parts = [];
  if (data.profile) {
    const p = data.profile;
    parts.push(`Business: ${p.business_name || ''}`);
    parts.push(`Type: ${p.business_type || ''}`);
    parts.push(`Description: ${p.description || ''}`);
    if (p.services?.length) parts.push(`Services: ${p.services.map(s => typeof s === 'string' ? s : s.name).join(', ')}`);
    if (p.hours?.length) parts.push(`Hours: ${p.hours.map(h => `${h.day}: ${h.open}-${h.close}`).join(', ')}`);
  }
  if (data.brand) {
    parts.push(`Colors: ${data.brand.primary_color || ''} / ${data.brand.accent_color || ''}`);
    parts.push(`Fonts: ${data.brand.heading_font || ''} / ${data.brand.body_font || ''}`);
  }
  if (data.sellingPoints?.selling_points?.length) {
    parts.push(`USPs: ${data.sellingPoints.selling_points.map(s => s.headline).join(' | ')}`);
  }
  if (data.social?.social_links?.length) {
    parts.push(`Social: ${data.social.social_links.map(l => `${l.platform}: ${l.url}`).join(', ')}`);
  }
  return parts.join('\n').substring(0, 3000);
}

function readFilesRecursive(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      files.push(...readFilesRecursive(full).map(f => ({ ...f, path: `${entry.name}/${f.path}` })));
    } else if (entry.isFile()) {
      try {
        files.push({ path: entry.name, content: fs.readFileSync(full, 'utf-8') });
      } catch { /* binary file — skip */ }
    }
  }
  return files;
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
}
