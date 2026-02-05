/**
 * Additional schema tests for all untested/under-tested schemas.
 * Covers: nameSchema, uuidSchema, errorEnvelopeSchema, successEnvelopeSchema,
 * orgSchema, membershipSchema, updateMembershipSchema, siteSchema, updateSiteSchema,
 * confidenceAttributeSchema, subscriptionSchema, saleWebhookPayloadSchema,
 * auditLogSchema, createAuditLogSchema, webhookEventSchema, workflowJobSchema,
 * jobEnvelopeSchema, hostnameRecordSchema, hostnameStatusSchema,
 * analyticsDailySchema, funnelEventSchema, usageEventSchema,
 * apiErrorSchema, userSchema, sessionSchema, verifyMagicLinkSchema,
 * createPhoneOtpSchema, loginResponseSchema
 */

import { z } from 'zod';
import {
  uuidSchema,
  nameSchema,
  errorEnvelopeSchema,
  successEnvelopeSchema,
  slugSchema,
} from '../schemas/base';
import {
  orgSchema,
  membershipSchema,
  createMembershipSchema,
  updateMembershipSchema,
} from '../schemas/org';
import {
  siteSchema,
  updateSiteSchema,
  confidenceAttributeSchema,
  researchDataSchema,
} from '../schemas/site';
import { subscriptionSchema, saleWebhookPayloadSchema } from '../schemas/billing';
import {
  userSchema,
  sessionSchema,
  verifyMagicLinkSchema,
  createPhoneOtpSchema,
  createGoogleOAuthSchema,
  loginResponseSchema,
} from '../schemas/auth';
import { auditLogSchema, createAuditLogSchema } from '../schemas/audit';
import { webhookEventSchema } from '../schemas/webhook';
import { workflowJobSchema, jobEnvelopeSchema } from '../schemas/workflow';
import { hostnameRecordSchema, hostnameStatusSchema } from '../schemas/hostname';
import { analyticsDailySchema, funnelEventSchema, usageEventSchema } from '../schemas/analytics';
import { apiErrorSchema } from '../schemas/api';

const UUID = '00000000-0000-4000-8000-000000000001';
const NOW = '2024-01-15T10:30:00.000Z';

// ─── uuidSchema ──────────────────────────────────────────────

describe('uuidSchema', () => {
  it('accepts valid UUID v4', () => {
    expect(uuidSchema.parse(UUID)).toBe(UUID);
  });

  it('accepts lowercase UUIDs', () => {
    expect(uuidSchema.parse('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')).toBeTruthy();
  });

  it('rejects non-UUID strings', () => {
    expect(() => uuidSchema.parse('not-a-uuid')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => uuidSchema.parse('')).toThrow();
  });

  it('rejects null', () => {
    expect(() => uuidSchema.parse(null)).toThrow();
  });

  it('rejects numbers', () => {
    expect(() => uuidSchema.parse(12345)).toThrow();
  });
});

// ─── nameSchema ──────────────────────────────────────────────

describe('nameSchema', () => {
  it('accepts normal names', () => {
    expect(nameSchema.parse('My Business')).toBe('My Business');
  });

  it('accepts single character name', () => {
    expect(nameSchema.parse('A')).toBe('A');
  });

  it('accepts name at max length (200)', () => {
    const name = 'a'.repeat(200);
    expect(nameSchema.parse(name)).toBe(name);
  });

  it('rejects name over 200 chars', () => {
    expect(() => nameSchema.parse('a'.repeat(201))).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => nameSchema.parse('')).toThrow();
  });

  it('rejects script injection', () => {
    expect(() => nameSchema.parse('<script>alert(1)</script>')).toThrow();
  });

  it('accepts names with special chars (no script tags)', () => {
    expect(nameSchema.parse("O'Brien & Sons")).toBe("O'Brien & Sons");
  });

  it('accepts names with unicode', () => {
    expect(nameSchema.parse('Café München')).toBe('Café München');
  });
});

// ─── errorEnvelopeSchema ─────────────────────────────────────

