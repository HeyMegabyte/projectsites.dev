/**
 * Project Sites - Shared Constants
 * Centralized configuration values for caps, pricing, auth, and entitlements
 */

// =============================================================================
// BUDGET & RATE LIMITS
// =============================================================================

export const DEFAULT_CAPS = {
  /** Daily LLM spend limit in cents ($20/day) */
  LLM_DAILY_SPEND_CENTS: 2000,
  /** Maximum sites that can be created per day */
  SITES_PER_DAY: 20,
  /** Maximum emails that can be sent per day */
  EMAILS_PER_DAY: 25,
  /** Maximum custom domains per paid site */
  MAX_CUSTOM_DOMAINS: 5,
  /** Maximum request payload size in bytes (256KB) */
  MAX_REQUEST_SIZE_BYTES: 256 * 1024,
  /** Maximum AI microtask output size in bytes (64KB) */
  MAX_AI_OUTPUT_SIZE_BYTES: 64 * 1024,
  /** Maximum retries for background jobs */
  MAX_JOB_RETRIES: 3,
  /** Maximum retries for webhooks */
  MAX_WEBHOOK_RETRIES: 5,
} as const;

// =============================================================================
// PRICING
// =============================================================================

export const PRICING = {
  /** Monthly subscription price in cents ($50/mo) */
  MONTHLY_CENTS: 5000,
  /** Retention offer price in cents ($25/mo for 12 months) */
  RETENTION_OFFER_CENTS: 2500,
  /** Retention offer duration in months */
  RETENTION_OFFER_MONTHS: 12,
  /** Currency code */
  CURRENCY: 'usd',
} as const;

// =============================================================================
// DUNNING (Payment Failure Handling)
// =============================================================================

export const DUNNING = {
  /** Days after due date for reminder emails */
  REMINDER_DAYS: [0, 7, 14, 30] as const,
  /** Days after which subscription is downgraded (top bar returns) */
  DOWNGRADE_AFTER_DAYS: 60,
} as const;

// =============================================================================
// AUTHENTICATION
// =============================================================================

export const AUTH = {
  /** Magic link expiry in hours */
  MAGIC_LINK_EXPIRY_HOURS: 24,
  /** OTP expiry in minutes */
  OTP_EXPIRY_MINUTES: 5,
  /** Maximum OTP verification attempts */
  OTP_MAX_ATTEMPTS: 3,
  /** Session expiry in days */
  SESSION_EXPIRY_DAYS: 30,
  /** Session refresh threshold in days (refresh if less than this remaining) */
  SESSION_REFRESH_THRESHOLD_DAYS: 7,
  /** Rate limit: auth attempts per IP per minute */
  RATE_LIMIT_AUTH_PER_MINUTE: 10,
  /** Rate limit: magic link requests per email per hour */
  RATE_LIMIT_MAGIC_LINK_PER_HOUR: 5,
} as const;

// =============================================================================
// ENTITLEMENTS
// =============================================================================

export const ENTITLEMENTS = {
  FREE: {
    topBarHidden: false,
    maxCustomDomains: 0,
    canAccessBilling: false,
    canInviteMembers: false,
  },
  PAID: {
    topBarHidden: true,
    maxCustomDomains: 5,
    canAccessBilling: true,
    canInviteMembers: true,
  },
} as const;

// =============================================================================
// CONFIDENCE THRESHOLDS
// =============================================================================

export const CONFIDENCE = {
  /** Minimum confidence for business name to create site */
  BUSINESS_NAME_MIN: 90,
  /** Minimum confidence for email to create site */
  EMAIL_MIN: 90,
  /** Minimum confidence for phone to send first email */
  PHONE_MIN_FOR_EMAIL: 80,
  /** Minimum confidence for address to send first email */
  ADDRESS_MIN_FOR_EMAIL: 80,
  /** Minimum confidence for address to be postcard-eligible */
  ADDRESS_MIN_FOR_POSTCARD: 90,
  /** Minimum confidence for logo to use found logo */
  LOGO_MIN: 90,
  /** Minimum confidence for social poster to use found poster */
  POSTER_MIN: 90,
} as const;

// =============================================================================
// LIGHTHOUSE
// =============================================================================

export const LIGHTHOUSE = {
  /** Minimum required mobile Lighthouse score */
  MIN_SCORE: 90,
  /** Maximum iterations for Lighthouse improvement loop */
  MAX_ITERATIONS: 5,
  /** Timeout for Lighthouse run in milliseconds */
  TIMEOUT_MS: 60000,
} as const;

// =============================================================================
// DOMAINS
// =============================================================================

export const DOMAINS = {
  /** Base domain for free sites */
  FREE_SITE_BASE: 'sites.megabyte.space',
  /** Staging base domain */
  STAGING_BASE: 'sites-staging.megabyte.space',
  /** Claim link domain */
  CLAIM_DOMAIN: 'claimyour.site',
  /** Bolt editor domain */
  BOLT_DOMAIN: 'bolt.megabyte.space',
  /** DNS verification timeout in hours */
  DNS_VERIFICATION_TIMEOUT_HOURS: 72,
} as const;

