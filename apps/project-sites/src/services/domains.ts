/**
 * @module domains
 * @description Domain provisioning service using Cloudflare for SaaS.
 *
 * Manages both free subdomains (`slug-sites.megabyte.space`) and custom
 * CNAME domains for paid plans. Integrates with the Cloudflare Custom
 * Hostnames API for SSL provisioning and verification.
 *
 * ## Hostname Lifecycle
 *
 * ```
 * provisionFreeDomain / provisionCustomDomain
 *   → CF API: create custom hostname
 *   → D1: INSERT into hostnames (status = pending|active)
 *   → Cron: verifyPendingHostnames checks CF status
 *   → D1: UPDATE status to active|verification_failed
 * ```
 *
 * ## Table: `hostnames`
 *
 * | Column                  | Type   | Description                      |
 * | ----------------------- | ------ | -------------------------------- |
 * | `id`                    | TEXT   | UUID primary key                 |
 * | `org_id`                | TEXT   | Owning organization              |
 * | `site_id`               | TEXT   | Associated site                  |
 * | `hostname`              | TEXT   | Full domain (unique)             |
 * | `type`                  | TEXT   | `free_subdomain` or `custom_cname` |
 * | `status`                | TEXT   | pending / active / verification_failed |
 * | `cf_custom_hostname_id` | TEXT?  | Cloudflare hostname resource ID  |
 * | `ssl_status`            | TEXT   | pending / active / error         |
 *
 * @packageDocumentation
 */

import {
  DOMAINS,
  ENTITLEMENTS,
  badRequest,
  notFound,
  conflict,
  type HostnameState,
} from '@project-sites/shared';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from './db.js';
import type { Env } from '../types/env.js';

/**
 * Domain provisioner interface for dependency injection / testing.
 */
export interface DomainProvisioner {
  provisionFreeDomain(opts: {
    org_id: string;
    site_id: string;
    slug: string;
  }): Promise<{ hostname: string; status: HostnameState }>;

  provisionCustomDomain(opts: {
    org_id: string;
    site_id: string;
    hostname: string;
  }): Promise<{ hostname: string; status: HostnameState }>;

  verifyHostname(hostname: string): Promise<{
    status: HostnameState;
    ssl_status: string;
    errors: string[];
  }>;

  deprovisionHostname(hostname: string): Promise<void>;
}

/**
 * Create a Cloudflare for SaaS custom hostname via the API.
 *
 * @param env      - Worker environment (needs `CF_API_TOKEN`, `CF_ZONE_ID`).
 * @param hostname - The fully-qualified domain to provision.
 * @returns Cloudflare hostname ID, status, and SSL status.
 * @throws {badRequest} If the Cloudflare API call fails.
 *
 * @example
 * ```ts
 * const { cf_id, status, ssl_status } = await createCustomHostname(env, 'example.com');
 * ```
 */
export async function createCustomHostname(
  env: Env,
  hostname: string,
): Promise<{ cf_id: string; status: string; ssl_status: string }> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/custom_hostnames`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hostname,
        ssl: {
          method: 'http',
          type: 'dv',
          settings: { min_tls_version: '1.2' },
        },
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw badRequest(`Failed to create custom hostname: ${err}`);
  }

  const data = (await response.json()) as {
    result: { id: string; status: string; ssl: { status: string } };
  };

  return {
    cf_id: data.result.id,
    status: data.result.status,
    ssl_status: data.result.ssl?.status ?? 'unknown',
  };
}

/**
 * Check the verification status of a custom hostname.
 *
 * @param env                 - Worker environment.
 * @param cfCustomHostnameId  - Cloudflare hostname resource ID.
 * @returns Current status, SSL status, and any verification errors.
 * @throws {notFound} If the hostname doesn't exist in Cloudflare.
 */
export async function checkHostnameStatus(
  env: Env,
  cfCustomHostnameId: string,
): Promise<{ status: string; ssl_status: string; verification_errors: string[] }> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/custom_hostnames/${cfCustomHostnameId}`,
    {
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw notFound('Custom hostname not found');
  }

  const data = (await response.json()) as {
    result: { status: string; ssl: { status: string }; verification_errors?: string[] };
  };

  return {
    status: data.result.status,
    ssl_status: data.result.ssl?.status ?? 'unknown',
    verification_errors: data.result.verification_errors ?? [],
  };
}

/**
 * Delete a custom hostname from Cloudflare.
 *
 * @param env                 - Worker environment.
 * @param cfCustomHostnameId  - Cloudflare hostname resource ID.
 * @throws {badRequest} If deletion fails (404 is silently ignored).
 */
export async function deleteCustomHostname(env: Env, cfCustomHostnameId: string): Promise<void> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/custom_hostnames/${cfCustomHostnameId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
    },
  );

  if (!response.ok && response.status !== 404) {
    const err = await response.text();
    throw badRequest(`Failed to delete custom hostname: ${err}`);
  }
}