describe('errorEnvelopeSchema', () => {
  it('accepts valid error envelope', () => {
    const result = errorEnvelopeSchema.parse({
      error: { code: 'ERR', message: 'Something went wrong' },
    });
    expect(result.error.code).toBe('ERR');
  });

  it('accepts error with request_id', () => {
    const result = errorEnvelopeSchema.parse({
      error: { code: 'ERR', message: 'test', request_id: 'req-123' },
    });
    expect(result.error.request_id).toBe('req-123');
  });

  it('accepts error with details', () => {
    const result = errorEnvelopeSchema.parse({
      error: { code: 'ERR', message: 'test', details: { field: 'name' } },
    });
    expect(result.error.details).toEqual({ field: 'name' });
  });

  it('rejects missing code', () => {
    expect(() => errorEnvelopeSchema.parse({ error: { message: 'test' } })).toThrow();
  });

  it('rejects missing message', () => {
    expect(() => errorEnvelopeSchema.parse({ error: { code: 'ERR' } })).toThrow();
  });
});

// ─── successEnvelopeSchema ───────────────────────────────────

describe('successEnvelopeSchema', () => {
  it('wraps data with correct type', () => {
    const schema = successEnvelopeSchema(z.object({ id: z.string() }));
    const result = schema.parse({ data: { id: 'abc' } });
    expect(result.data.id).toBe('abc');
  });

  it('accepts optional meta', () => {
    const schema = successEnvelopeSchema(z.string());
    const result = schema.parse({
      data: 'hello',
      meta: { request_id: 'req-1', total: 100, limit: 20, offset: 0 },
    });
    expect(result.meta?.total).toBe(100);
  });

  it('allows missing meta', () => {
    const schema = successEnvelopeSchema(z.number());
    const result = schema.parse({ data: 42 });
    expect(result.data).toBe(42);
    expect(result.meta).toBeUndefined();
  });

  it('rejects when data type is wrong', () => {
    const schema = successEnvelopeSchema(z.string());
    expect(() => schema.parse({ data: 42 })).toThrow();
  });
});

// ─── orgSchema ───────────────────────────────────────────────

describe('orgSchema', () => {
  it('accepts valid org', () => {
    const result = orgSchema.parse({
      id: UUID,
      name: 'My Org',
      slug: 'my-org',
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
    });
    expect(result.name).toBe('My Org');
  });

  it('accepts org with deleted_at', () => {
    const result = orgSchema.parse({
      id: UUID,
      name: 'Deleted Org',
      slug: 'deleted-org',
      created_at: NOW,
      updated_at: NOW,
      deleted_at: NOW,
    });
    expect(result.deleted_at).toBe(NOW);
  });

  it('rejects org without required fields', () => {
    expect(() => orgSchema.parse({ id: UUID })).toThrow();
  });

  it('rejects org with invalid slug', () => {
    expect(() =>
      orgSchema.parse({
        id: UUID,
        name: 'Test',
        slug: 'BAD',
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
      }),
    ).toThrow();
  });
});

// ─── membershipSchema ────────────────────────────────────────

describe('membershipSchema', () => {
  const validMembership = {
    id: UUID,
    org_id: UUID,
    user_id: UUID,
    role: 'member' as const,
    billing_admin: false,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  };

  it('accepts valid membership', () => {
    const result = membershipSchema.parse(validMembership);
    expect(result.role).toBe('member');
  });

  it('accepts all valid roles', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      const result = membershipSchema.parse({ ...validMembership, role });
      expect(result.role).toBe(role);
    }
  });

  it('rejects invalid role', () => {
    expect(() => membershipSchema.parse({ ...validMembership, role: 'superadmin' })).toThrow();
  });

  it('defaults billing_admin to false', () => {
    const result = createMembershipSchema.parse({
      user_id: UUID,
      org_id: UUID,
      role: 'admin',
    });
    expect(result.billing_admin).toBe(false);
  });
});

// ─── updateMembershipSchema ──────────────────────────────────

describe('updateMembershipSchema', () => {
  it('accepts partial role update', () => {
    const result = updateMembershipSchema.parse({ role: 'admin' });
    expect(result.role).toBe('admin');
  });

  it('accepts partial billing_admin update', () => {
    const result = updateMembershipSchema.parse({ billing_admin: true });
    expect(result.billing_admin).toBe(true);
  });

  it('accepts empty update', () => {
    const result = updateMembershipSchema.parse({});
    expect(result.role).toBeUndefined();
  });

  it('rejects invalid role in update', () => {
    expect(() => updateMembershipSchema.parse({ role: 'invalid' })).toThrow();
  });
});

// ─── siteSchema ──────────────────────────────────────────────

