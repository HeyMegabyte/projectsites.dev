import { z } from 'zod';

/** Standard API error codes */
export const apiErrorCodes = [
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
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];

/** Typed API error */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(apiErrorCodes),
    message: z.string().max(2000),
    request_id: z.string().max(255).optional(),
    details: z.record(z.unknown()).optional(),
  }),
});

/** Health check response */
export const healthCheckSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  version: z.string(),
  environment: z.string(),
  timestamp: z.string().datetime(),
  checks: z
    .record(
      z.object({
        status: z.enum(['ok', 'error']),
        latency_ms: z.number().optional(),
        message: z.string().optional(),
      }),
    )
    .optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type HealthCheck = z.infer<typeof healthCheckSchema>;