/**
 * Provision a free subdomain for a site (e.g. `slug-sites.megabyte.space`).
 *
 * If the hostname already exists in D1, returns its current status without
 * creating a duplicate.
 *
 * @param db   - D1Database binding.
 * @param env  - Worker environment.
 * @param opts - Organization, site, and slug.
 * @returns The provisioned hostname and its status.
 *
 * @example
 * ```ts
 * const { hostname, status } = await provisionFreeDomain(env.DB, env, {
 *   org_id: orgId,
 *   site_id: siteId,
 *   slug: 'vitos-mens-salon',
 * });
 * // hostname = 'vitos-mens-salon-sites.megabyte.space'
 * ```
 */
export async function provisionFreeDomain(
  db: D1Database,
  env: Env,
  opts: { org_id: string; site_id: string; slug: string },
): Promise<{ hostname: string; status: HostnameState }> {
  const hostname = `${opts.slug}${DOMAINS.SITES_SUFFIX}`;

  // Check if already exists
  const existing = await dbQueryOne<{ id: string; status: string }>(
    db,
    'SELECT id, status FROM hostnames WHERE hostname = ? AND deleted_at IS NULL',
    [hostname],
  );

  if (existing) {
    return { hostname, status: existing.status as HostnameState };
  }

  // Create CF custom hostname
  const cfResult = await createCustomHostname(env, hostname);

  // Store in DB
  await dbInsert(db, 'hostnames', {
    id: crypto.randomUUID(),
    org_id: opts.org_id,
    site_id: opts.site_id,
    hostname,
    type: 'free_subdomain',
    status: cfResult.status === 'active' ? 'active' : 'pending',
    cf_custom_hostname_id: cfResult.cf_id,
    ssl_status: cfResult.ssl_status,
    verification_errors: null,
    last_verified_at: new Date().toISOString(),
    deleted_at: null,
  });

  return {
    hostname,
    status: cfResult.status === 'active' ? 'active' : 'pending',
  };
}

/**
 * Provision a custom CNAME domain for a paid site.
 *
 * Enforces the per-org domain limit from entitlements and checks for
 * duplicate hostnames before calling the Cloudflare API.
 *
 * @param db   - D1Database binding.
 * @param env  - Worker environment.
 * @param opts - Organization, site, and desired hostname.
 * @returns The provisioned hostname and its status.
 * @throws {conflict} If the domain limit is reached or hostname exists.
 *
 * @example
 * ```ts
 * const { hostname, status } = await provisionCustomDomain(env.DB, env, {
 *   org_id: orgId,
 *   site_id: siteId,
 *   hostname: 'www.example.com',
 * });
 * ```
 */
export async function provisionCustomDomain(
  db: D1Database,
  env: Env,
  opts: { org_id: string; site_id: string; hostname: string },
): Promise<{ hostname: string; status: HostnameState }> {
  // Check domain limit
  const { data: existingDomains } = await dbQuery<{ id: string }>(
    db,
    'SELECT id FROM hostnames WHERE org_id = ? AND type = ? AND deleted_at IS NULL',
    [opts.org_id, 'custom_cname'],
  );

  if (existingDomains.length >= ENTITLEMENTS.paid.maxCustomDomains) {
    throw conflict(`Maximum custom domains (${ENTITLEMENTS.paid.maxCustomDomains}) reached`);
  }

  // Check if hostname already exists
  const existing = await dbQueryOne<{ id: string }>(
    db,
    'SELECT id FROM hostnames WHERE hostname = ? AND deleted_at IS NULL',
    [opts.hostname],
  );

  if (existing) {
    throw conflict(`Hostname ${opts.hostname} already registered`);
  }

  // Create CF custom hostname
  const cfResult = await createCustomHostname(env, opts.hostname);

  // Store in DB
  await dbInsert(db, 'hostnames', {
    id: crypto.randomUUID(),
    org_id: opts.org_id,
    site_id: opts.site_id,
    hostname: opts.hostname,
    type: 'custom_cname',
    status: cfResult.status === 'active' ? 'active' : 'pending',
    cf_custom_hostname_id: cfResult.cf_id,
    ssl_status: cfResult.ssl_status,
    verification_errors: null,
    last_verified_at: new Date().toISOString(),
    deleted_at: null,
  });

  return {
    hostname: opts.hostname,
    status: cfResult.status === 'active' ? 'active' : 'pending',
  };
}

/**
 * Get all hostnames for a site (includes is_primary flag).
 *
 * @param db     - D1Database binding.
 * @param siteId - The site to query hostnames for.
 * @returns Array of hostname records with is_primary flag.
 */
export async function getSiteHostnames(
  db: D1Database,
  siteId: string,
): Promise<
  Array<{ id: string; hostname: string; type: string; status: string; ssl_status: string; is_primary: number }>
> {
  const { data } = await dbQuery<{
    id: string;
    hostname: string;
    type: string;
    status: string;
    ssl_status: string;
    is_primary: number;
  }>(
    db,
    'SELECT id, hostname, type, status, ssl_status, COALESCE(is_primary, 0) as is_primary FROM hostnames WHERE site_id = ? AND deleted_at IS NULL ORDER BY is_primary DESC, created_at ASC',
    [siteId],
  );

  return data;
}