describe('siteSchema', () => {
  const validSite = {
    id: UUID,
    org_id: UUID,
    slug: 'my-site',
    business_name: 'My Site',
    business_phone: null,
    business_email: null,
    business_address: null,
    google_place_id: null,
    bolt_chat_id: null,
    current_build_version: null,
    status: 'draft' as const,
    lighthouse_score: null,
    lighthouse_last_run: null,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  };

  it('accepts valid site', () => {
    const result = siteSchema.parse(validSite);
    expect(result.slug).toBe('my-site');
  });

  it('accepts all valid statuses', () => {
    for (const status of ['draft', 'building', 'published', 'archived']) {
      const result = siteSchema.parse({ ...validSite, status });
      expect(result.status).toBe(status);
    }
  });

  it('rejects invalid status', () => {
    expect(() => siteSchema.parse({ ...validSite, status: 'deleted' })).toThrow();
  });

  it('accepts lighthouse score in range', () => {
    const result = siteSchema.parse({ ...validSite, lighthouse_score: 95 });
    expect(result.lighthouse_score).toBe(95);
  });

  it('rejects lighthouse score > 100', () => {
    expect(() => siteSchema.parse({ ...validSite, lighthouse_score: 150 })).toThrow();
  });

  it('rejects lighthouse score < 0', () => {
    expect(() => siteSchema.parse({ ...validSite, lighthouse_score: -1 })).toThrow();
  });
});

// ─── updateSiteSchema ────────────────────────────────────────

describe('updateSiteSchema', () => {
  it('accepts partial update with business name', () => {
    const result = updateSiteSchema.parse({ business_name: 'New Name' });
    expect(result.business_name).toBe('New Name');
  });

  it('accepts setting nullable fields to null', () => {
    const result = updateSiteSchema.parse({ business_phone: null, business_email: null });
    expect(result.business_phone).toBeNull();
  });

  it('accepts status change', () => {
    const result = updateSiteSchema.parse({ status: 'published' });
    expect(result.status).toBe('published');
  });

  it('accepts build version update', () => {
    const result = updateSiteSchema.parse({ current_build_version: 'v1.2.3' });
    expect(result.current_build_version).toBe('v1.2.3');
  });

  it('accepts empty update', () => {
    const result = updateSiteSchema.parse({});
    expect(Object.keys(result).length).toBe(0);
  });

  it('rejects invalid status', () => {
    expect(() => updateSiteSchema.parse({ status: 'invalid' })).toThrow();
  });
});

// ─── confidenceAttributeSchema ───────────────────────────────

describe('confidenceAttributeSchema', () => {
  const valid = {
    id: UUID,
    org_id: UUID,
    site_id: UUID,
    attribute_name: 'business_name',
    attribute_value: 'Joe Pizza',
    confidence: 95,
    source: 'google_places',
    rationale: 'Matched via Places API',
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  };

  it('accepts valid confidence attribute', () => {
    const result = confidenceAttributeSchema.parse(valid);
    expect(result.confidence).toBe(95);
  });

  it('accepts 0 confidence', () => {
    const result = confidenceAttributeSchema.parse({ ...valid, confidence: 0 });
    expect(result.confidence).toBe(0);
  });

  it('accepts 100 confidence', () => {
    const result = confidenceAttributeSchema.parse({ ...valid, confidence: 100 });
    expect(result.confidence).toBe(100);
  });

  it('rejects confidence > 100', () => {
    expect(() => confidenceAttributeSchema.parse({ ...valid, confidence: 101 })).toThrow();
  });

  it('accepts null rationale', () => {
    const result = confidenceAttributeSchema.parse({ ...valid, rationale: null });
    expect(result.rationale).toBeNull();
  });
});

// ─── subscriptionSchema ──────────────────────────────────────

describe('subscriptionSchema', () => {
  const valid = {
    id: UUID,
    org_id: UUID,
    stripe_customer_id: 'cus_abc123',
    stripe_subscription_id: null,
    plan: 'free' as const,
    status: 'active' as const,
    current_period_start: null,
    current_period_end: null,
    cancel_at_period_end: false,
    retention_offer_applied: false,
    dunning_stage: 0,
    last_payment_at: null,
    last_payment_failed_at: null,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  };

  it('accepts valid free subscription', () => {
    const result = subscriptionSchema.parse(valid);
    expect(result.plan).toBe('free');
  });

  it('accepts paid subscription', () => {
    const result = subscriptionSchema.parse({
      ...valid,
      plan: 'paid',
      stripe_subscription_id: 'sub_xyz',
      current_period_start: NOW,
      current_period_end: NOW,
    });
    expect(result.plan).toBe('paid');
  });

  it('accepts all valid statuses', () => {
    for (const status of [
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'trialing',
      'incomplete',
      'incomplete_expired',
      'paused',
    ]) {
      const result = subscriptionSchema.parse({ ...valid, status });
      expect(result.status).toBe(status);
    }
  });

  it('rejects dunning_stage > 60', () => {
    expect(() => subscriptionSchema.parse({ ...valid, dunning_stage: 61 })).toThrow();
  });

  it('rejects dunning_stage < 0', () => {
    expect(() => subscriptionSchema.parse({ ...valid, dunning_stage: -1 })).toThrow();
  });

  it('rejects invalid plan', () => {
    expect(() => subscriptionSchema.parse({ ...valid, plan: 'premium' })).toThrow();
  });
});

