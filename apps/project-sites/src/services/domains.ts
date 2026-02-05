import {
  DOMAINS,
  ENTITLEMENTS,
  badRequest,
  notFound,
  conflict,
  type HostnameState,
} from '@project-sites/shared';
import type { SupabaseClient } from './db.js';
import { supabaseQuery } from './db.js';
import type { Env } from '../types/env.js';

/**
 * Domain provisioning service using Cloudflare for SaaS custom hostnames.
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
 * Create a Cloudflare for SaaS custom hostname.
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
          settings: {
            min_tls_version: '1.2',
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw badRequest(`Failed to create custom hostname: ${err}`);
  }

  const data = (await response.json()) as {
    result: {
      id: string;
      status: string;
      ssl: { status: string };
    };
  };

  return {
    cf_id: data.result.id,
    status: data.result.status,
    ssl_status: data.result.ssl?.status ?? 'unknown',
  };
}

/**
 * Check the status of a custom hostname.
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
    result: {
      status: string;
      ssl: { status: string };
      verification_errors?: string[];
    };
  };

  return {
    status: data.result.status,
    ssl_status: data.result.ssl?.status ?? 'unknown',
    verification_errors: data.result.verification_errors ?? [],
  };
}

/**
 * Delete a custom hostname.
 */
export async function deleteCustomHostname(env: Env, cfCustomHostnameId: string): Promise<void> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/custom_hostnames/${cfCustomHostnameId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
      },
    },
  );

  if (!response.ok && response.status !== 404) {
    const err = await response.text();
    throw badRequest(`Failed to delete custom hostname: ${err}`);
  }
}

/**
 * Provision a free subdomain for a site (e.g., slug.sites.megabyte.space).
 */
export async function provisionFreeDomain(
  db: SupabaseClient,
  env: Env,
  opts: { org_id: string; site_id: string; slug: string },
): Promise<{ hostname: string; status: HostnameState }> {
  const hostname = `${opts.slug}.${DOMAINS.SITES_BASE}`;

  // Check if already exists
  const existing = await supabaseQuery<Array<{ id: string; status: string }>>(db, 'hostnames', {
    query: `hostname=eq.${encodeURIComponent(hostname)}&deleted_at=is.null&select=id,status`,
  });

  if (existing.data && existing.data.length > 0) {
    return { hostname, status: existing.data[0]!.status as HostnameState };
  }

  // Create CF custom hostname
  const cfResult = await createCustomHostname(env, hostname);

  // Store in DB
  await supabaseQuery(db, 'hostnames', {
    method: 'POST',
    body: {
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    },
  });

  return {
    hostname,
    status: cfResult.status === 'active' ? 'active' : 'pending',
  };
}

/**
 * Provision a custom CNAME domain for a paid site.
 */
export async function provisionCustomDomain(
  db: SupabaseClient,
  env: Env,
  opts: { org_id: string; site_id: string; hostname: string },
): Promise<{ hostname: string; status: HostnameState }> {
  // Check domain limit
  const existingDomains = await supabaseQuery<Array<{ id: string }>>(db, 'hostnames', {
    query: `org_id=eq.${opts.org_id}&type=eq.custom_cname&deleted_at=is.null&select=id`,
  });

  if (existingDomains.data && existingDomains.data.length >= ENTITLEMENTS.paid.maxCustomDomains) {
    throw conflict(`Maximum custom domains (${ENTITLEMENTS.paid.maxCustomDomains}) reached`);
  }

  // Check if hostname already exists
  const existing = await supabaseQuery<Array<{ id: string }>>(db, 'hostnames', {
    query: `hostname=eq.${encodeURIComponent(opts.hostname)}&deleted_at=is.null&select=id`,
  });

  if (existing.data && existing.data.length > 0) {
    throw conflict(`Hostname ${opts.hostname} already registered`);
  }

  // Create CF custom hostname
  const cfResult = await createCustomHostname(env, opts.hostname);

  // Store in DB
  await supabaseQuery(db, 'hostnames', {
    method: 'POST',
    body: {
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    },
  });

  return {
    hostname: opts.hostname,
    status: cfResult.status === 'active' ? 'active' : 'pending',
  };
}

/**
 * Get all hostnames for a site.
 */
export async function getSiteHostnames(
  db: SupabaseClient,
  siteId: string,
): Promise<
  Array<{
    id: string;
    hostname: string;
    type: string;
    status: string;
    ssl_status: string;
  }>
> {
  const result = await supabaseQuery<
    Array<{
      id: string;
      hostname: string;
      type: string;
      status: string;
      ssl_status: string;
    }>
  >(db, 'hostnames', {
    query: `site_id=eq.${siteId}&deleted_at=is.null&select=id,hostname,type,status,ssl_status&order=created_at.asc`,
  });

  return result.data ?? [];
}

/**
 * Get hostname record by domain name.
 */
export async function getHostnameByDomain(
  db: SupabaseClient,
  hostname: string,
): Promise<{
  id: string;
  site_id: string;
  org_id: string;
  type: string;
  status: string;
} | null> {
  const result = await supabaseQuery<
    Array<{
      id: string;
      site_id: string;
      org_id: string;
      type: string;
      status: string;
    }>
  >(db, 'hostnames', {
    query: `hostname=eq.${encodeURIComponent(hostname)}&deleted_at=is.null&select=id,site_id,org_id,type,status`,
  });

  return result.data?.[0] ?? null;
}

/**
 * Verify pending hostnames (scheduled cron job).
 */
export async function verifyPendingHostnames(
  db: SupabaseClient,
  env: Env,
): Promise<{ verified: number; failed: number }> {
  const pending = await supabaseQuery<
    Array<{ id: string; cf_custom_hostname_id: string; hostname: string }>
  >(db, 'hostnames', {
    query: `status=eq.pending&deleted_at=is.null&select=id,cf_custom_hostname_id,hostname`,
  });

  let verified = 0;
  let failed = 0;

  for (const record of pending.data ?? []) {
    if (!record.cf_custom_hostname_id) continue;

    try {
      const status = await checkHostnameStatus(env, record.cf_custom_hostname_id);

      const newStatus: HostnameState =
        status.status === 'active'
          ? 'active'
          : status.verification_errors.length > 0
            ? 'verification_failed'
            : 'pending';

      await supabaseQuery(db, 'hostnames', {
        method: 'PATCH',
        query: `id=eq.${record.id}`,
        body: {
          status: newStatus,
          ssl_status: status.ssl_status,
          verification_errors:
            status.verification_errors.length > 0 ? status.verification_errors : null,
          last_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });

      if (newStatus === 'active') verified++;
      if (newStatus === 'verification_failed') failed++;
    } catch {
      failed++;
    }
  }

  return { verified, failed };
}
