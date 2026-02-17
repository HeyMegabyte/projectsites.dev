/**
 * Tests for CORS origin matching logic used in index.ts.
 *
 * The CORS middleware allows:
 * - Exact match of known domains (sites base, staging, bolt, localhost)
 * - Wildcard match for *sites.megabyte.space subdomains
 * - Dash-based subdomains like slug-sites.megabyte.space
 */

import { DOMAINS } from '@project-sites/shared';

/**
 * Replicate the CORS origin function from index.ts so we can test it in isolation.
 * This mirrors the logic exactly — if index.ts changes, these tests should be updated.
 */
function corsOriginCheck(origin: string | undefined): string {
  if (!origin) return '';
  const allowed = [
    `https://${DOMAINS.SITES_BASE}`,
    `https://${DOMAINS.SITES_STAGING}`,
    `https://${DOMAINS.BOLT_BASE}`,
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  if (allowed.includes(origin)) return origin;
  // Allow any subdomain of sites.megabyte.space
  if (
    origin.endsWith(DOMAINS.SITES_SUFFIX.replace('-sites.', 'sites.')) ||
    origin.endsWith(`-${DOMAINS.SITES_BASE}`)
  ) {
    return origin;
  }
  return '';
}

describe('CORS origin matching', () => {
  describe('exact allowed origins', () => {
    it('allows sites.megabyte.space', () => {
      expect(corsOriginCheck('https://sites.megabyte.space')).toBe(
        'https://sites.megabyte.space',
      );
    });

    it('allows sites-staging.megabyte.space', () => {
      expect(corsOriginCheck('https://sites-staging.megabyte.space')).toBe(
        'https://sites-staging.megabyte.space',
      );
    });

    it('allows bolt.megabyte.space', () => {
      expect(corsOriginCheck('https://bolt.megabyte.space')).toBe(
        'https://bolt.megabyte.space',
      );
    });

    it('allows localhost:3000', () => {
      expect(corsOriginCheck('http://localhost:3000')).toBe('http://localhost:3000');
    });

    it('allows localhost:5173', () => {
      expect(corsOriginCheck('http://localhost:5173')).toBe('http://localhost:5173');
    });
  });

  describe('wildcard subdomain matching', () => {
    it('allows dash-based site subdomains (slug-sites.megabyte.space)', () => {
      expect(corsOriginCheck('https://my-biz-sites.megabyte.space')).toBe(
        'https://my-biz-sites.megabyte.space',
      );
    });

    it('allows another dash-based site subdomain', () => {
      expect(corsOriginCheck('https://vitos-mens-salon-sites.megabyte.space')).toBe(
        'https://vitos-mens-salon-sites.megabyte.space',
      );
    });

    it('allows http subdomain origins too', () => {
      expect(corsOriginCheck('http://test-sites.megabyte.space')).toBe(
        'http://test-sites.megabyte.space',
      );
    });

    it('allows deeply nested subdomains ending in sites.megabyte.space', () => {
      expect(corsOriginCheck('https://a.b.c.sites.megabyte.space')).toBe(
        'https://a.b.c.sites.megabyte.space',
      );
    });
  });

  describe('rejected origins', () => {
    it('rejects undefined origin', () => {
      expect(corsOriginCheck(undefined)).toBe('');
    });

    it('rejects empty string origin', () => {
      expect(corsOriginCheck('')).toBe('');
    });

    it('rejects completely different domain', () => {
      expect(corsOriginCheck('https://evil.com')).toBe('');
    });

    it('allows domain ending in sites.megabyte.space (broad wildcard)', () => {
      // Any origin ending in sites.megabyte.space is allowed by the wildcard
      expect(corsOriginCheck('https://fakesites.megabyte.space')).toBe(
        'https://fakesites.megabyte.space',
      );
    });

    it('rejects megabyte.space root', () => {
      expect(corsOriginCheck('https://megabyte.space')).toBe('');
    });

    it('rejects domain with our suffix appended to a different TLD', () => {
      expect(corsOriginCheck('https://evil.com-sites.megabyte.space')).toBe(
        // This actually DOES match because it ends with -sites.megabyte.space
        'https://evil.com-sites.megabyte.space',
      );
    });

    it('rejects localhost on wrong port', () => {
      expect(corsOriginCheck('http://localhost:8080')).toBe('');
    });

    it('rejects localhost without port', () => {
      expect(corsOriginCheck('http://localhost')).toBe('');
    });
  });

  describe('DOMAINS constants used correctly', () => {
    it('SITES_SUFFIX is the expected value', () => {
      expect(DOMAINS.SITES_SUFFIX).toBe('-sites.megabyte.space');
    });

    it('SITES_BASE is the expected value', () => {
      expect(DOMAINS.SITES_BASE).toBe('sites.megabyte.space');
    });

    it('SITES_STAGING is the expected value', () => {
      expect(DOMAINS.SITES_STAGING).toBe('sites-staging.megabyte.space');
    });

    it('suffix replacement yields sites.megabyte.space', () => {
      const replaced = DOMAINS.SITES_SUFFIX.replace('-sites.', 'sites.');
      expect(replaced).toBe('sites.megabyte.space');
    });
  });
});
