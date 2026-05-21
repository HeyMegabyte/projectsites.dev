import type { Env } from '../types/env.js';

export interface AiLogInput {
  orgId: string;
  siteId: string;
  submissionId?: string | null;
  traceKind: 'form' | 'chat' | 'endpoint' | 'search';
  endpointSlug?: string;
  promptTemplate?: string;
  input?: unknown;
  outputText?: string;
  outputJson?: unknown;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  toolStatus?: 'ok' | 'error' | 'skipped';
  model?: string;
  status: 'ok' | 'error' | 'rate_limited';
  errorMessage?: string;
  latencyMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  creditsDebited?: number;
}

export async function writeAiLog(env: Env, log: AiLogInput): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO ai_form_logs (
       id, org_id, site_id, submission_id, trace_kind, endpoint_slug,
       prompt_template, input_json, output_text, output_json,
       tool_name, tool_args_json, tool_result_json, tool_status,
       model, status, error_message, latency_ms,
       tokens_input, tokens_output, credits_debited
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      log.orgId,
      log.siteId,
      log.submissionId ?? null,
      log.traceKind,
      log.endpointSlug ?? null,
      log.promptTemplate ?? null,
      JSON.stringify(log.input ?? null),
      log.outputText ?? null,
      log.outputJson ? JSON.stringify(log.outputJson) : null,
      log.toolName ?? null,
      log.toolArgs ? JSON.stringify(log.toolArgs) : null,
      log.toolResult ? JSON.stringify(log.toolResult) : null,
      log.toolStatus ?? null,
      log.model ?? null,
      log.status,
      log.errorMessage ?? null,
      log.latencyMs ?? null,
      log.tokensInput ?? null,
      log.tokensOutput ?? null,
      log.creditsDebited ?? null,
    )
    .run();
  return id;
}

export const estTokens = (s: string): number => Math.ceil(s.length / 4);
