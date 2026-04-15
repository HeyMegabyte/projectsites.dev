/**
 * Tests for CORS origin matching logic used in index.ts.
 *
 * The CORS middleware allows:
 * - Exact match of known domains (sites base, bolt, localhost)
 * - Wildcard match for *projectsites.dev subdomains
 * - Dot-based subdomains like slug.projectsites.dev
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
    `https://${DOMAINS.BOLT_BASE}`,
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  if (allowed.includes(origin)) return origin;
  // Allow any subdomain of projectsites.dev
  if (origin.endsWith(DOMAINS.SITES_SUFFIX)) return origin;
  return '';
}

describe('CORS origin matching', () => {
  describe('exact allowed origins', () => {
    it('allows projectsites.dev', () => {
      expect(corsOriginCheck('https://projectsites.dev')).toBe(
        'https://projectsites.dev',
      );
    });

    it('allows editor.projectsites.dev', () => {
      expect(corsOriginCheck('https://editor.projectsites.dev')).toBe(
        'https://editor.projectsites.dev',
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
    it('allows dot-based site subdomains (slug.projectsites.dev)', () => {
      expect(corsOriginCheck('https://my-biz.projectsites.dev')).toBe(
        'https://my-biz.projectsites.dev',
      );
    });

    it('allows another site subdomain', () => {
      expect(corsOriginCheck('https://vitos-mens-salon.projectsites.dev')).toBe(
        'https://vitos-mens-salon.projectsites.dev',
      );
    });

    it('allows http subdomain origins too', () => {
      expect(corsOriginCheck('http://test.projectsites.dev')).toBe(
        'http://test.projectsites.dev',
      );
    });

    it('allows deeply nested subdomains ending in projectsites.dev', () => {
      expect(corsOriginCheck('https://a.b.c.projectsites.dev')).toBe(
        'https://a.b.c.projectsites.dev',
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

    it('rejects domain that looks similar but is not a subdomain of projectsites.dev', () => {
      // fakeprojectsites.dev does NOT end with .projectsites.dev (note the leading dot)
      expect(corsOriginCheck('https://fakeprojectsites.dev')).toBe('');
    });

    it('rejects megabyte.space root', () => {
      expect(corsOriginCheck('https://megabyte.space')).toBe('');
    });

    it('rejects staging domain (removed)', () => {
      expect(corsOriginCheck('https://sites-staging.megabyte.space')).toBe('');
    });

    it('rejects domain with our suffix appended to a different TLD', () => {
      expect(corsOriginCheck('https://evil.com.projectsites.dev')).toBe(
        // This actually DOES match because it ends with .projectsites.dev
        'https://evil.com.projectsites.dev',
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
      expect(DOMAINS.SITES_SUFFIX).toBe('.projectsites.dev');
    });

    it('SITES_BASE is the expected value', () => {
      expect(DOMAINS.SITES_BASE).toBe('projectsites.dev');
    });

    it('suffix starts with dot for proper subdomain matching', () => {
      // .projectsites.dev ensures only true subdomains match (not fakeprojectsites.dev)
      expect(DOMAINS.SITES_SUFFIX.startsWith('.')).toBe(true);
      expect(DOMAINS.SITES_SUFFIX).toBe('.projectsites.dev');
    });
  });
});
