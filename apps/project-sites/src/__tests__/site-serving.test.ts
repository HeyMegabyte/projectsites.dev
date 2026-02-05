import { generateTopBar } from '../services/site-serving';
import { DOMAINS, BRAND } from '@project-sites/shared';

describe('generateTopBar', () => {
  it('generates valid HTML with CTA', () => {
    const html = generateTopBar('my-biz', 'https://my-biz.sites.megabyte.space');
    expect(html).toContain('ps-topbar');
    expect(html).toContain(BRAND.PRIMARY_CTA);
    expect(html).toContain('Project Sites');
  });

  it('includes upgrade link with slug', () => {
    const html = generateTopBar('joe-pizza', 'https://joe-pizza.sites.megabyte.space');
    expect(html).toContain('upgrade=joe-pizza');
  });

  it('includes close button', () => {
    const html = generateTopBar('test', 'https://test.sites.megabyte.space');
    expect(html).toContain('&times;');
    expect(html).toContain("display='none'");
  });

  it('sets body padding', () => {
    const html = generateTopBar('test', 'https://test.sites.megabyte.space');
    expect(html).toContain('padding-top:44px');
  });

  it('links to the main domain', () => {
    const html = generateTopBar('test', 'https://test.sites.megabyte.space');
    expect(html).toContain(`https://${DOMAINS.SITES_BASE}`);
  });

  it('escapes slug in URL to prevent XSS', () => {
    const html = generateTopBar('a"onmouseover="alert(1)', 'https://test.sites.megabyte.space');
    expect(html).not.toContain('"onmouseover="');
    expect(html).toContain(encodeURIComponent('a"onmouseover="alert(1)'));
  });

  it('has correct z-index for overlay', () => {
    const html = generateTopBar('test', 'https://test.sites.megabyte.space');
    expect(html).toContain('z-index:99999');
  });

  it('is wrapped in HTML comments for identification', () => {
    const html = generateTopBar('test', 'https://test.sites.megabyte.space');
    expect(html).toContain('<!-- Project Sites Top Bar -->');
    expect(html).toContain('<!-- End Project Sites Top Bar -->');
  });

  it('generates non-empty HTML for various slugs', () => {
    const slugs = ['a-b-c', 'my-business-123', 'test'];
    for (const slug of slugs) {
      const html = generateTopBar(slug, `https://${slug}.sites.megabyte.space`);
      expect(html.length).toBeGreaterThan(100);
    }
  });

  it('uses fixed positioning', () => {
    const html = generateTopBar('test', 'https://test.sites.megabyte.space');
    expect(html).toContain('position:fixed');
    expect(html).toContain('top:0');
  });
});