// ─── saleWebhookPayloadSchema ────────────────────────────────

describe('saleWebhookPayloadSchema', () => {
  const valid = {
    site_id: null,
    org_id: UUID,
    stripe_customer_id: 'cus_123',
    stripe_subscription_id: 'sub_456',
    plan: 'paid' as const,
    amount_cents: 5000,
    currency: 'usd',
    timestamp: NOW,
    request_id: 'req-abc',
    trace_id: 'trace-xyz',
  };

  it('accepts valid sale webhook payload', () => {
    const result = saleWebhookPayloadSchema.parse(valid);
    expect(result.amount_cents).toBe(5000);
  });

  it('accepts null site_id', () => {
    const result = saleWebhookPayloadSchema.parse(valid);
    expect(result.site_id).toBeNull();
  });

  it('accepts site_id as UUID', () => {
    const result = saleWebhookPayloadSchema.parse({ ...valid, site_id: UUID });
    expect(result.site_id).toBe(UUID);
  });

  it('rejects negative amount', () => {
    expect(() => saleWebhookPayloadSchema.parse({ ...valid, amount_cents: -100 })).toThrow();
  });

  it('rejects currency not 3 chars', () => {
    expect(() => saleWebhookPayloadSchema.parse({ ...valid, currency: 'us' })).toThrow();
    expect(() =>
      saleWebhookPayloadSchema.parse({ ...valid, currency: 'usdx' }),
    ).toThrow();
  });
});

// ─── auditLogSchema ──────────────────────────────────────────

describe('auditLogSchema', () => {
  it('accepts valid audit log entry', () => {
    const result = auditLogSchema.parse({
      id: UUID,
      org_id: UUID,
      actor_id: UUID,
      action: 'site.created',
      target_type: 'site',
      target_id: UUID,
      metadata_json: { key: 'value' },
      ip_address: '192.168.1.1',
      request_id: 'req-123',
      created_at: NOW,
    });
    expect(result.action).toBe('site.created');
  });

  it('accepts null actor_id for system actions', () => {
    const result = auditLogSchema.parse({
      id: UUID,
      org_id: UUID,
      actor_id: null,
      action: 'webhook.processed',
      target_type: null,
      target_id: null,
      metadata_json: null,
      ip_address: null,
      request_id: null,
      created_at: NOW,
    });
    expect(result.actor_id).toBeNull();
  });

  it('rejects empty action', () => {
    expect(() =>
      auditLogSchema.parse({
        id: UUID,
        org_id: UUID,
        actor_id: null,
        action: '',
        target_type: null,
        target_id: null,
        metadata_json: null,
        ip_address: null,
        request_id: null,
        created_at: NOW,
      }),
    ).toThrow();
  });

  it('rejects action over 100 chars', () => {
    expect(() =>
      auditLogSchema.parse({
        id: UUID,
        org_id: UUID,
        actor_id: null,
        action: 'a'.repeat(101),
        target_type: null,
        target_id: null,
        metadata_json: null,
        ip_address: null,
        request_id: null,
        created_at: NOW,
      }),
    ).toThrow();
  });
});

// ─── createAuditLogSchema ────────────────────────────────────

describe('createAuditLogSchema', () => {
  it('accepts minimal audit log creation', () => {
    const result = createAuditLogSchema.parse({
      org_id: UUID,
      actor_id: null,
      action: 'login',
    });
    expect(result.action).toBe('login');
  });

  it('accepts full audit log creation', () => {
    const result = createAuditLogSchema.parse({
      org_id: UUID,
      actor_id: UUID,
      action: 'billing.changed',
      target_type: 'subscription',
      target_id: UUID,
      metadata_json: { plan: 'paid' },
      ip_address: '10.0.0.1',
      request_id: 'req-abc',
    });
    expect(result.target_type).toBe('subscription');
  });

  it('rejects missing org_id', () => {
    expect(() => createAuditLogSchema.parse({ action: 'test', actor_id: null })).toThrow();
  });
});

