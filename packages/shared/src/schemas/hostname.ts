import { z } from 'zod';
import { baseFields, hostnameSchema, uuidSchema } from './base.js';
import { HOSTNAME_STATES } from '../constants/index.js';

/** Hostname record */
export const hostnameRecordSchema = z.object({
  ...baseFields,
  site_id: uuidSchema,
  hostname: hostnameSchema,
  type: z.enum(['free_subdomain', 'custom_cname']),
  status: z.enum(HOSTNAME_STATES),
  cf_custom_hostname_id: z.string().max(255).nullable(),
  ssl_status: z.enum(['pending', 'active', 'error', 'unknown']).default('pending'),
  verification_errors: z.array(z.string().max(500)).max(10).nullable(),
  last_verified_at: z.string().datetime().nullable(),
});

/** Create hostname request */
export const createHostnameSchema = z.object({
  site_id: uuidSchema,
  hostname: hostnameSchema,
  type: z.enum(['free_subdomain', 'custom_cname']),
});

/** Hostname status check response */
export const hostnameStatusSchema = z.object({
  hostname: hostnameSchema,
  status: z.enum(HOSTNAME_STATES),
  ssl_status: z.enum(['pending', 'active', 'error', 'unknown']),
  verification_errors: z.array(z.string()).nullable(),
});

export type HostnameRecord = z.infer<typeof hostnameRecordSchema>;
export type CreateHostname = z.infer<typeof createHostnameSchema>;
export type HostnameStatus = z.infer<typeof hostnameStatusSchema>;
