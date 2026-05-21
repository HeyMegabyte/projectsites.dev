/**
 * Public AI endpoints router.
 *
 *   GET|POST https://projectsites.dev/api/ai/:siteSlug/:endpointSlug
 *
 * Each endpoint is either:
 *   • kind='prompt'  → we run the saved prompt + request payload through
 *                      Workers AI (Llama 3.1) with the connected MCP tool
 *                      list available; the LLM picks a tool, we execute it,
 *                      and the JSON envelope is returned to the caller.
 *   • kind='worker'  → we dispatch the request to a user-Worker uploaded
 *                      into the Workers for Platforms namespace.
 *
 * Every call writes one `ai_form_logs` row and debits 1 credit.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;
import { writeAiLog, estTokens } from '../services/ai_logger.js';
import { debitCredits, getBalance, maybeFireAlerts } from '../services/credits.js';
import { loadAvailableTools, executeTool } from '../services/mcp_client.js';
import { dispatchToUserWorker } from '../services/wfp_dispatch.js';

export const aiEndpointsPublic = new Hono<{ Bindings: Env; Variables: Variables }>();

interface EndpointRow {
  id: string;
  org_id: string;
  site_id: string;
  endpoint_slug: string;
  kind: 'prompt' | 'worker';
  method: string;
  prompt_template: string | null;
  worker_language: string | null;
  wfp_script_name: string | null;
  enabled: number;
}

async function loadEndpoint(env: Env, siteSlug: string, endpointSlug: string): Promise<EndpointRow | null> {
  const row = await env.DB.prepare(
    `SELECT e.id, e.org_id, e.site_id, e.endpoint_slug, e.kind, e.method,
            e.prompt_template, e.worker_language, e.wfp_script_name, e.enabled
     FROM ai_endpoints e JOIN sites s ON s.id = e.site_id
     WHERE s.slug = ? AND e.endpoint_slug = ? AND e.enabled = 1 AND s.deleted_at IS NULL`,
  )
    .bind(siteSlug, endpointSlug)
    .first<EndpointRow>();
  return row;
}

async function handle(c: Ctx): Promise<Response> {
  const siteSlug = c.req.param('siteSlug') ?? '';
  const endpointSlug = c.req.param('endpointSlug') ?? '';
  const ep = await loadEndpoint(c.env, siteSlug, endpointSlug);
  if (!ep) return c.json({ error: { message: 'endpoint not found' } }, 404);
  if (ep.method !== 'BOTH' && ep.method !== c.req.method) {
    return c.json({ error: { message: `method ${c.req.method} not allowed (expected ${ep.method})` } }, 405);
  }

  // Credit gate — fail closed if balance ≤ 0.
  const balance = await getBalance(c.env, ep.org_id);
  if (balance <= 0) return c.json({ error: { message: 'AI credits exhausted' } }, 402);

  const body = c.req.method === 'POST' ? await c.req.json().catch(() => ({})) : {};
  const query: Record<string, string> = {};
  const qs = c.req.url.split('?')[1];
  if (qs) {
    for (const part of qs.split('&')) {
      const [k, v] = part.split('=');
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
  }

  if (ep.kind === 'worker') {
    if (!ep.wfp_script_name) return c.json({ error: { message: 'WFP script not deployed' } }, 503);
    const started = Date.now();
    const upstream = await dispatchToUserWorker(c.env, ep.wfp_script_name, c.req.raw);
    const cloned = upstream.clone();
    const text = await cloned.text();
    await writeAiLog(c.env, {
      orgId: ep.org_id,
      siteId: ep.site_id,
      traceKind: 'endpoint',
      endpointSlug,
      model: `wfp:${ep.worker_language}`,
      status: upstream.ok ? 'ok' : 'error',
      latencyMs: Date.now() - started,
      input: { method: c.req.method, query, body },
      outputText: text.slice(0, 4096),
      creditsDebited: 1,
    });
    const newBal = await debitCredits(c.env, { orgId: ep.org_id, siteId: ep.site_id, amount: 1, reason: 'endpoint' });
    c.executionCtx.waitUntil(maybeFireAlerts(c.env, ep.org_id, newBal));
    return upstream;
  }

  // kind = 'prompt': run AI with available tools.
  const tools = await loadAvailableTools(c.env, ep.site_id);
  const systemPrompt =
    (ep.prompt_template ?? '').trim() ||
    'You are an AI endpoint. Read the request payload and respond with helpful JSON. If a tool fits, return { "tool": "<name>", "args": {…} } — otherwise respond with { "response": "…" }.';
  const toolBlock = tools.length
    ? `\n\nAvailable tools (you MAY pick one):\n${JSON.stringify(tools, null, 2)}`
    : '';
  const prompt = `${systemPrompt}${toolBlock}\n\nReturn JSON only. No markdown fences.`;
  const userMsg = JSON.stringify({ method: c.req.method, query, body });
  const model = '@cf/meta/llama-3.1-8b-instruct';
  const started = Date.now();
  let outText = '';
  let parsed: unknown = null;
  let toolResult: { ok: boolean; data?: unknown; error?: string } | null = null;
  let status: 'ok' | 'error' = 'ok';
  let errorMessage: string | undefined;
  try {
    const ai = (await c.env.AI.run(model as Parameters<typeof c.env.AI.run>[0], {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userMsg },
      ],
      max_tokens: 350,
    })) as { response?: string };
    outText = (ai.response ?? '').trim();
    try {
      parsed = JSON.parse(outText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, ''));
    } catch {
      /* non-JSON output */
    }
    if (parsed && typeof parsed === 'object' && 'tool' in (parsed as Record<string, unknown>)) {
      const call = parsed as { tool: string; args?: Record<string, unknown> };
      toolResult = await executeTool(c.env, ep.site_id, {
        name: call.tool,
        arguments: call.args ?? {},
      });
      if (!toolResult.ok) {
        status = 'error';
        errorMessage = toolResult.error;
      }
    }
  } catch (err) {
    status = 'error';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const logId = await writeAiLog(c.env, {
    orgId: ep.org_id,
    siteId: ep.site_id,
    traceKind: 'endpoint',
    endpointSlug,
    promptTemplate: prompt,
    input: { method: c.req.method, query, body },
    outputText: outText,
    outputJson: parsed,
    toolName: parsed && typeof parsed === 'object' && 'tool' in parsed ? (parsed as { tool: string }).tool : undefined,
    toolArgs: parsed && typeof parsed === 'object' && 'args' in parsed ? (parsed as { args: unknown }).args : undefined,
    toolResult: toolResult ?? undefined,
    toolStatus: toolResult ? (toolResult.ok ? 'ok' : 'error') : undefined,
    model,
    status,
    errorMessage,
    latencyMs: Date.now() - started,
    tokensInput: estTokens(prompt + userMsg),
    tokensOutput: estTokens(outText),
    creditsDebited: 1,
  });
  const newBal = await debitCredits(c.env, {
    orgId: ep.org_id,
    siteId: ep.site_id,
    amount: 1,
    reason: 'endpoint',
    aiLogId: logId,
  });
  c.executionCtx.waitUntil(maybeFireAlerts(c.env, ep.org_id, newBal));

  return c.json({
    ok: status === 'ok',
    output: parsed ?? outText,
    tool_result: toolResult,
    error: errorMessage,
    credits_remaining: newBal,
    trace_id: logId,
  }, status === 'ok' ? 200 : 502);
}

aiEndpointsPublic.get('/api/ai/:siteSlug/:endpointSlug', handle);
aiEndpointsPublic.post('/api/ai/:siteSlug/:endpointSlug', handle);
