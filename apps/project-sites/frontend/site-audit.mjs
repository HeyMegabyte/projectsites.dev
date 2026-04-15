import { chromium } from 'playwright';
import fs from 'fs';

const sites = [
  { name: 'nobu-v4', url: 'https://nobu-v4.projectsites.dev', category: 'Restaurant' },
  { name: 'vitos-salon-v3', url: 'https://vitos-salon-v3.projectsites.dev', category: 'Salon' },
  { name: 'cravath-v3', url: 'https://cravath-v3.projectsites.dev', category: 'Legal' },
  { name: 'mayo-clinic-v3', url: 'https://mayo-clinic-v3.projectsites.dev', category: 'Medical' },
  { name: 'linear-v3', url: 'https://linear-v3.projectsites.dev', category: 'Tech' },
  { name: 'equinox-v3', url: 'https://equinox-v3.projectsites.dev', category: 'Fitness' },
  { name: 'compass-v3', url: 'https://compass-v3.projectsites.dev', category: 'Real Estate' },
  { name: 'suffolk-v3', url: 'https://suffolk-v3.projectsites.dev', category: 'Construction' },
  { name: 'annie-leibovitz-v3', url: 'https://annie-leibovitz-v3.projectsites.dev', category: 'Photography' },
  { name: 'the-white-house-v5', url: 'https://the-white-house-v5.projectsites.dev', category: 'Other' },
];

const outDir = '/tmp/site-scans-final';

async function auditSite(browser, site) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  try {
    const response = await page.goto(site.url, { waitUntil: 'networkidle', timeout: 30000 });
    const status = response?.status();
    
    // Wait for React to render
    await page.waitForTimeout(2000);
    
    // Screenshot top
    await page.screenshot({ path: `${outDir}/${site.name}-top.png`, fullPage: false });
    
    // Get page height
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    
    // Screenshot 50% scroll
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.5));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/${site.name}-mid.png`, fullPage: false });
    
    // Screenshot bottom
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/${site.name}-bottom.png`, fullPage: false });

    // Count SVGs
    const svgCount = await page.evaluate(() => {
      const inlineSvgs = document.querySelectorAll('svg').length;
      const imgSvgs = document.querySelectorAll('img[src$=".svg"]').length;
      return { inline: inlineSvgs, imgSvg: imgSvgs, total: inlineSvgs + imgSvgs };
    });

    // Check for broken images
    const brokenImages = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.filter(img => !img.complete || img.naturalWidth === 0).map(img => img.src);
    });

    // Check background colors of major sections
    const sectionColors = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const sections = Array.from(document.querySelectorAll('section, div, header, footer, main'));
      const colors = new Set();
      const whiteOrLight = [];
      sections.forEach(el => {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          colors.add(bg);
          // Check if it's a light/white color
          const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (match) {
            const [_, r, g, b] = match.map(Number);
            if (r > 200 && g > 200 && b > 200) {
              whiteOrLight.push({ tag: el.tagName, class: el.className?.substring?.(0, 80), bg });
            }
          }
        }
      });
      return { bodyBg: body.backgroundColor, uniqueColors: colors.size, whiteOrLight };
    });

    // Check if page rendered content
    const textContent = await page.evaluate(() => document.body.innerText.trim().length);
    const hasContent = textContent > 50;

    return {
      site: site.name,
      category: site.category,
      status,
      pageHeight,
      svgCount,
      brokenImages: brokenImages.length,
      brokenImageUrls: brokenImages.slice(0, 5),
      consoleErrors: consoleErrors.length,
      consoleErrorSamples: consoleErrors.slice(0, 3),
      bodyBg: sectionColors.bodyBg,
      uniqueBgColors: sectionColors.uniqueColors,
      whiteOrLightSections: sectionColors.whiteOrLight.length,
      whiteOrLightDetails: sectionColors.whiteOrLight.slice(0, 5),
      hasContent,
      textLength: textContent,
    };
  } catch (err) {
    return { site: site.name, category: site.category, error: err.message };
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  
  // Process 2 at a time to be gentle on the network
  for (let i = 0; i < sites.length; i += 2) {
    const batch = sites.slice(i, i + 2);
    const batchResults = await Promise.all(batch.map(s => auditSite(browser, s)));
    results.push(...batchResults);
    console.log(`Completed ${Math.min(i + 2, sites.length)}/${sites.length}`);
  }
  
  await browser.close();
  
  fs.writeFileSync(`${outDir}/audit-results.json`, JSON.stringify(results, null, 2));
  console.log('\n=== AUDIT RESULTS ===\n');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
