import { chromium } from 'playwright';

const outDir = '/tmp/site-scans-final';
async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(err.message));

  const response = await page.goto('https://nobu-v4.projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('Status:', response?.status());
  await page.waitForTimeout(5000);
  
  await page.screenshot({ path: `${outDir}/nobu-v4-top.png`, fullPage: false });
  
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log('Page height:', pageHeight);
  
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.5));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/nobu-v4-mid.png`, fullPage: false });
  
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/nobu-v4-bottom.png`, fullPage: false });

  const svgCount = await page.evaluate(() => document.querySelectorAll('svg').length);
  const brokenImages = await page.evaluate(() => Array.from(document.querySelectorAll('img')).filter(img => !img.complete || img.naturalWidth === 0).length);
  const textLength = await page.evaluate(() => document.body.innerText.trim().length);
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const whiteOrLight = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll('section, div, header, footer, main'));
    return sections.filter(el => {
      const bg = getComputedStyle(el).backgroundColor;
      const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) { const [_, r, g, b] = match.map(Number); return r > 200 && g > 200 && b > 200; }
      return false;
    }).length;
  });
  
  console.log(JSON.stringify({ svgCount, brokenImages, textLength, bodyBg, whiteOrLight, consoleErrors: consoleErrors.length, errorSamples: consoleErrors.slice(0,3) }, null, 2));
  
  await browser.close();
}
main().catch(console.error);
