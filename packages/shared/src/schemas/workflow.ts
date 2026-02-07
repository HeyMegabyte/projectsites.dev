/**
 * @module workflow
 * @packageDocumentation
 *
 * Zod schemas for the asynchronous workflow / job-queue system.
 *
 * Workflow jobs represent long-running background tasks (e.g. AI site
 * generation) that are persisted in the `workflow_jobs` Postgres table and
 * transported via Cloudflare Queues. The lifecycle is:
 *
 * 1. A client creates a job via the API ({@link createWorkflowJobSchema}).
 * 2. The Worker inserts a row and enqueues a {@link jobEnvelopeSchema} message.
 * 3. The consumer processes the job, updating status through {@link JOB_STATES}.
 * 4. The full persisted row is validated with {@link workflowJobSchema}.
 *
 * ## Schemas and Types
 *
 * | Export                     | Kind        | Inferred Type       | Description                                  |
 * | -------------------------- | ----------- | ------------------- | -------------------------------------------- |
 * | `workflowJobSchema`        | `ZodObject` | `WorkflowJob`       | Full workflow job database row                |
 * | `createWorkflowJobSchema`  | `ZodObject` | `CreateWorkflowJob` | Request body for creating a new job           |
 * | `jobEnvelopeSchema`        | `ZodObject` | `JobEnvelope`       | Lightweight message envelope for queue transport |
 *
 * ## Usage
 *
 * ```ts
 * import {
 *   createWorkflowJobSchema,
 *   type CreateWorkflowJob,
 * } from '@shared/schemas/workflow.js';
 *
 * const body: CreateWorkflowJob = createWorkflowJobSchema.parse(await request.json());
 * ```
 */
import { z } from 'zod';
import { baseFields, uuidSchema } from './base.js';
import { JOB_STATES } from '../constants/index.js';

/**
 * Validates a full row from the `workflow_jobs` Postgres table.
 *
 * | Field              | Type                           | Description                                          |
 * | ------------------ | ------------------------------ | ---------------------------------------------------- |
 * | `job_name`         | string (1-100 chars)           | Identifies the job type (e.g. `'generate_site'`)     |
 * | `site_id`          | UUID or `null`                 | Optional association with a site                     |
 * | `dedupe_key`       | string (max 500) or `null`     | Prevents duplicate jobs for the same logical action  |
 * | `payload_pointer`  | string (max 2048) or `null`    | R2 key or URL pointing to the full job payload       |
 * | `status`           | one of {@link JOB_STATES}      | Current lifecycle state                              |
 * | `attempt`          | non-negative integer (default 0) | Current attempt number                             |
 * | `max_attempts`     | integer 1-10 (default 3)       | Maximum retry attempts before permanent failure      |
 * | `started_at`       | ISO 8601 datetime or `null`    | When processing started                              |
 * | `completed_at`     | ISO 8601 datetime or `null`    | When processing finished (success or failure)        |
 * | `error_message`    | string (max 2000) or `null`    | Human-readable error on failure                      |
 * | `result_pointer`   | string (max 2048) or `null`    | R2 key or URL pointing to the job result             |
 *
 * Inherits {@link baseFields} (`id`, `org_id`, timestamps).
 */
export const workflowJobSchema = z.object({
  ...baseFields,
  job_name: z.string().min(1).max(100),
  site_id: uuidSchema.nullable(),
  dedupe_key: z.string().max(500).nullable(),
  payload_pointer: z.string().max(2048).nullable(),
  status: z.enum(JOB_STATES),
  attempt: z.number().int().min(0).default(0),
  max_attempts: z.number().int().min(1).max(10).default(3),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  error_message: z.string().max(2000).nullable(),
  result_pointer: z.string().max(2048).nullable(),
});

/**
 * Validates the request body for creating a new workflow job via the API.
 *
 * Unlike {@link workflowJobSchema}, this schema omits server-generated
 * fields (`id`, timestamps, `status`, `attempt`, pointers) and accepts
 * an inline `payload` object instead of a `payload_pointer`.
 *
 * | Field          | Type                       | Description                              |
 * | -------------- | -------------------------- | ---------------------------------------- |
 * | `job_name`     | string (1-100 chars)       | Job type identifier                      |
 * | `org_id`       | UUID                       | Owning organisation                      |
 * | `site_id`      | UUID (optional)            | Associated site, if applicable           |
 * | `dedupe_key`   | string (optional, max 500) | Idempotency / dedup key                  |
 * | `payload`      | JSON object (optional)     | Inline job payload (stored to R2)        |
 * | `max_attempts` | integer 1-10 (default 3)   | Retry budget                             |
 */
export const createWorkflowJobSchema = z.object({
  job_name: z.string().min(1).max(100),
  org_id: uuidSchema,
  site_id: uuidSchema.optional(),
  dedupe_key: z.string().max(500).optional(),
  payload: z.record(z.unknown()).optional(),
  max_attempts: z.number().int().min(1).max(10).default(3),
});

/**
 * Validates the lightweight message envelope sent through Cloudflare Queues.
 *
 * The envelope carries just enough information for the queue consumer to
 * identify the job and fetch its full payload from R2 via `payload_pointer`.
 * It intentionally excludes large or mutable fields to keep message sizes
 * small and avoid stale-data issues.
 *
 * | Field             | Type                        | Description                         |
 * | ----------------- | --------------------------- | ----------------------------------- |
 * | `job_id`          | UUID                        | Primary key of the workflow job     |
 * | `job_name`        | string (1-100 chars)        | Job type identifier                 |
 * | `org_id`          | UUID                        | Owning organisation                 |
 * | `dedupe_key`      | string (max 500) or `null`  | Deduplication key                   |
 * | `payload_pointer` | string (max 2048) or `null` | R2 key to the full payload          |
 * | `attempt`         | non-negative integer        | Current attempt number              |
 * | `max_attempts`    | integer 1-10                | Maximum allowed attempts            |
 */
export const jobEnvelopeSchema = z.object({
  job_id: uuidSchema,
  job_name: z.string().min(1).max(100),
  org_id: uuidSchema,
  dedupe_key: z.string().max(500).nullable(),
  payload_pointer: z.string().max(2048).nullable(),
  attempt: z.number().int().min(0),
  max_attempts: z.number().int().min(1).max(10),
});

/** Inferred TypeScript type for a full workflow job database row. */
export type WorkflowJob = z.infer<typeof workflowJobSchema>;

/** Inferred TypeScript type for the create-job request body. */
export type CreateWorkflowJob = z.infer<typeof createWorkflowJobSchema>;

/** Inferred TypeScript type for the queue message envelope. */
export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;
