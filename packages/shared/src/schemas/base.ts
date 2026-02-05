/**
 * Base Zod schemas for common patterns
 */
import { z } from 'zod';

// =============================================================================
// PRIMITIVE SCHEMAS
// =============================================================================

/** UUID v4 schema */
export const uuidSchema = z.string().uuid();

/** Email schema with reasonable length limits */
export const emailSchema = z
  .string()
  .email('Invalid email format')
  .min(5, 'Email too short')
  .max(254, 'Email too long')
  .toLowerCase()
  .trim();

/** Phone schema (E.164 format) */
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, 'Phone must be in E.164 format (e.g., +14155551234)')
  .min(8, 'Phone number too short')
  .max(16, 'Phone number too long');

/** URL schema (HTTPS only) */
export const httpsUrlSchema = z
  .string()
  .url('Invalid URL format')
  .refine((url) => url.startsWith('https://'), 'URL must use HTTPS')
  .max(2048, 'URL too long');

/** Slug schema (URL-safe identifier) */
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Slug must be lowercase alphanumeric with hyphens')
  .min(1, 'Slug required')
  .max(63, 'Slug too long');

/** Hostname schema */
export const hostnameSchema = z
  .string()
  .regex(
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
    'Invalid hostname format',
  )
  .max(253, 'Hostname too long')
  .toLowerCase();

// =============================================================================
// TIMESTAMP SCHEMAS
// =============================================================================

/** ISO 8601 date-time string */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** Timestamp fields for database records */
export const timestampsSchema = z.object({
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  deleted_at: isoDateTimeSchema.nullable(),
});

// =============================================================================
// PAGINATION SCHEMAS
// =============================================================================

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});

// =============================================================================
// ERROR SCHEMAS
// =============================================================================

export const errorCodeSchema = z.enum([
  // Auth errors
  'AUTH_REQUIRED',
  'AUTH_INVALID_TOKEN',
  'AUTH_EXPIRED_TOKEN',
  'AUTH_INVALID_OTP',
  'AUTH_OTP_EXPIRED',
  'AUTH_MAX_ATTEMPTS',
  'AUTH_SESSION_EXPIRED',

  // Permission errors
  'FORBIDDEN',
  'INSUFFICIENT_PERMISSIONS',
  'ORG_ACCESS_DENIED',
  'SITE_ACCESS_DENIED',

  // Validation errors
  'VALIDATION_ERROR',
  'INVALID_REQUEST',
  'PAYLOAD_TOO_LARGE',

  // Resource errors
  'NOT_FOUND',
  'ORG_NOT_FOUND',
  'SITE_NOT_FOUND',
  'USER_NOT_FOUND',
  'HOSTNAME_NOT_FOUND',

  // Rate limiting
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',

  // Billing errors
  'BILLING_REQUIRED',
  'SUBSCRIPTION_INACTIVE',
  'PAYMENT_FAILED',
  'ENTITLEMENT_EXCEEDED',

  // Domain errors
  'DOMAIN_ALREADY_EXISTS',
  'DOMAIN_VERIFICATION_PENDING',
  'DOMAIN_VERIFICATION_FAILED',
  'DOMAIN_LIMIT_EXCEEDED',

  // Webhook errors
  'WEBHOOK_SIGNATURE_INVALID',
  'WEBHOOK_TIMESTAMP_INVALID',
  'WEBHOOK_DUPLICATE',

  // Server errors
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'EXTERNAL_SERVICE_ERROR',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().max(500),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
    trace_id: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

// =============================================================================
// API RESPONSE SCHEMAS
// =============================================================================

export const apiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    meta: z
      .object({
        request_id: z.string(),
        timestamp: isoDateTimeSchema,
      })
      .optional(),
  });

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    meta: z.object({
      pagination: paginationMetaSchema,
      request_id: z.string(),
      timestamp: isoDateTimeSchema,
    }),
  });

// =============================================================================
// SAFE STRING SCHEMAS (for user input)
// =============================================================================

/** Safe text input - no HTML, no script injection patterns */
export const safeTextSchema = z
  .string()
  .max(1000, 'Text too long')
  .transform((val) => val.trim())
  .refine(
    (val) => !/<script|javascript:|data:|on\w+=/i.test(val),
    'Input contains potentially unsafe content',
  );

/** Safe short text (names, titles) */
export const safeShortTextSchema = z
  .string()
  .max(200, 'Text too long')
  .transform((val) => val.trim())
  .refine(
    (val) => !/<script|javascript:|data:|on\w+=/i.test(val),
    'Input contains potentially unsafe content',
  );

/** Safe long text (descriptions, content) */
export const safeLongTextSchema = z
  .string()
  .max(10000, 'Text too long')
  .transform((val) => val.trim())
  .refine(
    (val) => !/<script|javascript:|data:|on\w+=/i.test(val),
    'Input contains potentially unsafe content',
  );

// =============================================================================
// REQUEST CONTEXT SCHEMA
// =============================================================================

export const requestContextSchema = z.object({
  request_id: z.string(),
  trace_id: z.string().optional(),
  timestamp: isoDateTimeSchema,
  ip: z.string().optional(),
  user_agent: z.string().optional(),
  country: z.string().length(2).optional(),
});

export type RequestContext = z.infer<typeof requestContextSchema>;