/**
 * Set a hostname as the primary for its site.
 *
 * Clears primary from all other hostnames on the same site, then sets the
 * specified hostname as primary.
 *
 * @param db         - D1Database binding.
 * @param siteId     - The site ID.
 * @param hostnameId - The hostname ID to set as primary.
 * @throws {notFound} If the hostname doesn't exist for this site.
 */
export async function setPrimaryHostname(
  db: D1Database,
  siteId: string,
  hostnameId: string,
): Promise<void> {
  // Verify the hostname belongs to this site
  const hostname = await dbQueryOne<{ id: string }>(
    db,
    'SELECT id FROM hostnames WHERE id = ? AND site_id = ? AND deleted_at IS NULL',
    [hostnameId, siteId],
  );

  if (!hostname) {
    throw notFound('Hostname not found for this site');
  }

  // Clear primary from all hostnames on this site
  await dbUpdate(db, 'hostnames', { is_primary: 0 }, 'site_id = ?', [siteId]);

  // Set the selected hostname as primary
  await dbUpdate(db, 'hostnames', { is_primary: 1 }, 'id = ?', [hostnameId]);
}

/**
 * Check if a hostname has a CNAME record pointing to the expected target.
 *
 * Uses Cloudflare's DNS over HTTPS resolver to look up CNAME records.
 *
 * @param hostname - The domain to check.
 * @returns The CNAME target (without trailing dot), or null if no CNAME found.
 */
export async function checkCnameTarget(hostname: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=CNAME`,
      { headers: { accept: 'application/dns-json' } },
    );

    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      Answer?: Array<{ type: number; data: string }>;
    };
    const cnameRecord = data.Answer?.find((a) => a.type === 5);

    if (cnameRecord) {
      return cnameRecord.data.replace(/\.$/, '');
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get the primary hostname for a site (or first hostname if none set as primary).
 *
 * @param db     - D1Database binding.
 * @param siteId - The site to query.
 * @returns The primary hostname string, or null if no hostnames exist.
 */
export async function getPrimaryHostname(
  db: D1Database,
  siteId: string,
): Promise<string | null> {
  const primary = await dbQueryOne<{ hostname: string }>(
    db,
    'SELECT hostname FROM hostnames WHERE site_id = ? AND deleted_at IS NULL ORDER BY COALESCE(is_primary, 0) DESC, created_at ASC LIMIT 1',
    [siteId],
  );

  return primary?.hostname ?? null;
}

/**
 * Look up a hostname record by its domain name.
 *
 * @param db       - D1Database binding.
 * @param hostname - The full domain to look up.
 * @returns Hostname record or `null`.
 */
export async function getHostnameByDomain(
  db: D1Database,
  hostname: string,
): Promise<{
  id: string;
  site_id: string;
  org_id: string;
  type: string;
  status: string;
} | null> {
  return dbQueryOne<{
    id: string;
    site_id: string;
    org_id: string;
    type: string;
    status: string;
  }>(
    db,
    'SELECT id, site_id, org_id, type, status FROM hostnames WHERE hostname = ? AND deleted_at IS NULL',
    [hostname],
  );
}

/**
 * Verify all pending hostnames against Cloudflare (scheduled cron job).
 *
 * Iterates over hostnames with `status = 'pending'`, checks their Cloudflare
 * verification state, and updates D1 accordingly.
 *
 * @param db  - D1Database binding.
 * @param env - Worker environment.
 * @returns Count of verified and failed hostnames.
 */
export async function verifyPendingHostnames(
  db: D1Database,
  env: Env,
): Promise<{ verified: number; failed: number }> {
  const { data: pending } = await dbQuery<{
    id: string;
    cf_custom_hostname_id: string;
    hostname: string;
  }>(
    db,
    'SELECT id, cf_custom_hostname_id, hostname FROM hostnames WHERE status = ? AND deleted_at IS NULL',
    ['pending'],
  );

  let verified = 0;
  let failed = 0;

  for (const record of pending) {
    if (!record.cf_custom_hostname_id) continue;

    try {
      const status = await checkHostnameStatus(env, record.cf_custom_hostname_id);

      const newStatus: HostnameState =
        status.status === 'active'
          ? 'active'
          : status.verification_errors.length > 0
            ? 'verification_failed'
            : 'pending';

      await dbUpdate(
        db,
        'hostnames',
        {
          status: newStatus,
          ssl_status: status.ssl_status,
          verification_errors:
            status.verification_errors.length > 0
              ? JSON.stringify(status.verification_errors)
              : null,
          last_verified_at: new Date().toISOString(),
        },
        'id = ?',
        [record.id],
      );

      if (newStatus === 'active') verified++;
      if (newStatus === 'verification_failed') failed++;
    } catch {
      failed++;
    }
  }

  return { verified, failed };
}
