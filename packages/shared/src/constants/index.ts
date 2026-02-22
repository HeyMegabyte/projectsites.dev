/** Caps and rate limits */
export const DEFAULT_CAPS = {
  LLM_DAILY_SPEND_CENTS: 2000, // $20/day
  SITES_PER_DAY: 20,
  EMAILS_PER_DAY: 25,
  MAX_CUSTOM_DOMAINS: 5,
  MAX_REQUEST_BODY_BYTES: 256 * 1024, // 256KB
  MAX_AI_MICROTASK_OUTPUT_BYTES: 64 * 1024, // 64KB
  MAX_QUEUED_RETRIES: 5,
  MAX_COMPUTE_TIME_MS: 300_000, // 5 minutes per job
  MAX_STORAGE_FREE_MB: 100,
  MAX_STORAGE_PAID_MB: 500,
} as const;

/** Pricing */
export const PRICING = {
  MONTHLY_CENTS: 5000, // $50/mo
  RETENTION_OFFER_CENTS: 2500, // $25/mo for 12 months
  RETENTION_OFFER_MONTHS: 12,
  CURRENCY: 'usd' as const,
} as const;

/** Dunning schedule: days after invoice due date */
export const DUNNING = {
  REMINDER_DAYS: [0, 7, 14, 30] as const,
  DOWNGRADE_DAY: 60,
} as const;

/** Auth constants */
export const AUTH = {
  MAGIC_LINK_EXPIRY_HOURS: 24,
  OTP_EXPIRY_MINUTES: 5,
  OTP_MAX_ATTEMPTS: 3,
  SESSION_EXPIRY_DAYS: 30,
  SESSION_REFRESH_DAYS: 7,
  OTP_LENGTH: 6,
  TURNSTILE_TIMEOUT_MS: 300_000,
} as const;

/** Entitlements by plan */
export const ENTITLEMENTS = {
  free: {
    topBarHidden: false,
    maxCustomDomains: 0,
    chatEnabled: true,
    analyticsEnabled: false,
  },
  paid: {
    topBarHidden: true,
    maxCustomDomains: 10,
    chatEnabled: true,
    analyticsEnabled: true,
  },
} as const;

/** Roles */
export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Subscription states */
export const SUBSCRIPTION_STATES = [
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'trialing',
  'incomplete',
  'incomplete_expired',
  'paused',
] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** Job states */
export const JOB_STATES = ['queued', 'running', 'success', 'failed'] as const;
export type JobState = (typeof JOB_STATES)[number];

/** Hostname provisioning states */
export const HOSTNAME_STATES = [
  'pending',
  'active',
  'moved',
  'deleted',
  'pending_deletion',
  'verification_failed',
] as const;
export type HostnameState = (typeof HOSTNAME_STATES)[number];

/** Funnel events */
export const FUNNEL_EVENTS = [
  'signup_started',
  'signup_completed',
  'site_created',
  'first_publish',
  'first_payment',
  'invite_sent',
  'invite_accepted',
  'churned',
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/** Webhook providers */
export const WEBHOOK_PROVIDERS = ['stripe', 'dub', 'chatwoot', 'novu', 'lago'] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

/** HTTP status codes used in typed errors */
export const ERROR_CODES = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

/** Brand copy */
export const BRAND = {
  TAGLINE: 'Your website\u2014handled. Finally.',
  HEADLINE: 'Your business website\u2014live in under 15 minutes.',
  PRIMARY_CTA: 'Launch My Site Now',
  SECONDARY_CTA: 'See a Demo',
  MICROCOPY: 'Domain included \u2022 Updates included \u2022 Cancel anytime',
  CONTACT_EMAIL: 'hey@megabyte.space',
  REPLY_TO_EMAIL: 'brian@megabyte.space',
} as const;

/** Domain configuration */
export const DOMAINS = {
  /** Base domain for the marketing homepage (sites.megabyte.space) */
  SITES_BASE: 'sites.megabyte.space',
  /** Base domain for staging (sites-staging.megabyte.space) */
  SITES_STAGING: 'sites-staging.megabyte.space',
  /** Suffix for customer site subdomains: {slug}-sites.megabyte.space */
  SITES_SUFFIX: '-sites.megabyte.space',
  /** Suffix for staging customer sites: {slug}-sites-staging.megabyte.space */
  SITES_STAGING_SUFFIX: '-sites-staging.megabyte.space',
  BOLT_BASE: 'bolt.megabyte.space',
  BOLT_STAGING: 'bolt-staging.megabyte.space',
  CLAIM_BASE: 'claimyour.site',
} as const;
