/**
 * @module base
 * @packageDocumentation
 *
 * Foundational Zod schemas and reusable field definitions shared across the
 * entire Project Sites data model. Every database-backed entity extends
 * {@link baseFields}, and the primitive validators defined here (UUID, slug,
 * email, hostname, etc.) are imported by every other schema module.
 *
 * ## Schemas and Types
 *
 * | Export                    | Kind              | Description                                        |
 * | ------------------------ | ----------------- | -------------------------------------------------- |
 * | `baseFields`             | field map         | `id`, `org_id`, `created_at`, `updated_at`, `deleted_at` columns |
 * | `uuidSchema`             | `ZodString`       | UUID v4 string                                     |
 * | `slugSchema`             | `ZodString`       | Lowercase alphanumeric slug (3-63 chars)           |
 * | `emailSchema`            | `ZodString`       | RFC-compliant email, max 254 chars, lowercased     |
 * | `phoneSchema`            | `ZodString`       | E.164 international phone number                   |
 * | `hostnameSchema`         | `ZodString`       | Valid DNS hostname (3-253 chars)                    |
 * | `httpsUrlSchema`         | `ZodString`       | HTTPS-only URL, max 2048 chars                     |
 * | `safeStringSchema`       | `ZodString`       | XSS-safe string (no script/data/javascript URIs)   |
 * | `nameSchema`             | `ZodString`       | Short safe string for names/titles (1-200 chars)   |
 * | `paginationSchema`       | `ZodObject`       | `{ limit, offset }` with coercion and defaults     |
 * | `errorEnvelopeSchema`    | `ZodObject`       | Standard API error response envelope               |
 * | `successEnvelopeSchema`  | generic factory   | Standard API success response with optional meta   |
 * | `confidenceScoreSchema`  | `ZodNumber`       | Integer 0-100                                      |
 * | `metadataSchema`         | `ZodRecord`       | Arbitrary JSON capped at 64 KB                     |
 *
 * ## Usage
 *
 * ```ts
 * import { baseFields, slugSchema, successEnvelopeSchema } from '@shared/schemas/base.js';
 * import { z } from 'zod';
 *
 * const mySiteSchema = z.object({
 *   ...baseFields,
 *   slug: slugSchema,
 *   name: z.string().min(1),
 * });
 *
 * const apiResponse = successEnvelopeSchema(mySiteSchema);
 * type MySite = z.infer<typeof mySiteSchema>;
 * ```
 */
import { z } from 'zod';

/**
 * Reusable base fields shared by every database-backed entity.
 *
 * Spread these into any `z.object()` call to inherit the standard primary key,
 * organisation scope, and timestamp columns present on every Postgres table.
 *
 * | Field        | Type                         | Description                       |
 * | ------------ | ---------------------------- | --------------------------------- |
 * | `id`         | UUID v4 string               | Primary key                       |
 * | `org_id`     | UUID v4 string               | Owning organisation (RLS scope)   |
 * | `created_at` | ISO 8601 datetime string     | Row creation timestamp            |
 * | `updated_at` | ISO 8601 datetime string     | Last modification timestamp       |
 * | `deleted_at` | ISO 8601 datetime or `null`  | Soft-delete timestamp             |
 */
export const baseFields = {
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
};

/**
 * Validates a UUID v4 string.
 *
 * Used as the standard identifier type for primary keys and foreign keys
 * throughout the data model.
 *
 * @example
 * ```ts
 * uuidSchema.parse('f47ac10b-58cc-4372-a567-0e02b2c3d479'); // OK
 * uuidSchema.parse('not-a-uuid'); // throws ZodError
 * ```
 */
export const uuidSchema = z.string().uuid();

/**
 * Validates a URL-safe slug (e.g. site or organisation identifier).
 *
 * Rules:
 * - 3 to 63 characters long (DNS label-safe).
 * - Lowercase alphanumeric characters and hyphens only.
 * - Must start and end with an alphanumeric character.
 *
 * @example
 * ```ts
 * slugSchema.parse('my-cool-site');   // OK
 * slugSchema.parse('-bad');           // throws ZodError
 * ```
 */
export const slugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Invalid slug format');

/**
 * Validates and normalises an email address.
 *
 * - Conforms to the RFC 5321 maximum of 254 characters.
 * - The value is lower-cased automatically via `.toLowerCase()`.
 *
 * @example
 * ```ts
 * emailSchema.parse('User@Example.COM'); // "user@example.com"
 * ```
 */
export const emailSchema = z.string().email().max(254).toLowerCase();

