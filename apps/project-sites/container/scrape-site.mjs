/**
 * Deep website scraper — extracts ALL content, images, videos, and structure.
 * Strategy: find sitemap → scrape all pages. No sitemap → crawl 4 levels deep.
 */
import puppeteer from 'puppeteer';

const MAX_PAGES = 30;
const MAX_DEPTH = 4;

/**
 * Scrape a website completely.
 * @param {string} url - The website URL
 * @returns {Object} Structured data for Claude Code
 */
export async function scrapeSite(url) {
  if (!url) return null;
  const siteUrl = url.startsWith('http') ? url : `https://${url}`;
  const baseUrl = new URL(siteUrl);
  const baseDomain = baseUrl.hostname;

  console.log(`[scrape] Deep scraping: ${siteUrl}`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const scraped = {
    domain: baseDomain,
    pages: [],
    siteMap: [],
    globalNav: [],
    globalStyles: {},
    totalImages: 0,
    totalVideos: 0,
    scrapedAt: new Date().toISOString(),
  };

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['font', 'media'].includes(type)) req.abort();
      else req.continue();
    });

    // Step 1: Try to find sitemap
    let pageUrls = new Set();
    pageUrls.add(siteUrl);

    try {
      const sitemapUrls = [
        `${siteUrl}/sitemap.xml`,
        `${siteUrl}/sitemap_index.xml`,
        `${siteUrl}/sitemap`,
      ];
      for (const smUrl of sitemapUrls) {
        try {
          const res = await page.goto(smUrl, { waitUntil: 'networkidle2', timeout: 10000 });
          if (res && res.ok()) {
            const content = await page.content();
            const urls = [...content.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)].map(m => m[1]);
            if (urls.length > 0) {
              console.log(`[scrape] Found sitemap with ${urls.length} URLs`);
              urls.filter(u => u.includes(baseDomain)).slice(0, MAX_PAGES).forEach(u => pageUrls.add(u));
              break;
            }
          }
        } catch { /* try next */ }
      }
    } catch { /* no sitemap */ }

    // Step 2: If no sitemap found, crawl from homepage
    if (pageUrls.size <= 1) {
      console.log('[scrape] No sitemap — crawling from homepage');
      await crawlLinks(page, siteUrl, baseDomain, pageUrls, 0);
    }

    console.log(`[scrape] Found ${pageUrls.size} pages to scrape`);

    // Step 3: Scrape each page
    const urlList = [...pageUrls].slice(0, MAX_PAGES);
    for (let i = 0; i < urlList.length; i++) {
      const pageUrl = urlList[i];
      try {
        console.log(`[scrape] (${i + 1}/${urlList.length}) ${pageUrl}`);
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1000);

        const pageData = await page.evaluate((currentUrl) => {
          const getText = (sel) => document.querySelector(sel)?.textContent?.trim()?.substring(0, 500) || '';
          const getAll = (sel) => [...document.querySelectorAll(sel)].map(el => el.textContent?.trim()).filter(t => t && t.length > 5);

          return {
            url: currentUrl,
            title: document.title || '',
            meta: {
              description: document.querySelector('meta[name="description"]')?.content || '',
              ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
              ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
            },
            headings: {
              h1: getAll('h1').slice(0, 3),
              h2: getAll('h2').slice(0, 8),
              h3: getAll('h3').slice(0, 10),
            },
            paragraphs: getAll('p').filter(t => t.length > 30).slice(0, 12).map(t => t.substring(0, 300)),
            lists: getAll('li').slice(0, 15).map(t => t.substring(0, 150)),
            images: [...document.querySelectorAll('img')].filter(i => i.naturalWidth > 100).map(i => ({
              src: i.src, alt: i.alt || '', w: i.naturalWidth, h: i.naturalHeight,
            })).slice(0, 10),
            videos: [...document.querySelectorAll('video source, iframe[src*="youtube"], iframe[src*="vimeo"]')].map(v => ({
              src: v.src || v.getAttribute('src') || '', type: v.tagName.toLowerCase(),
            })).slice(0, 5),
            links: [...document.querySelectorAll('a[href]')].map(a => ({
              text: a.textContent?.trim()?.substring(0, 50) || '', href: a.href,
            })).filter(l => l.text && l.href.startsWith('http')).slice(0, 20),
          };
        }, pageUrl);

        scraped.pages.push(pageData);
        scraped.totalImages += pageData.images.length;
        scraped.totalVideos += pageData.videos.length;

        // Extract nav from first page
        if (i === 0) {
          scraped.globalNav = pageData.links.filter(l => l.href.includes(baseDomain)).slice(0, 10);
          scraped.globalStyles = await page.evaluate(() => {
            const body = getComputedStyle(document.body);
            const heading = document.querySelector('h1, h2');
            return {
              bgColor: body.backgroundColor,
              textColor: body.color,
              fontFamily: body.fontFamily?.substring(0, 100),
              headingFont: heading ? getComputedStyle(heading).fontFamily?.substring(0, 100) : '',
              fontSize: body.fontSize,
            };
          });
        }
      } catch (err) {
        console.warn(`[scrape] Failed: ${pageUrl} — ${err.message}`);
      }
    }

    scraped.siteMap = urlList;
    console.log(`[scrape] Done: ${scraped.pages.length} pages, ${scraped.totalImages} images, ${scraped.totalVideos} videos`);
    return scraped;
  } finally {
    await browser.close();
  }
}

/**
 * Recursively crawl internal links up to MAX_DEPTH levels.
 */
async function crawlLinks(page, url, baseDomain, found, depth) {
  if (depth >= MAX_DEPTH || found.size >= MAX_PAGES) return;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    const links = await page.evaluate((domain) => {
      return [...document.querySelectorAll('a[href]')]
        .map(a => a.href)
        .filter(h => {
          try { return new URL(h).hostname === domain && !h.includes('#') && !h.match(/\.(pdf|zip|png|jpg|gif|svg|css|js)$/i); }
          catch { return false; }
        });
    }, baseDomain);

    const newLinks = [...new Set(links)].filter(l => !found.has(l)).slice(0, 10);
    newLinks.forEach(l => found.add(l));

    // Recurse into new links
    for (const link of newLinks.slice(0, 5)) {
      if (found.size >= MAX_PAGES) break;
      await crawlLinks(page, link, baseDomain, found, depth + 1);
    }
  } catch { /* ignore navigation errors */ }
}