// ─── webhookEventSchema ──────────────────────────────────────

describe('webhookEventSchema', () => {
  const valid = {
    id: UUID,
    org_id: null,
    provider: 'stripe' as const,
    event_id: 'evt_123',
    event_type: 'checkout.session.completed',
    payload_pointer: null,
    payload_hash: null,
    status: 'received' as const,
    error_message: null,
    attempts: 0,
    processed_at: null,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  };

  it('accepts valid webhook event', () => {
    const result = webhookEventSchema.parse(valid);
    expect(result.provider).toBe('stripe');
  });

  it('accepts all valid statuses', () => {
    for (const status of ['received', 'processing', 'processed', 'failed', 'quarantined']) {
      const result = webhookEventSchema.parse({ ...valid, status });
      expect(result.status).toBe(status);
    }
  });

  it('accepts all valid providers', () => {
    for (const provider of ['stripe', 'dub', 'chatwoot', 'novu', 'lago']) {
      const result = webhookEventSchema.parse({ ...valid, provider });
      expect(result.provider).toBe(provider);
    }
  });

  it('rejects event_id over 500 chars', () => {
    expect(() =>
      webhookEventSchema.parse({ ...valid, event_id: 'x'.repeat(501) }),
    ).toThrow();
  });

  it('accepts error message up to 2000 chars', () => {
    const result = webhookEventSchema.parse({
      ...valid,
      status: 'failed',
      error_message: 'e'.repeat(2000),
    });
    expect(result.error_message?.length).toBe(2000);
  });
});

// ─── workflowJobSchema ───────────────────────────────────────

describe('workflowJobSchema', () => {
  const valid = {
    id: UUID,
    org_id: UUID,
    job_name: 'generate_site',
    site_id: UUID,
    dedupe_key: 'site:abc:generate',
    payload_pointer: 'r2://payloads/abc.json',
    status: 'queued' as const,
    attempt: 0,
    max_attempts: 3,
    started_at: null,
    completed_at: null,
    error_message: null,
    result_pointer: null,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  };

  it('accepts valid queued job', () => {
    const result = workflowJobSchema.parse(valid);
    expect(result.status).toBe('queued');
  });

  it('accepts all valid statuses', () => {
    for (const status of ['queued', 'running', 'success', 'failed']) {
      const result = workflowJobSchema.parse({ ...valid, status });
      expect(result.status).toBe(status);
    }
  });

  it('rejects max_attempts > 10', () => {
    expect(() => workflowJobSchema.parse({ ...valid, max_attempts: 11 })).toThrow();
  });

  it('rejects max_attempts < 1', () => {
    expect(() => workflowJobSchema.parse({ ...valid, max_attempts: 0 })).toThrow();
  });

  it('rejects attempt < 0', () => {
    expect(() => workflowJobSchema.parse({ ...valid, attempt: -1 })).toThrow();
  });
});

// ─── jobEnvelopeSchema ───────────────────────────────────────

describe('jobEnvelopeSchema', () => {
  it('accepts valid job envelope', () => {
    const result = jobEnvelopeSchema.parse({
      job_id: UUID,
      job_name: 'generate_site',
      org_id: UUID,
      dedupe_key: null,
      payload_pointer: null,
      attempt: 0,
      max_attempts: 3,
    });
    expect(result.job_name).toBe('generate_site');
  });

  it('rejects missing required fields', () => {
    expect(() => jobEnvelopeSchema.parse({ job_id: UUID })).toThrow();
  });

  it('accepts dedupe_key', () => {
    const result = jobEnvelopeSchema.parse({
      job_id: UUID,
      job_name: 'test',
      org_id: UUID,
      dedupe_key: 'site:abc:v1',
      payload_pointer: null,
      attempt: 1,
      max_attempts: 5,
    });
    expect(result.dedupe_key).toBe('site:abc:v1');
  });
});

// ─── hostnameRecordSchema ────────────────────────────────────

