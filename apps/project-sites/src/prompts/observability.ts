/**
 * Observability for LLM calls.
 *
 * Logs structured JSON for every call:
 *   prompt_id, prompt_version, model, params,
 *   input_hash (SHA-256), latency, token counts, outcome, retry count
 */

import type { LlmCallLog, PromptSpec } from './types.js';

/**
 * SHA-256 hash of a string using the Web Crypto API.
 * Works in both Cloudflare Workers and Node 18+.
 */
export async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute a deterministic hash of normalized inputs.
 * Used for reproducing LLM calls and correlating results.
 */
export async function hashInputs(inputs: Record<string, unknown>): Promise<string> {
  const sorted = JSON.stringify(inputs, Object.keys(inputs).sort());
  return sha256(sorted);
}

/**
 * Build a structured LLM call log entry.
 */
export function buildCallLog(params: {
  spec: PromptSpec;
  model: string;
  inputHash: string;
  latencyMs: number;
  tokenCount: number;
  cost?: number;
  outcome: 'success' | 'error';
  retryCount: number;
  errorMessage?: string;
}): LlmCallLog {
  return {
    promptId: params.spec.id,
    promptVersion: params.spec.version,
    promptVariant: params.spec.variant,
    model: params.model,
    params: { ...params.spec.params },
    inputHash: params.inputHash,
    latencyMs: params.latencyMs,
    tokenCount: params.tokenCount,
    cost: params.cost,
    outcome: params.outcome,
    retryCount: params.retryCount,
    errorMessage: params.errorMessage,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Emit a structured JSON log for an LLM call.
 * This is the single observability sink — all LLM calls go through here.
 */
export function emitCallLog(log: LlmCallLog): void {
  // Use console.warn for structured JSON logs (console.log blocked by lint)
  console.warn(
    JSON.stringify({
      level: 'info',
      service: 'ai_workflow',
      event: 'llm_call',
      ...log,
    }),
  );
}

/**
 * Estimate token cost based on model and token count.
 * Very rough estimates — update as pricing changes.
 */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing: Record<string, { input: number; output: number }> = {
    '@cf/meta/llama-3.1-8b-instruct': { input: 0, output: 0 }, // free on Workers AI
    '@cf/meta/llama-3.1-70b-instruct': { input: 0, output: 0 },
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  };

  const price = pricing[model] ?? { input: 0, output: 0 };
  return (inputTokens / 1000) * price.input + (outputTokens / 1000) * price.output;
}

/**
 * Wrap an async LLM call with full observability.
 * Handles timing, hashing, logging, and retry counting.
 */
export async function withObservability<T>(
  spec: PromptSpec,
  model: string,
  inputs: Record<string, unknown>,
  retryCount: number,
  callFn: () => Promise<{ output: T; tokenCount: number }>,
): Promise<{ result: T; log: LlmCallLog }> {
  const inputHash = await hashInputs(inputs);
  const startTime = Date.now();

  try {
    const { output, tokenCount } = await callFn();
    const latencyMs = Date.now() - startTime;

    const log = buildCallLog({
      spec,
      model,
      inputHash,
      latencyMs,
      tokenCount,
      outcome: 'success',
      retryCount,
    });

    emitCallLog(log);

    return { result: output, log };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : 'unknown error';

    const log = buildCallLog({
      spec,
      model,
      inputHash,
      latencyMs,
      tokenCount: 0,
      outcome: 'error',
      retryCount,
      errorMessage,
    });

    emitCallLog(log);

    throw err;
  }
}