// =============================================================================
// PERFORMANCE BUDGETS
// =============================================================================

export const PERFORMANCE = {
  /** P95 target for public site HTML response in ms */
  P95_HTML_RESPONSE_MS: 300,
  /** P95 target for API latency in ms */
  P95_API_LATENCY_MS: 500,
  /** Default API route timeout in ms */
  DEFAULT_ROUTE_TIMEOUT_MS: 30000,
  /** Cache TTL for hostname lookups in seconds */
  HOSTNAME_CACHE_TTL_SECONDS: 60,
} as const;

// =============================================================================
// JOB STATES
// =============================================================================

export const JOB_STATES = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const;

export type JobState = (typeof JOB_STATES)[keyof typeof JOB_STATES];

// =============================================================================
// RBAC ROLES
// =============================================================================

export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_HIERARCHY: Record<Role, number> = {
  [ROLES.OWNER]: 100,
  [ROLES.ADMIN]: 80,
  [ROLES.MEMBER]: 50,
  [ROLES.VIEWER]: 10,
} as const;

// =============================================================================
// WEBHOOK PROVIDERS
// =============================================================================

export const WEBHOOK_PROVIDERS = {
  STRIPE: 'stripe',
  DUB: 'dub',
  CHATWOOT: 'chatwoot',
  NOVU: 'novu',
  LAGO: 'lago',
} as const;

export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[keyof typeof WEBHOOK_PROVIDERS];

// =============================================================================
// AUDIT LOG ACTIONS
// =============================================================================

export const AUDIT_ACTIONS = {
  // Auth
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_MAGIC_LINK_SENT: 'auth.magic_link_sent',
  AUTH_OTP_SENT: 'auth.otp_sent',
  AUTH_OTP_VERIFIED: 'auth.otp_verified',
  AUTH_SESSION_REVOKED: 'auth.session_revoked',

  // Org
  ORG_CREATED: 'org.created',
  ORG_UPDATED: 'org.updated',
  ORG_DELETED: 'org.deleted',

  // Membership
  MEMBERSHIP_INVITED: 'membership.invited',
  MEMBERSHIP_ACCEPTED: 'membership.accepted',
  MEMBERSHIP_ROLE_CHANGED: 'membership.role_changed',
  MEMBERSHIP_REMOVED: 'membership.removed',

  // Site
  SITE_CREATED: 'site.created',
  SITE_UPDATED: 'site.updated',
  SITE_PUBLISHED: 'site.published',
  SITE_DELETED: 'site.deleted',

  // Billing
  BILLING_SUBSCRIPTION_CREATED: 'billing.subscription_created',
  BILLING_SUBSCRIPTION_UPDATED: 'billing.subscription_updated',
  BILLING_SUBSCRIPTION_CANCELLED: 'billing.subscription_cancelled',
  BILLING_PAYMENT_SUCCEEDED: 'billing.payment_succeeded',
  BILLING_PAYMENT_FAILED: 'billing.payment_failed',

  // Domains
  DOMAIN_ADDED: 'domain.added',
  DOMAIN_VERIFIED: 'domain.verified',
  DOMAIN_REMOVED: 'domain.removed',

  // Webhooks
  WEBHOOK_RECEIVED: 'webhook.received',
  WEBHOOK_PROCESSED: 'webhook.processed',
  WEBHOOK_FAILED: 'webhook.failed',

  // Admin
  ADMIN_FEATURE_FLAG_TOGGLED: 'admin.feature_flag_toggled',
  ADMIN_SETTING_CHANGED: 'admin.setting_changed',
  ADMIN_IMPERSONATION_STARTED: 'admin.impersonation_started',
  ADMIN_IMPERSONATION_ENDED: 'admin.impersonation_ended',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

// =============================================================================
// FUNNEL EVENTS (Analytics)
// =============================================================================

export const FUNNEL_EVENTS = {
  SIGNUP_STARTED: 'signup_started',
  SIGNUP_COMPLETED: 'signup_completed',
  SITE_CREATED: 'site_created',
  FIRST_PUBLISH: 'first_publish',
  FIRST_PAYMENT: 'first_payment',
  INVITE_SENT: 'invite_sent',
  INVITE_ACCEPTED: 'invite_accepted',
  CHURNED: 'churned',
} as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS];

// =============================================================================
// BRAND & COPY
// =============================================================================

export const BRAND = {
  NAME: 'Project Sites',
  TAGLINE: 'Your website—handled. Finally.',
  HEADLINE: 'Your business website—live in under 15 minutes.',
  PRIMARY_CTA: 'Launch My Site Now',
  SECONDARY_CTA: 'See a Demo',
  MICROCOPY: 'Domain included \u2022 Updates included \u2022 Cancel anytime',
  CONTACT_EMAIL: 'hey@megabyte.space',
  REPLY_TO_EMAIL: 'brian@megabyte.space',
} as const;
