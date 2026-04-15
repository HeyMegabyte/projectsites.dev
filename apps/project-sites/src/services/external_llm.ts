/**
 * @module services/external_llm
 * @description Unified external LLM client for OpenAI and Anthropic APIs.
 *
 * Calls GPT-4o / Claude directly via fetch (no SDK needed in Workers).
 * Supports structured JSON output, model fallback, and A/B routing.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';

export interface ExternalLLMOptions {
  /** System prompt */
  system: string;
  /** User prompt */
  user: string;
  /** Temperature (0-1) */
  temperature?: number;
  /** Max tokens for response */
  maxTokens?: number;
  /** Request JSON output */
  jsonMode?: boolean;
  /** JSON schema for OpenAI structured output (response_format) */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** Preferred provider: 'openai' | 'anthropic' | 'auto' (default: 'auto' uses A/B split) */
  provider?: 'openai' | 'anthropic' | 'auto';
  /** Specific model override (e.g. 'gpt-4o-mini', 'claude-sonnet-4-20250514') */
  model?: string;
}

export interface ExternalLLMResult {
  output: string;
  model_used: string;
  provider: 'openai' | 'anthropic';
  latency_ms: number;
  token_count: number;
  cost_estimate: number;
}

/** Cost per 1M tokens (input/output) for common models */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
};

/**
 * Choose provider based on A/B split or explicit preference.
 */
function chooseProvider(env: Env, preference?: 'openai' | 'anthropic' | 'auto'): 'openai' | 'anthropic' {
  if (preference === 'openai') return 'openai';
  if (preference === 'anthropic') return 'anthropic';

  // A/B split: random routing
  const split = parseFloat(env.AB_MODEL_SPLIT as string || '0.5');
  const hasOpenAI = !!(env.OPENAI_API_KEY);
  const hasAnthropic = !!(env.ANTHROPIC_API_KEY);

  if (hasOpenAI && !hasAnthropic) return 'openai';
  if (hasAnthropic && !hasOpenAI) return 'anthropic';
  if (!hasOpenAI && !hasAnthropic) return 'openai'; // will fail, but with clear error

  return Math.random() < split ? 'openai' : 'anthropic';
}

/**
 * Call OpenAI Chat Completions API.
 */
async function callOpenAI(
  apiKey: string,
  model: string,
  options: ExternalLLMOptions,
): Promise<{ text: string; tokens: number }> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
    temperature: options.temperature ?? 0.3,
    max_completion_tokens: options.maxTokens ?? 8192,
  };

  if (options.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: options.jsonSchema.name,
        schema: options.jsonSchema.schema,
        strict: true,
      },
    };
  } else if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 240_000);

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens: number };
  };

  return {
    text: data.choices[0]?.message?.content ?? '',
    tokens: data.usage?.total_tokens ?? 0,
  };
}

/**
 * Call Anthropic Messages API.
 */
async function callAnthropic(
  apiKey: string,
  model: string,
  options: ExternalLLMOptions,
): Promise<{ text: string; tokens: number }> {
  const body: Record<string, unknown> = {
    model,
    system: options.system,
    messages: [
      { role: 'user', content: options.user },
    ],
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 8192,
  };

  // 8-minute timeout for Claude Opus large generation calls (32K tokens can take 2-4 min)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 480_000);

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');

  const tokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

  return { text, tokens };
}

/**
 * Estimate cost in USD based on model and token count.
 */
function estimateCost(model: string, tokens: number): number {
  const key = Object.keys(MODEL_COSTS).find((k) => model.includes(k));
  if (!key) return 0;
  const costs = MODEL_COSTS[key];
  // Rough split: assume 30% input, 70% output for generation tasks
  const inputTokens = Math.round(tokens * 0.3);
  const outputTokens = tokens - inputTokens;
  return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
}

/**
 * Call an external LLM (OpenAI or Anthropic) with automatic fallback.
 *
 * @param env - Worker environment with API keys
 * @param options - Prompt configuration
 * @returns LLM response with metadata
 *
 * @example
 * ```ts
 * const result = await callExternalLLM(env, {
 *   system: 'You are a web designer.',
 *   user: 'Generate a site plan for a bakery.',
 *   jsonMode: true,
 *   maxTokens: 4000,
 * });
 * ```
 */
export async function callExternalLLM(
  env: Env,
  options: ExternalLLMOptions,
): Promise<ExternalLLMResult> {
  const primary = chooseProvider(env, options.provider);
  const fallback = primary === 'openai' ? 'anthropic' : 'openai';

  const defaultModels: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
  };

  const providers = [primary, fallback];

  for (const provider of providers) {
    const apiKey = provider === 'openai'
      ? env.OPENAI_API_KEY
      : env.ANTHROPIC_API_KEY as string | undefined;

    if (!apiKey) continue;

    const model = options.model ?? defaultModels[provider];
    const start = Date.now();

    try {
      const result = provider === 'openai'
        ? await callOpenAI(apiKey, model, options)
        : await callAnthropic(apiKey, model, options);

      const latency = Date.now() - start;

      console.warn(JSON.stringify({
        level: 'info',
        service: 'external_llm',
        provider,
        model,
        latency_ms: latency,
        tokens: result.tokens,
        output_length: result.text.length,
      }));

      return {
        output: result.text,
        model_used: model,
        provider: provider as 'openai' | 'anthropic',
        latency_ms: latency,
        token_count: result.tokens,
        cost_estimate: estimateCost(model, result.tokens),
      };
    } catch (err) {
      console.warn(JSON.stringify({
        level: 'warn',
        service: 'external_llm',
        provider,
        model,
        error: err instanceof Error ? err.message : String(err),
        message: `${provider} failed, trying fallback`,
      }));

      // If this is the fallback too, rethrow
      if (provider === fallback) throw err;
    }
  }

  throw new Error('No LLM provider available — set OPENAI_API_KEY or ANTHROPIC_API_KEY');
}
