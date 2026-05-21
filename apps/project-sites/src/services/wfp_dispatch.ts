/**
 * Cloudflare Workers for Platforms dispatch helper.
 *
 * For user-defined endpoints with kind='worker': we upload the user's
 * JS/TS/Python code as a user-Worker into our dispatch namespace via the
 * Cloudflare REST API, then dispatch requests via the USER_DISPATCH
 * binding at runtime.
 *
 * If WFP isn't provisioned (no USER_DISPATCH binding or no CF_API_TOKEN),
 * code-kind endpoints return 503 with a clear "not configured" message
 * and the customer is steered toward the AI-prompt kind.
 *
 * Pricing: WFP Paid is $25/mo + per-request fees that pass through.
 * Docs: https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/
 */
import type { Env } from '../types/env.js';

export type Language = 'javascript' | 'typescript' | 'python' | 'rust-wasm';

export function isWfpConfigured(env: Env): boolean {
  return !!env.USER_DISPATCH && !!env.WFP_NAMESPACE_NAME && !!env.CF_ACCOUNT_ID && !!env.CF_API_TOKEN;
}

export const SUPPORTED_LANGUAGES: { id: Language; label: string; helper: string }[] = [
  { id: 'javascript', label: 'JavaScript', helper: 'export default { fetch(req, env, ctx) { return new Response("hi") } }' },
  { id: 'typescript', label: 'TypeScript', helper: 'export default { async fetch(req: Request): Promise<Response> { return new Response("hi") } }' },
  { id: 'python', label: 'Python (Pyodide)', helper: 'from workers import Response\n\nasync def on_fetch(request, env):\n    return Response("hi")' },
  { id: 'rust-wasm', label: 'Rust → Wasm', helper: '// Build a workers-rs project then upload the .wasm; see https://github.com/cloudflare/workers-rs' },
];

/**
 * Upload (or overwrite) a user-Worker into our dispatch namespace.
 * Returns the script name we picked (deterministic from site + endpoint).
 */
export async function uploadUserWorker(
  env: Env,
  opts: {
    siteId: string;
    endpointSlug: string;
    language: Language;
    code: string;
  },
): Promise<{ ok: true; scriptName: string } | { ok: false; error: string; status?: number }> {
  if (!isWfpConfigured(env)) {
    return { ok: false, error: 'Workers for Platforms not configured on this account' };
  }
  const scriptName = `ai-${opts.siteId.slice(0, 8)}-${opts.endpointSlug}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const namespace = env.WFP_NAMESPACE_NAME!;
  const accountId = env.CF_ACCOUNT_ID!;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/dispatch/namespaces/${namespace}/scripts/${scriptName}`;

  // Build multipart body: metadata.json + the script module.
  const form = new FormData();
  const isPython = opts.language === 'python';
  const isWasm = opts.language === 'rust-wasm';
  const mainModule = isPython ? 'worker.py' : 'worker.mjs';
  const metadata = {
    main_module: mainModule,
    ...(isPython ? { compatibility_flags: ['python_workers'] } : {}),
    compatibility_date: '2026-05-01',
    ...(isWasm ? { bindings: [{ type: 'wasm_module', name: 'WASM', part: 'wasm' }] } : {}),
  };
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append(
    mainModule,
    new Blob([opts.code], {
      type: isPython
        ? 'text/x-python'
        : 'application/javascript+module',
    }),
    mainModule,
  );

  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: body.slice(0, 800), status: res.status };
  }
  return { ok: true, scriptName };
}

export async function deleteUserWorker(env: Env, scriptName: string): Promise<void> {
  if (!isWfpConfigured(env)) return;
  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/dispatch/namespaces/${env.WFP_NAMESPACE_NAME}/scripts/${scriptName}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } },
  ).catch(() => {});
}

/** Dispatch a request to a user-Worker via the namespace binding. */
export async function dispatchToUserWorker(
  env: Env,
  scriptName: string,
  request: Request,
): Promise<Response> {
  if (!env.USER_DISPATCH) {
    return new Response('USER_DISPATCH binding missing', { status: 503 });
  }
  const stub = env.USER_DISPATCH.get(scriptName);
  return stub.fetch(request);
}
