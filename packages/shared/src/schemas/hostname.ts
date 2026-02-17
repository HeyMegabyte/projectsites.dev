/**
 * @module hostname
 * @packageDocumentation
 *
 * Zod schemas for custom hostname management.
 *
 * Each published site can have one or more hostnames -- either a free
 * subdomain on `*.megabyte.space` or a customer-owned custom CNAME.
 * These schemas validate rows in the `hostnames` Postgres table, the
 * create-hostname API request body, and the hostname status-check response.
 *
 * Hostname provisioning is backed by the Cloudflare Custom Hostnames API,
 * and the `cf_custom_hostname_id` / `ssl_status` / `verification_errors`
 * fields track the asynchronous verification lifecycle.
 *
 * ## Schemas and Types
 *
 * | Export                  | Kind        | Inferred Type    | Description                                 |
 * | ----------------------- | ----------- | ---------------- | ------------------------------------------- |
 * | `hostnameRecordSchema`  | `ZodObject` | `HostnameRecord` | Full hostname row (database record)         |
 * | `createHostnameSchema`  | `ZodObject` | `CreateHostname` | Request body for creating a new hostname    |
 * | `hostnameStatusSchema`  | `ZodObject` | `HostnameStatus` | Lightweight status-check response payload   |
 *
 * ## Usage
 *
 * ```ts
 * import { createHostnameSchema, type CreateHostname } from '@shared/schemas/hostname.js';
 *
 * const body: CreateHostname = createHostnameSchema.parse(await request.json());
 * ```
 */
import { z } from 'zod';
import { baseFields, hostnameSchema, uuidSchema } from './base.js';
import { HOSTNAME_STATES } from '../constants/index.js';

/**
 * Validates a full row from the `hostnames` Postgres table.
 *
 * | Field                     | Type                                          | Description                                          |
 * | ------------------------- | --------------------------------------------- | ---------------------------------------------------- |
 * | `site_id`                 | UUID                                          | Foreign key to the owning site                       |
 * | `hostname`                | DNS hostname string                           | The actual domain name                               |
 * | `type`                    | `'free_subdomain'` or `'custom_cname'`        | Whether this is a managed subdomain or custom domain |
 * | `status`                  | one of {@link HOSTNAME_STATES}                | Current provisioning status                          |
 * | `cf_custom_hostname_id`   | string or `null`                              | Cloudflare Custom Hostname API resource ID           |
 * | `ssl_status`              | `'pending'` / `'active'` / `'error'` / `'unknown'` | TLS certificate status              |
 * | `verification_errors`     | string array (max 10) or `null`               | Error messages from DNS/TLS verification             |
 * | `last_verified_at`        | ISO 8601 datetime or `null`                   | Timestamp of the most recent verification check      |
 *
 * Inherits {@link baseFields} (`id`, `org_id`, timestamps).
 */
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

/**
 * Validates the request body for creating (provisioning) a new hostname.
 *
 * | Field      | Type                                   | Description                          |
 * | ---------- | -------------------------------------- | ------------------------------------ |
 * | `site_id`  | UUID                                   | The site to attach the hostname to   |
 * | `hostname` | DNS hostname string                    | Desired hostname                     |
 * | `type`     | `'free_subdomain'` or `'custom_cname'` | Hostname category                    |
 */
export const createHostnameSchema = z.object({
  site_id: uuidSchema,
  hostname: hostnameSchema,
  type: z.enum(['free_subdomain', 'custom_cname']),
});

/**
 * Validates the lightweight response payload returned by the hostname
 * status-check endpoint.
 *
 * This is a subset of {@link hostnameRecordSchema} containing only the
 * fields relevant to a client polling for verification progress.
 */
export const hostnameStatusSchema = z.object({
  hostname: hostnameSchema,
  status: z.enum(HOSTNAME_STATES),
  ssl_status: z.enum(['pending', 'active', 'error', 'unknown']),
  verification_errors: z.array(z.string()).nullable(),
});

/** Inferred TypeScript type for a full hostname database row. */
export type HostnameRecord = z.infer<typeof hostnameRecordSchema>;

/** Inferred TypeScript type for the create-hostname request body. */
export type CreateHostname = z.infer<typeof createHostnameSchema>;

/** Inferred TypeScript type for a hostname status-check response. */
export type HostnameStatus = z.infer<typeof hostnameStatusSchema>;
