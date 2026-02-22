import { z } from 'zod';
import {
  slugSchema,
  emailSchema,
  phoneSchema,
  hostnameSchema,
  httpsUrlSchema,
  safeStringSchema,
  nameSchema,
  paginationSchema,
  confidenceScoreSchema,
  metadataSchema,
} from '../schemas/base';
import { createOrgSchema, membershipSchema } from '../schemas/org';
import { createSiteSchema, siteSchema } from '../schemas/site';
import { createCheckoutSessionSchema, createEmbeddedCheckoutSchema, entitlementsSchema, saleWebhookPayloadSchema } from '../schemas/billing';
import { createMagicLinkSchema, googleOAuthCallbackSchema } from '../schemas/auth';
import { createAuditLogSchema } from '../schemas/audit';
import { webhookIngestionSchema } from '../schemas/webhook';
import { createWorkflowJobSchema, jobEnvelopeSchema } from '../schemas/workflow';
import { envConfigSchema, validateEnvConfig } from '../schemas/config';
import { healthCheckSchema } from '../schemas/api';
import { createHostnameSchema, hostnameRecordSchema } from '../schemas/hostname';

// ─── Base Schemas ────────────────────────────────────────────

describe('slugSchema', () => {
  it('accepts valid slugs', () => {
    expect(slugSchema.parse('my-business')).toBe('my-business');
    expect(slugSchema.parse('abc')).toBe('abc');
    expect(slugSchema.parse('a1b2c3')).toBe('a1b2c3');
  });

  it('rejects slugs shorter than 3 chars', () => {
    expect(() => slugSchema.parse('ab')).toThrow();
  });

  it('rejects slugs longer than 63 chars', () => {
    expect(() => slugSchema.parse('a'.repeat(64))).toThrow();
  });

  it('rejects slugs starting with hyphen', () => {
    expect(() => slugSchema.parse('-bad-slug')).toThrow();
  });

  it('rejects slugs ending with hyphen', () => {
    expect(() => slugSchema.parse('bad-slug-')).toThrow();
  });

  it('rejects slugs with uppercase', () => {
    expect(() => slugSchema.parse('MyBusiness')).toThrow();
  });

  it('rejects slugs with special characters', () => {
    expect(() => slugSchema.parse('my_business!')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => slugSchema.parse('')).toThrow();
  });

  it('rejects slugs with spaces', () => {
    expect(() => slugSchema.parse('my business')).toThrow();
  });

  it('rejects null/undefined', () => {
    expect(() => slugSchema.parse(null)).toThrow();
    expect(() => slugSchema.parse(undefined)).toThrow();
  });
});

describe('emailSchema', () => {
  it('accepts valid emails and lowercases', () => {
    expect(emailSchema.parse('Test@Example.COM')).toBe('test@example.com');
  });

  it('rejects invalid emails', () => {
    expect(() => emailSchema.parse('not-an-email')).toThrow();
    expect(() => emailSchema.parse('@no-local')).toThrow();
    expect(() => emailSchema.parse('no-domain@')).toThrow();
  });

  it('rejects emails longer than 254 chars', () => {
    expect(() => emailSchema.parse('a'.repeat(250) + '@b.com')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => emailSchema.parse('')).toThrow();
  });
});

describe('phoneSchema', () => {
  it('accepts E.164 phones', () => {
    expect(phoneSchema.parse('+14155551234')).toBe('+14155551234');
  });

  it('rejects phones without + prefix', () => {
    expect(() => phoneSchema.parse('14155551234')).toThrow();
  });

  it('rejects phones starting with +0', () => {
    expect(() => phoneSchema.parse('+04155551234')).toThrow();
  });

  it('rejects too short phones', () => {
    expect(() => phoneSchema.parse('+1234')).toThrow();
  });

  it('rejects too long phones', () => {
    expect(() => phoneSchema.parse('+1234567890123456')).toThrow();
  });
});

