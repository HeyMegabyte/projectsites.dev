import { z } from 'zod';
import { baseFields, uuidSchema } from './base.js';
import { WEBHOOK_PROVIDERS } from '../constants/index.js';

/** Webhook event record */
export const webhookEventSchema = z.object({
  id: baseFields.id,
  org_id: uuidSchema.nullable(),
  provider: z.enum(WEBHOOK_PROVIDERS),
  event_id: z.string().max(500),
  event_type: z.string().max(200),
  payload_pointer: z.string().max(2048).nullable(),
  payload_hash: z.string().max(128).nullable(),
  status: z.enum(['received', 'processing', 'processed', 'failed', 'quarantined']),
  error_message: z.string().max(2000).nullable(),
  attempts: z.number().int().min(0).default(0),
  processed_at: z.string().datetime().nullable(),
  created_at: baseFields.created_at,
  updated_at: baseFields.updated_at,
  deleted_at: baseFields.deleted_at,
});

/** Webhook ingestion request */
export const webhookIngestionSchema = z.object({
  provider: z.enum(WEBHOOK_PROVIDERS),
  event_id: z.string().min(1).max(500),
  event_type: z.string().min(1).max(200),
  raw_body: z.string().max(256 * 1024), // 256KB max
  signature: z.string().max(1024).optional(),
  timestamp: z.string().max(100).optional(),
});

export type WebhookEvent = z.infer<typeof webhookEventSchema>;
export type WebhookIngestion = z.infer<typeof webhookIngestionSchema>;