describe('hostnameRecordSchema', () => {
  const valid = {
    id: UUID,
    org_id: UUID,
    site_id: UUID,
    hostname: 'test.sites.megabyte.space',
    type: 'free_subdomain' as const,
    status: 'active' as const,
    cf_custom_hostname_id: 'cf-id-123',
    ssl_status: 'active' as const,
    verification_errors: null,
    last_verified_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  };

  it('accepts valid hostname record', () => {
    const result = hostnameRecordSchema.parse(valid);
    expect(result.status).toBe('active');
  });

  it('accepts all valid hostname statuses', () => {
    for (const status of [
      'pending',
      'active',
      'moved',
      'deleted',
      'pending_deletion',
      'verification_failed',
    ]) {
      const result = hostnameRecordSchema.parse({ ...valid, status });
      expect(result.status).toBe(status);
    }
  });

  it('accepts all valid SSL statuses', () => {
    for (const ssl_status of ['pending', 'active', 'error', 'unknown']) {
      const result = hostnameRecordSchema.parse({ ...valid, ssl_status });
      expect(result.ssl_status).toBe(ssl_status);
    }
  });

  it('accepts verification_errors array', () => {
    const result = hostnameRecordSchema.parse({
      ...valid,
      status: 'verification_failed',
      verification_errors: ['DNS not resolving', 'SSL timeout'],
    });
    expect(result.verification_errors).toHaveLength(2);
  });

  it('rejects more than 10 verification errors', () => {
    expect(() =>
      hostnameRecordSchema.parse({
        ...valid,
        verification_errors: Array.from({ length: 11 }, (_, i) => `error ${i}`),
      }),
    ).toThrow();
  });
});

// ─── hostnameStatusSchema ────────────────────────────────────

describe('hostnameStatusSchema', () => {
  it('accepts valid status check response', () => {
    const result = hostnameStatusSchema.parse({
      hostname: 'test.example.com',
      status: 'active',
      ssl_status: 'active',
      verification_errors: null,
    });
    expect(result.hostname).toBe('test.example.com');
  });

  it('accepts pending with errors', () => {
    const result = hostnameStatusSchema.parse({
      hostname: 'test.example.com',
      status: 'verification_failed',
      ssl_status: 'error',
      verification_errors: ['CNAME not set'],
    });
    expect(result.verification_errors).toHaveLength(1);
  });
});

// ─── analyticsDailySchema ────────────────────────────────────

describe('analyticsDailySchema', () => {
  const valid = {
    id: UUID,
    org_id: UUID,
    site_id: UUID,
    date: '2024-01-15',
    page_views: 100,
    unique_visitors: 50,
    bandwidth_bytes: 1024000,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  };

  it('accepts valid daily analytics', () => {
    const result = analyticsDailySchema.parse(valid);
    expect(result.page_views).toBe(100);
  });

  it('rejects invalid date format', () => {
    expect(() => analyticsDailySchema.parse({ ...valid, date: '2024-1-15' })).toThrow();
    expect(() => analyticsDailySchema.parse({ ...valid, date: 'Jan 15' })).toThrow();
  });

  it('defaults counters to 0', () => {
    const result = analyticsDailySchema.parse({
      ...valid,
      page_views: 0,
      unique_visitors: 0,
      bandwidth_bytes: 0,
    });
    expect(result.page_views).toBe(0);
  });

  it('rejects negative counters', () => {
    expect(() => analyticsDailySchema.parse({ ...valid, page_views: -1 })).toThrow();
  });
});

// ─── funnelEventSchema ───────────────────────────────────────

describe('funnelEventSchema', () => {
  it('accepts all valid event names', () => {
    const events = [
      'signup_started',
      'signup_completed',
      'site_created',
      'first_publish',
      'first_payment',
      'invite_sent',
      'invite_accepted',
      'churned',
    ];
    for (const event_name of events) {
      const result = funnelEventSchema.parse({
        id: UUID,
        org_id: UUID,
        user_id: null,
        site_id: null,
        event_name,
        metadata_json: null,
        created_at: NOW,
      });
      expect(result.event_name).toBe(event_name);
    }
  });

  it('rejects invalid event name', () => {
    expect(() =>
      funnelEventSchema.parse({
        id: UUID,
        org_id: UUID,
        user_id: null,
        site_id: null,
        event_name: 'unknown_event',
        metadata_json: null,
        created_at: NOW,
      }),
    ).toThrow();
  });

  it('accepts metadata', () => {
    const result = funnelEventSchema.parse({
      id: UUID,
      org_id: UUID,
      user_id: UUID,
      site_id: UUID,
      event_name: 'first_publish',
      metadata_json: { version: '1.0', slug: 'test' },
      created_at: NOW,
    });
    expect(result.metadata_json).toEqual({ version: '1.0', slug: 'test' });
  });
});

// ─── usageEventSchema ────────────────────────────────────────