describe('hostnameSchema', () => {
  it('accepts valid hostnames', () => {
    expect(hostnameSchema.parse('example.com')).toBe('example.com');
    expect(hostnameSchema.parse('sub.example.com')).toBe('sub.example.com');
    expect(hostnameSchema.parse('my-site-sites.megabyte.space')).toBe('my-site-sites.megabyte.space');
  });

  it('rejects hostnames without TLD', () => {
    expect(() => hostnameSchema.parse('localhost')).toThrow();
  });

  it('rejects hostnames with invalid chars', () => {
    expect(() => hostnameSchema.parse('ex ample.com')).toThrow();
    expect(() => hostnameSchema.parse('ex@mple.com')).toThrow();
  });

  it('rejects too long hostnames', () => {
    expect(() => hostnameSchema.parse('a'.repeat(254) + '.com')).toThrow();
  });
});

describe('httpsUrlSchema', () => {
  it('accepts valid HTTPS URLs', () => {
    expect(httpsUrlSchema.parse('https://example.com')).toBe('https://example.com');
  });

  it('rejects HTTP URLs', () => {
    expect(() => httpsUrlSchema.parse('http://example.com')).toThrow();
  });

  it('rejects non-URL strings', () => {
    expect(() => httpsUrlSchema.parse('not-a-url')).toThrow();
  });
});

describe('safeStringSchema', () => {
  it('accepts normal strings', () => {
    expect(safeStringSchema.parse('Hello World')).toBe('Hello World');
  });

  it('rejects script tags', () => {
    expect(() => safeStringSchema.parse('<script>alert("xss")</script>')).toThrow();
  });

  it('rejects javascript: URIs', () => {
    expect(() => safeStringSchema.parse('javascript:alert(1)')).toThrow();
  });

  it('rejects data: URIs', () => {
    expect(() => safeStringSchema.parse('data:text/html,<h1>hi</h1>')).toThrow();
  });

  it('rejects strings over 1000 chars', () => {
    expect(() => safeStringSchema.parse('a'.repeat(1001))).toThrow();
  });
});

