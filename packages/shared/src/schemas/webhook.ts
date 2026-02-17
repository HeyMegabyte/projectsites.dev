/**
 * @module webhook
 * @packageDocumentation
 *
 * Zod schemas for the **webhook event** ingestion and processing subsystem.
 *
 * Incoming webhooks from external providers (Stripe, Dub, Chatwoot, Novu, Lago)
 * are first validated against {@link webhookIngestionSchema}, persisted as
 * {@link webhookEventSchema} rows, and then processed asynchronously. Each event
 * tracks its processing status through a state machine:
 * `received -> processing -> processed | failed | quarantined`.
 *
 * Deduplication is handled via the `event_id` + `payload_hash` combination.
 * Failed events are retried up to the configured maximum (see `attempts`).
 *
 * | Zod Schema               | Inferred Type      | Purpose                                         |
 * | ------------------------ | ------------------ | ----------------------------------------------- |
 * | `webhookEventSchema`     | `WebhookEvent`     | Full webhook event row from the database         |
 * | `webhookIngestionSchema` | `WebhookIngestion` | Payload for ingesting a raw incoming webhook     |
 *
 * @example
 * ```ts
 * import { webhookIngestionSchema, type WebhookIngestion } from '@blitz/shared/schemas/webhook';
 *
 * const raw: WebhookIngestion = {
 *   provider: 'stripe',
 *   event_id: 'evt_1234567890',
 *   event_type: 'invoice.paid',
 *   raw_body: '{"id":"evt_1234567890","type":"invoice.paid",...}',
 *   signature: 'whsec_...',
 * };
 * const parsed = webhookIngestionSchema.parse(raw);
 * ```
 */
import { z } from 'zod';
import { baseFields, uuidSchema } from './base.js';
import { WEBHOOK_PROVIDERS } from '../constants/index.js';

/**
 * Full webhook event record as stored in the `webhook_events` database table.
 *
 * Fields:
 * - `id` -- unique UUID for this event record.
 * - `org_id` -- the organization this event is scoped to, or `null` if the
 *   org cannot be determined from the payload (resolved during processing).
 * - `provider` -- the originating service (`stripe | dub | chatwoot | novu | lago`).
 * - `event_id` -- the provider's unique event identifier (used for deduplication).
 * - `event_type` -- the provider-specific event type string (e.g. `"invoice.paid"`).
 * - `payload_pointer` -- optional reference to the raw payload in cold storage
 *   (e.g. an R2 object key), max 2048 chars.
 * - `payload_hash` -- SHA-256 hash of the raw payload for deduplication and
 *   integrity verification, max 128 chars.
 * - `status` -- processing state machine:
 *   `received | processing | processed | failed | quarantined`.
 * - `error_message` -- human-readable error description when `status` is
 *   `failed` or `quarantined`, max 2000 chars.
 * - `attempts` -- number of processing attempts so far (starts at 0).
 * - `processed_at` -- ISO 8601 timestamp of successful processing, or `null`.
 * - `created_at`, `updated_at`, `deleted_at` -- standard timestamp fields.
 */
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

/**
 * Request payload for ingesting a raw incoming webhook.
 *
 * Validates the minimum required fields to persist the event before
 * asynchronous processing. The `raw_body` field accepts up to 256 KB of
 * payload data. The optional `signature` and `timestamp` fields are used
 * for HMAC verification (e.g. Stripe `Stripe-Signature` header) via the
 * Web Crypto API.
 */
export const webhookIngestionSchema = z.object({
  provider: z.enum(WEBHOOK_PROVIDERS),
  event_id: z.string().min(1).max(500),
  event_type: z.string().min(1).max(200),
  raw_body: z.string().max(256 * 1024), // 256KB max
  signature: z.string().max(1024).optional(),
  timestamp: z.string().max(100).optional(),
});

/** Inferred TypeScript type for a full webhook event record. */
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

/** Inferred TypeScript type for the webhook ingestion request payload. */
export type WebhookIngestion = z.infer<typeof webhookIngestionSchema>;