describe('usageEventSchema', () => {
  it('accepts valid usage event', () => {
    const result = usageEventSchema.parse({
      id: UUID,
      org_id: UUID,
      event_type: 'llm_call',
      quantity: 1,
      metadata_json: { model: 'gpt-4', tokens: 500 },
      created_at: NOW,
    });
    expect(result.event_type).toBe('llm_call');
  });

  it('rejects negative quantity', () => {
    expect(() =>
      usageEventSchema.parse({
        id: UUID,
        org_id: UUID,
        event_type: 'test',
        quantity: -1,
        metadata_json: null,
        created_at: NOW,
      }),
    ).toThrow();
  });

  it('rejects event_type over 100 chars', () => {
    expect(() =>
      usageEventSchema.parse({
        id: UUID,
        org_id: UUID,
        event_type: 'x'.repeat(101),
        quantity: 1,
        metadata_json: null,
        created_at: NOW,
      }),
    ).toThrow();
  });
});

// ─── apiErrorSchema ──────────────────────────────────────────

describe('apiErrorSchema', () => {
  it('accepts valid API error', () => {
    const result = apiErrorSchema.parse({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid input',
      },
    });
    expect(result.error.code).toBe('BAD_REQUEST');
  });

  it('accepts all valid error codes', () => {
    const codes = [
      'BAD_REQUEST',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'PAYLOAD_TOO_LARGE',
      'RATE_LIMITED',
      'VALIDATION_ERROR',
      'INTERNAL_ERROR',
      'SERVICE_UNAVAILABLE',
      'WEBHOOK_SIGNATURE_INVALID',
      'WEBHOOK_DUPLICATE',
      'IDEMPOTENCY_CONFLICT',
      'STRIPE_ERROR',
      'DOMAIN_PROVISIONING_ERROR',
      'AI_GENERATION_ERROR',
      'LIGHTHOUSE_FAILURE',
    ];
    for (const code of codes) {
      const result = apiErrorSchema.parse({ error: { code, message: 'test' } });
      expect(result.error.code).toBe(code);
    }
  });

  it('rejects invalid error code', () => {
    expect(() =>
      apiErrorSchema.parse({ error: { code: 'UNKNOWN', message: 'test' } }),
    ).toThrow();
  });

  it('rejects message over 2000 chars', () => {
    expect(() =>
      apiErrorSchema.parse({ error: { code: 'BAD_REQUEST', message: 'x'.repeat(2001) } }),
    ).toThrow();
  });
});

// ─── userSchema ──────────────────────────────────────────────

describe('userSchema', () => {
  it('accepts valid user', () => {
    const result = userSchema.parse({
      id: UUID,
      email: 'test@example.com',
      phone: '+14155551234',
      display_name: 'John Doe',
      avatar_url: 'https://example.com/avatar.jpg',
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
    });
    expect(result.email).toBe('test@example.com');
  });

  it('accepts user with all nullable fields null', () => {
    const result = userSchema.parse({
      id: UUID,
      email: null,
      phone: null,
      display_name: null,
      avatar_url: null,
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
    });
    expect(result.email).toBeNull();
  });

  it('rejects invalid email', () => {
    expect(() =>
      userSchema.parse({
        id: UUID,
        email: 'not-email',
        phone: null,
        display_name: null,
        avatar_url: null,
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
      }),
    ).toThrow();
  });

  it('rejects invalid phone format', () => {
    expect(() =>
      userSchema.parse({
        id: UUID,
        email: null,
        phone: '555-1234',
        display_name: null,
        avatar_url: null,
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
      }),
    ).toThrow();
  });
});

// ─── sessionSchema ───────────────────────────────────────────

describe('sessionSchema', () => {
  it('accepts valid session', () => {
    const result = sessionSchema.parse({
      id: UUID,
      user_id: UUID,
      token_hash: 'abcdef1234567890abcdef1234567890',
      device_info: 'Chrome on macOS',
      ip_address: '192.168.1.1',
      expires_at: NOW,
      last_active_at: NOW,
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
    });
    expect(result.user_id).toBe(UUID);
  });

  it('accepts IPv6 addresses', () => {
    const result = sessionSchema.parse({
      id: UUID,
      user_id: UUID,
      token_hash: 'hash123',
      device_info: null,
      ip_address: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      expires_at: NOW,
      last_active_at: NOW,
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
    });
    expect(result.ip_address).toBeTruthy();
  });

  it('rejects token_hash over 128 chars', () => {
    expect(() =>
      sessionSchema.parse({
        id: UUID,
        user_id: UUID,
        token_hash: 'x'.repeat(129),
        device_info: null,
        ip_address: null,
        expires_at: NOW,
        last_active_at: NOW,
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
      }),
    ).toThrow();
  });
});

