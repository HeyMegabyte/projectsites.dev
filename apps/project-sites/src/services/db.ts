import type { Env } from '../types/env.js';

/**
 * Supabase client factory.
 * Returns typed client instances for service-role (server) and anon (public) operations.
 *
 * Note: In production this uses the Supabase JS client.
 * For Workers, we use fetch-based REST API calls to Supabase.
 */

export interface SupabaseClient {
  url: string;
  headers: Record<string, string>;
  fetch: typeof fetch;
}

/**
 * Create a server-side Supabase client using the service role key.
 * NEVER expose this to the browser.
 */
export function createServiceClient(env: Env): SupabaseClient {
  return {
    url: env.SUPABASE_URL,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    fetch: globalThis.fetch.bind(globalThis),
  };
}

/**
 * Create a public Supabase client using the anon key.
 */
export function createAnonClient(env: Env): SupabaseClient {
  return {
    url: env.SUPABASE_URL,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    fetch: globalThis.fetch.bind(globalThis),
  };
}

/**
 * Execute a Supabase REST query.
 * Thin wrapper around fetch for PostgREST endpoints.
 */
export async function supabaseQuery<T>(
  client: SupabaseClient,
  table: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    query?: string;
    body?: unknown;
    headers?: Record<string, string>;
    single?: boolean;
  } = {},
): Promise<{ data: T | null; error: string | null; status: number }> {
  const { method = 'GET', query = '', body, headers = {}, single = false } = options;
  const url = `${client.url}/rest/v1/${table}${query ? `?${query}` : ''}`;

  const mergedHeaders = {
    ...client.headers,
    ...headers,
    ...(single ? { Accept: 'application/vnd.pgrst.object+json' } : {}),
  };

  try {
    const response = await client.fetch(url, {
      method,
      headers: mergedHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { data: null, error: errorBody, status: response.status };
    }

    if (response.status === 204) {
      return { data: null, error: null, status: 204 };
    }

    const data = (await response.json()) as T;
    return { data, error: null, status: response.status };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Unknown fetch error',
      status: 500,
    };
  }
}