/**
 * Validates a phone number in E.164 international format.
 *
 * - Starts with `+` followed by a non-zero digit and 1-14 additional digits.
 * - Total length between 10 and 15 characters (including `+`).
 *
 * @see {@link https://www.itu.int/rec/T-REC-E.164 | ITU-T E.164}
 *
 * @example
 * ```ts
 * phoneSchema.parse('+14155552671'); // OK
 * phoneSchema.parse('4155552671');   // throws ZodError (missing '+')
 * ```
 */
export const phoneSchema = z
  .string()
  .min(10)
  .max(15)
  .regex(/^\+[1-9]\d{1,14}$/, 'Phone must be E.164 format');

/**
 * Validates a fully-qualified DNS hostname.
 *
 * - 3 to 253 characters (per RFC 1035 / RFC 1123).
 * - Each label is alphanumeric with optional internal hyphens.
 * - TLD must be at least 2 alphabetic characters.
 *
 * @example
 * ```ts
 * hostnameSchema.parse('my-site.megabyte.space'); // OK
 * hostnameSchema.parse('_invalid.host');           // throws ZodError
 * ```
 */
export const hostnameSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/, 'Invalid hostname format');

/**
 * Validates a URL that **must** use the HTTPS scheme.
 *
 * - Maximum length of 2 048 characters.
 * - Rejects `http://` and other non-HTTPS schemes.
 *
 * @example
 * ```ts
 * httpsUrlSchema.parse('https://example.com/page'); // OK
 * httpsUrlSchema.parse('http://example.com/page');   // throws ZodError
 * ```
 */
export const httpsUrlSchema = z.string().url().startsWith('https://').max(2048);

/**
 * Validates a user-supplied string and rejects common XSS vectors.
 *
 * Blocked patterns:
 * - `<script>` tags (case-insensitive).
 * - `javascript:` URIs.
 * - `data:` URIs.
 *
 * Maximum length is 1 000 characters.
 */
export const safeStringSchema = z
  .string()
  .max(1000)
  .refine((val) => !/<script[\s>]/i.test(val), 'Script tags not allowed')
  .refine((val) => !/javascript:/i.test(val), 'JavaScript URIs not allowed')
  .refine((val) => !/data:/i.test(val), 'Data URIs not allowed');

/**
 * Validates a short, XSS-safe string suitable for human-readable names and titles.
 *
 * - 1 to 200 characters.
 * - Rejects `<script>` tags (case-insensitive).
 */
export const nameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((val) => !/<script[\s>]/i.test(val), 'Script tags not allowed');

/**
 * Validates and coerces pagination query parameters.
 *
 * Both `limit` and `offset` accept string values (as they typically arrive
 * from URL query strings) and coerce them to integers.
 *
 * | Field    | Type    | Default | Range    |
 * | -------- | ------- | ------- | -------- |
 * | `limit`  | integer | 20      | 1 - 100  |
 * | `offset` | integer | 0       | >= 0     |
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Standard API error response envelope.
 *
 * All error responses returned by the Worker conform to this shape:
 *
 * ```json
 * {
 *   "error": {
 *     "code": "NOT_FOUND",
 *     "message": "Site not found",
 *     "request_id": "abc-123",
 *     "details": {}
 *   }
 * }
 * ```
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string().optional(),
    details: z.record(z.unknown()).optional(),
  }),
});

/**
 * Factory that creates a standard API success response envelope wrapping the
 * provided data schema.
 *
 * The resulting schema validates:
 *
 * | Field          | Type             | Description                            |
 * | -------------- | ---------------- | -------------------------------------- |
 * | `data`         | `T`              | The payload, typed by the caller       |
 * | `meta`         | object (optional)| Pagination and request tracking info   |
 *
 * @typeParam T - Zod schema for the `data` field.
 *
 * @example
 * ```ts
 * const listSitesResponse = successEnvelopeSchema(z.array(siteSchema));
 * ```
 */
export const successEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    meta: z
      .object({
        request_id: z.string().optional(),
        total: z.number().int().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      })
      .optional(),
  });

/**
 * Validates an integer confidence score between 0 and 100 (inclusive).
 *
 * Used by AI-generated content quality assessments and search relevance scoring.
 */
export const confidenceScoreSchema = z.number().int().min(0).max(100);

/**
 * Validates an arbitrary JSON metadata object, bounded to a maximum
 * serialised size of 64 KB.
 *
 * Stored as `jsonb` in Postgres; this schema ensures callers cannot
 * submit unbounded payloads.
 */
export const metadataSchema = z
  .record(z.unknown())
  .refine((val) => JSON.stringify(val).length <= 65536, 'Metadata too large (max 64KB)');
