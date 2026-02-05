import { z } from 'zod';
import { baseFields, uuidSchema } from './base.js';
import { JOB_STATES } from '../constants/index.js';

/** Workflow job schema */
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

/** Create job request */
export const createWorkflowJobSchema = z.object({
  job_name: z.string().min(1).max(100),
  org_id: uuidSchema,
  site_id: uuidSchema.optional(),
  dedupe_key: z.string().max(500).optional(),
  payload: z.record(z.unknown()).optional(),
  max_attempts: z.number().int().min(1).max(10).default(3),
});

/** Job envelope for queue transport */
export const jobEnvelopeSchema = z.object({
  job_id: uuidSchema,
  job_name: z.string().min(1).max(100),
  org_id: uuidSchema,
  dedupe_key: z.string().max(500).nullable(),
  payload_pointer: z.string().max(2048).nullable(),
  attempt: z.number().int().min(0),
  max_attempts: z.number().int().min(1).max(10),
});

export type WorkflowJob = z.infer<typeof workflowJobSchema>;
export type CreateWorkflowJob = z.infer<typeof createWorkflowJobSchema>;
export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;
