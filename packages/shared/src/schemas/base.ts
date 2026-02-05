import { z } from 'zod';

/** Reusable base fields for all tables */
export const baseFields = {
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
};

/** UUID schema */
export const uuidSchema = z.string().uuid();

/** Slug: lowercase, alphanumeric + hyphens, 3-63 chars */
export const slugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Invalid slug format');

/** Email: max 254 chars per RFC */
export const emailSchema = z.string().email().max(254).toLowerCase();

/** Phone: E.164 format */
export const phoneSchema = z
  .string()
  .min(10)
  .max(15)
  .regex(/^\+[1-9]\d{1,14}$/, 'Phone must be E.164 format');

/** Hostname: valid domain name */
export const hostnameSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(
    /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
    'Invalid hostname format',
  );

/** URL: https only */
export const httpsUrlSchema = z.string().url().startsWith('https://').max(2048);

/** Safe string: no script tags, no HTML entities */
export const safeStringSchema = z
  .string()
  .max(1000)
  .refine((val) => !/<script[\s>]/i.test(val), 'Script tags not allowed')
  .refine((val) => !/javascript:/i.test(val), 'JavaScript URIs not allowed')
  .refine((val) => !/data:/i.test(val), 'Data URIs not allowed');

/** Short safe string for names/titles */
export const nameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((val) => !/<script[\s>]/i.test(val), 'Script tags not allowed');

/** Pagination */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Standard error envelope */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string().optional(),
    details: z.record(z.unknown()).optional(),
  }),
});

/** Standard success envelope */
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

/** Confidence score (0-100) */
export const confidenceScoreSchema = z.number().int().min(0).max(100);

/** JSON metadata field (safe bounded depth) */
export const metadataSchema = z.record(z.unknown()).refine(
  (val) => JSON.stringify(val).length <= 65536,
  'Metadata too large (max 64KB)',
);