describe('paginationSchema', () => {
  it('applies defaults', () => {
    const result = paginationSchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('clamps limit to 100', () => {
    expect(() => paginationSchema.parse({ limit: 200 })).toThrow();
  });

  it('rejects negative offset', () => {
    expect(() => paginationSchema.parse({ offset: -1 })).toThrow();
  });

  it('coerces string numbers', () => {
    const result = paginationSchema.parse({ limit: '50', offset: '10' });
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(10);
  });
});

describe('confidenceScoreSchema', () => {
  it('accepts 0-100', () => {
    expect(confidenceScoreSchema.parse(0)).toBe(0);
    expect(confidenceScoreSchema.parse(100)).toBe(100);
    expect(confidenceScoreSchema.parse(50)).toBe(50);
  });

  it('rejects out of range', () => {
    expect(() => confidenceScoreSchema.parse(-1)).toThrow();
    expect(() => confidenceScoreSchema.parse(101)).toThrow();
  });

  it('rejects non-integers', () => {
    expect(() => confidenceScoreSchema.parse(50.5)).toThrow();
  });
});

describe('metadataSchema', () => {
  it('accepts valid objects', () => {
    expect(metadataSchema.parse({ key: 'value' })).toEqual({ key: 'value' });
  });

  it('rejects oversized metadata', () => {
    const huge = { data: 'x'.repeat(70000) };
    expect(() => metadataSchema.parse(huge)).toThrow();
  });
});

// ─── Org Schemas ─────────────────────────────────────────────

describe('createOrgSchema', () => {
  it('accepts valid org creation', () => {
    const result = createOrgSchema.parse({ name: 'My Business', slug: 'my-business' });
    expect(result.name).toBe('My Business');
    expect(result.slug).toBe('my-business');
  });

  it('rejects script injection in name', () => {
    expect(() => createOrgSchema.parse({ name: '<script>alert(1)</script>', slug: 'valid' })).toThrow();
  });

  it('rejects invalid slugs', () => {
    expect(() => createOrgSchema.parse({ name: 'Valid', slug: 'NO' })).toThrow();
  });
});

// ─── Site Schemas ────────────────────────────────────────────

describe('createSiteSchema', () => {
  it('accepts valid site creation with just business name', () => {
    const result = createSiteSchema.parse({ business_name: 'Joe Pizza' });
    expect(result.business_name).toBe('Joe Pizza');
  });

  it('accepts full site creation', () => {
    const result = createSiteSchema.parse({
      business_name: 'Joe Pizza',
      slug: 'joe-pizza',
      business_phone: '+14155551234',
      business_email: 'joe@pizza.com',
      business_address: '123 Main St',
      google_place_id: 'ChIJ...',
    });
    expect(result.slug).toBe('joe-pizza');
  });

  it('rejects empty business name', () => {
    expect(() => createSiteSchema.parse({ business_name: '' })).toThrow();
  });

  it('rejects script injection in business name', () => {
    expect(() => createSiteSchema.parse({ business_name: '<script>alert(1)</script>' })).toThrow();
  });

  it('rejects invalid emails', () => {
    expect(() => createSiteSchema.parse({ business_name: 'Valid', business_email: 'not-email' })).toThrow();
  });
});

// ─── Auth Schemas ────────────────────────────────────────────

describe('createMagicLinkSchema', () => {
  it('accepts valid email', () => {
    const result = createMagicLinkSchema.parse({ email: 'test@example.com' });
    expect(result.email).toBe('test@example.com');
  });

  it('lowercases email', () => {
    const result = createMagicLinkSchema.parse({ email: 'Test@Example.COM' });
    expect(result.email).toBe('test@example.com');
  });

  it('rejects invalid email', () => {
    expect(() => createMagicLinkSchema.parse({ email: 'invalid' })).toThrow();
  });
});

describe('googleOAuthCallbackSchema', () => {
  it('accepts valid callback params', () => {
    const result = googleOAuthCallbackSchema.parse({ code: 'auth-code', state: 'csrf-state' });
    expect(result.code).toBe('auth-code');
  });

  it('rejects empty code', () => {
    expect(() => googleOAuthCallbackSchema.parse({ code: '', state: 'valid' })).toThrow();
  });

  it('rejects missing state', () => {
    expect(() => googleOAuthCallbackSchema.parse({ code: 'valid' })).toThrow();
  });
});

// ─── Billing Schemas ─────────────────────────────────────────

describe('createCheckoutSessionSchema', () => {
  const validUuid = '00000000-0000-4000-8000-000000000001';

  it('accepts valid checkout session', () => {
    const result = createCheckoutSessionSchema.parse({
      org_id: validUuid,
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
    });
    expect(result.org_id).toBe(validUuid);
  });

  it('rejects non-uuid org_id', () => {
    expect(() =>
      createCheckoutSessionSchema.parse({
        org_id: 'not-uuid',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      }),
    ).toThrow();
  });

  it('rejects non-URL success_url', () => {
    expect(() =>
      createCheckoutSessionSchema.parse({
        org_id: validUuid,
        success_url: 'not-a-url',
        cancel_url: 'https://example.com/cancel',
      }),
    ).toThrow();
  });
});

describe('createEmbeddedCheckoutSchema', () => {
  const validUuid = '00000000-0000-4000-8000-000000000001';

  it('accepts valid embedded checkout payload', () => {
    const result = createEmbeddedCheckoutSchema.parse({
      org_id: validUuid,
      return_url: 'https://example.com/?billing=success',
    });
    expect(result.org_id).toBe(validUuid);
    expect(result.return_url).toBe('https://example.com/?billing=success');
  });

  it('accepts optional site_id', () => {
    const siteUuid = '00000000-0000-4000-8000-000000000002';
    const result = createEmbeddedCheckoutSchema.parse({
      org_id: validUuid,
      site_id: siteUuid,
      return_url: 'https://example.com/?billing=success',
    });
    expect(result.site_id).toBe(siteUuid);
  });

  it('rejects non-uuid org_id', () => {
    expect(() =>
      createEmbeddedCheckoutSchema.parse({
        org_id: 'not-uuid',
        return_url: 'https://example.com/?billing=success',
      }),
    ).toThrow();
  });

  it('rejects non-URL return_url', () => {
    expect(() =>
      createEmbeddedCheckoutSchema.parse({
        org_id: validUuid,
        return_url: 'not-a-url',
      }),
    ).toThrow();
  });
});

describe('entitlementsSchema', () => {
  const validUuid = '00000000-0000-4000-8000-000000000001';

  it('accepts valid free entitlements', () => {
    const result = entitlementsSchema.parse({
      org_id: validUuid,
      plan: 'free',
      topBarHidden: false,
      maxCustomDomains: 0,
      chatEnabled: true,
      analyticsEnabled: false,
    });
    expect(result.topBarHidden).toBe(false);
  });

  it('accepts valid paid entitlements', () => {
    const result = entitlementsSchema.parse({
      org_id: validUuid,
      plan: 'paid',
      topBarHidden: true,
      maxCustomDomains: 10,
      chatEnabled: true,
      analyticsEnabled: true,
    });
    expect(result.topBarHidden).toBe(true);
    expect(result.maxCustomDomains).toBe(10);
  });
});

// ─── Webhook Schemas ─────────────────────────────────────────

describe('webhookIngestionSchema', () => {
  it('accepts valid webhook', () => {
    const result = webhookIngestionSchema.parse({
      provider: 'stripe',
      event_id: 'evt_123',
      event_type: 'checkout.session.completed',
      raw_body: '{"data":{}}',
    });
    expect(result.provider).toBe('stripe');
  });

  it('rejects unknown provider', () => {
    expect(() =>
      webhookIngestionSchema.parse({
        provider: 'unknown',
        event_id: 'evt_123',
        event_type: 'test',
        raw_body: '{}',
      }),
    ).toThrow();
  });

  it('rejects oversized raw body', () => {
    expect(() =>
      webhookIngestionSchema.parse({
        provider: 'stripe',
        event_id: 'evt_123',
        event_type: 'test',
        raw_body: 'x'.repeat(256 * 1024 + 1),
      }),
    ).toThrow();
  });

  it('rejects empty event_id', () => {
    expect(() =>
      webhookIngestionSchema.parse({
        provider: 'stripe',
        event_id: '',
        event_type: 'test',
        raw_body: '{}',
      }),
    ).toThrow();
  });
});

// ─── Workflow Schemas ────────────────────────────────────────

describe('createWorkflowJobSchema', () => {
  const validUuid = '00000000-0000-4000-8000-000000000001';

  it('accepts valid job creation', () => {
    const result = createWorkflowJobSchema.parse({
      job_name: 'generate_site',
      org_id: validUuid,
    });
    expect(result.job_name).toBe('generate_site');
    expect(result.max_attempts).toBe(3);
  });

  it('rejects empty job_name', () => {
    expect(() => createWorkflowJobSchema.parse({ job_name: '', org_id: validUuid })).toThrow();
  });

  it('rejects max_attempts > 10', () => {
    expect(() =>
      createWorkflowJobSchema.parse({
        job_name: 'test',
        org_id: validUuid,
        max_attempts: 20,
      }),
    ).toThrow();
  });
});

// ─── Config Schema ───────────────────────────────────────────

describe('envConfigSchema', () => {
  const validConfig = {
    ENVIRONMENT: 'test',
    STRIPE_SECRET_KEY: 'sk_test_abc123',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_abc123',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    CF_API_TOKEN: 'cf-token',
    CF_ZONE_ID: 'zone-123',
    SENDGRID_API_KEY: 'sg-key',
    GOOGLE_CLIENT_ID: 'google-id',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GOOGLE_PLACES_API_KEY: 'places-key',
    SENTRY_DSN: 'https://sentry.example.com/123',
  };

  it('accepts valid test config', () => {
    const result = envConfigSchema.parse(validConfig);
    expect(result.ENVIRONMENT).toBe('test');
  });

  it('accepts valid production config with live keys', () => {
    const prodConfig = {
      ...validConfig,
      ENVIRONMENT: 'production',
      STRIPE_SECRET_KEY: 'sk_live_abc123',
      STRIPE_PUBLISHABLE_KEY: 'pk_live_abc123',
    };
    const result = envConfigSchema.parse(prodConfig);
    expect(result.ENVIRONMENT).toBe('production');
  });

  it('rejects production with test Stripe keys', () => {
    const badConfig = {
      ...validConfig,
      ENVIRONMENT: 'production',
      STRIPE_SECRET_KEY: 'sk_test_abc123',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_abc123',
    };
    expect(() => envConfigSchema.parse(badConfig)).toThrow();
  });

  it('rejects non-production with live Stripe keys', () => {
    const badConfig = {
      ...validConfig,
      ENVIRONMENT: 'staging',
      STRIPE_SECRET_KEY: 'sk_live_abc123',
      STRIPE_PUBLISHABLE_KEY: 'pk_live_abc123',
    };
    expect(() => envConfigSchema.parse(badConfig)).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => envConfigSchema.parse({ ENVIRONMENT: 'test' })).toThrow();
  });

  it('defaults METERING_PROVIDER to internal', () => {
    const result = envConfigSchema.parse(validConfig);
    expect(result.METERING_PROVIDER).toBe('internal');
  });

  it('accepts lago metering provider', () => {
    const result = envConfigSchema.parse({ ...validConfig, METERING_PROVIDER: 'lago' });
    expect(result.METERING_PROVIDER).toBe('lago');
  });
});

describe('validateEnvConfig', () => {
  it('throws on invalid config with descriptive error', () => {
    expect(() => validateEnvConfig({})).toThrow();
  });
});

// ─── Hostname Schemas ────────────────────────────────────────

describe('createHostnameSchema', () => {
  const validUuid = '00000000-0000-4000-8000-000000000001';

  it('accepts valid free subdomain', () => {
    const result = createHostnameSchema.parse({
      site_id: validUuid,
      hostname: 'my-biz-sites.megabyte.space',
      type: 'free_subdomain',
    });
    expect(result.type).toBe('free_subdomain');
  });

  it('accepts valid custom CNAME', () => {
    const result = createHostnameSchema.parse({
      site_id: validUuid,
      hostname: 'www.example.com',
      type: 'custom_cname',
    });
    expect(result.type).toBe('custom_cname');
  });

  it('rejects invalid hostname', () => {
    expect(() =>
      createHostnameSchema.parse({
        site_id: validUuid,
        hostname: 'not a hostname',
        type: 'custom_cname',
      }),
    ).toThrow();
  });

  it('rejects invalid type', () => {
    expect(() =>
      createHostnameSchema.parse({
        site_id: validUuid,
        hostname: 'example.com',
        type: 'invalid',
      }),
    ).toThrow();
  });
});

// ─── Health Check Schema ─────────────────────────────────────

describe('healthCheckSchema', () => {
  it('accepts valid health check', () => {
    const result = healthCheckSchema.parse({
      status: 'ok',
      version: '1.0.0',
      environment: 'test',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    expect(result.status).toBe('ok');
  });

  it('accepts health check with sub-checks', () => {
    const result = healthCheckSchema.parse({
      status: 'degraded',
      version: '1.0.0',
      environment: 'production',
      timestamp: '2024-01-01T00:00:00.000Z',
      checks: {
        db: { status: 'ok', latency_ms: 12 },
        kv: { status: 'error', message: 'timeout' },
      },
    });
    expect(result.checks?.db?.status).toBe('ok');
  });
});