// ─── verifyMagicLinkSchema ───────────────────────────────────

describe('verifyMagicLinkSchema', () => {
  it('accepts valid token', () => {
    const result = verifyMagicLinkSchema.parse({ token: 'a'.repeat(64) });
    expect(result.token).toHaveLength(64);
  });

  it('rejects token shorter than 32 chars', () => {
    expect(() => verifyMagicLinkSchema.parse({ token: 'short' })).toThrow();
  });

  it('rejects token longer than 512 chars', () => {
    expect(() => verifyMagicLinkSchema.parse({ token: 'a'.repeat(513) })).toThrow();
  });

  it('rejects empty token', () => {
    expect(() => verifyMagicLinkSchema.parse({ token: '' })).toThrow();
  });

  it('rejects missing token', () => {
    expect(() => verifyMagicLinkSchema.parse({})).toThrow();
  });
});

// ─── createPhoneOtpSchema ────────────────────────────────────

describe('createPhoneOtpSchema', () => {
  it('accepts valid phone with optional turnstile', () => {
    const result = createPhoneOtpSchema.parse({
      phone: '+14155551234',
      turnstile_token: 'cf-turnstile-token-xyz',
    });
    expect(result.phone).toBe('+14155551234');
  });

  it('accepts phone without turnstile', () => {
    const result = createPhoneOtpSchema.parse({ phone: '+14155551234' });
    expect(result.phone).toBe('+14155551234');
  });

  it('rejects invalid phone', () => {
    expect(() => createPhoneOtpSchema.parse({ phone: '555-1234' })).toThrow();
  });

  it('rejects turnstile token over 2048 chars', () => {
    expect(() =>
      createPhoneOtpSchema.parse({
        phone: '+14155551234',
        turnstile_token: 'x'.repeat(2049),
      }),
    ).toThrow();
  });
});

// ─── createGoogleOAuthSchema ─────────────────────────────────

describe('createGoogleOAuthSchema', () => {
  it('accepts with redirect_url', () => {
    const result = createGoogleOAuthSchema.parse({
      redirect_url: 'https://example.com/callback',
    });
    expect(result.redirect_url).toBe('https://example.com/callback');
  });

  it('accepts without redirect_url', () => {
    const result = createGoogleOAuthSchema.parse({});
    expect(result.redirect_url).toBeUndefined();
  });

  it('rejects invalid redirect_url', () => {
    expect(() =>
      createGoogleOAuthSchema.parse({ redirect_url: 'not-a-url' }),
    ).toThrow();
  });
});

// ─── loginResponseSchema ─────────────────────────────────────

describe('loginResponseSchema', () => {
  it('accepts valid login response', () => {
    const result = loginResponseSchema.parse({
      user: {
        id: UUID,
        email: 'test@example.com',
        phone: null,
        display_name: null,
        avatar_url: null,
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
      },
      session: {
        token: 'session-token-abc',
        expires_at: NOW,
      },
      requires_2fa: true,
    });
    expect(result.requires_2fa).toBe(true);
  });

  it('rejects missing session token', () => {
    expect(() =>
      loginResponseSchema.parse({
        user: {
          id: UUID,
          email: null,
          phone: null,
          display_name: null,
          avatar_url: null,
          created_at: NOW,
          updated_at: NOW,
          deleted_at: null,
        },
        session: { expires_at: NOW },
        requires_2fa: false,
      }),
    ).toThrow();
  });
});

// ─── researchDataSchema ──────────────────────────────────────

describe('researchDataSchema', () => {
  const valid = {
    id: UUID,
    org_id: UUID,
    site_id: UUID,
    task_name: 'nap_verification',
    raw_output: 'Business Name: Test Co',
    parsed_output: { name: 'Test Co', verified: true },
    confidence: 85,
    source_urls: ['https://example.com'],
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  };

  it('accepts valid research data', () => {
    const result = researchDataSchema.parse(valid);
    expect(result.task_name).toBe('nap_verification');
  });

  it('rejects raw_output over 65536 chars', () => {
    expect(() =>
      researchDataSchema.parse({ ...valid, raw_output: 'x'.repeat(65537) }),
    ).toThrow();
  });

  it('rejects more than 20 source URLs', () => {
    expect(() =>
      researchDataSchema.parse({
        ...valid,
        source_urls: Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`),
      }),
    ).toThrow();
  });

  it('accepts null parsed_output', () => {
    const result = researchDataSchema.parse({ ...valid, parsed_output: null });
    expect(result.parsed_output).toBeNull();
  });
});
