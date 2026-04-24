/**
 * @module services/external_llm
 * @description Unified external LLM client for OpenAI and Anthropic APIs.
 *
 * Calls GPT-4o / Claude directly via fetch (no SDK needed in Workers).
 * GPT-4o is the primary provider for all research/vision calls.
 * Anthropic Claude is the fallback when GPT-4o fails.
 * Includes retry with exponential backoff + jitter and circuit breaker.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { withRetry, classifyError, type ErrorCategory } from './retry.js';

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
  /** Preferred provider: 'openai' | 'anthropic' | 'auto' (default: 'auto' uses GPT-4o primary) */
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

// ─── Circuit Breaker State ──────────────────────────────────────────────────

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  openUntil: number;
}

/** Circuit breaker: 5 failures in 60s → skip provider for 30s */
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_FAILURE_WINDOW_MS = 60_000;
const CIRCUIT_OPEN_DURATION_MS = 30_000;

const circuitState: Record<string, CircuitBreakerState> = {
  openai: { failures: 0, lastFailureTime: 0, openUntil: 0 },
  anthropic: { failures: 0, lastFailureTime: 0, openUntil: 0 },
};

/**
 * Check if a provider's circuit is open (should be skipped).
 */
function isCircuitOpen(provider: 'openai' | 'anthropic'): boolean {
  const state = circuitState[provider];
  if (Date.now() < state.openUntil) {
    return true;
  }
  // Reset if the open period has passed
  if (state.openUntil > 0 && Date.now() >= state.openUntil) {
    state.failures = 0;
    state.openUntil = 0;
  }
  return false;
}

/**
 * Record a failure for the circuit breaker.
 */
function recordFailure(provider: 'openai' | 'anthropic'): void {
  const state = circuitState[provider];
  const now = Date.now();

  // Reset counter if last failure was outside the window
  if (now - state.lastFailureTime > CIRCUIT_FAILURE_WINDOW_MS) {
    state.failures = 0;
  }

  state.failures++;
  state.lastFailureTime = now;

  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = now + CIRCUIT_OPEN_DURATION_MS;
    console.warn(JSON.stringify({
      level: 'warn',
      service: 'external_llm',
      event: 'circuit_open',
      provider,
      open_until: new Date(state.openUntil).toISOString(),
      message: `Circuit breaker opened for ${provider} after ${state.failures} failures`,
    }));
  }
}

/**
 * Record a success — resets the failure counter.
 */
function recordSuccess(provider: 'openai' | 'anthropic'): void {
  const state = circuitState[provider];
  state.failures = 0;
  state.openUntil = 0;
}

// ─── Provider Selection ─────────────────────────────────────────────────────

/**
 * Choose provider. GPT-4o is ALWAYS primary for research/vision calls.
 * Anthropic is the fallback. Explicit preference overrides this.
 *
 * @remarks
 * The old A/B split randomness has been removed. OpenAI is deterministically
 * primary because GPT-4o provides better vision and research results.
 */
function chooseProvider(env: Env, preference?: 'openai' | 'anthropic' | 'auto'): 'openai' | 'anthropic' {
  if (preference === 'openai') return 'openai';
  if (preference === 'anthropic') return 'anthropic';

  // GPT-4o is always primary (no more A/B split)
  const hasOpenAI = !!(env.OPENAI_API_KEY);
  const hasAnthropic = !!(env.ANTHROPIC_API_KEY);

  if (hasOpenAI) return 'openai';
  if (hasAnthropic) return 'anthropic';

  // Neither available — return openai so the error is clear
  return 'openai';
}

// ─── Provider Calls ─────────────────────────────────────────────────────────

/**
 * Call OpenAI Chat Completions API.
 */
async function callOpenAI(
  apiKey: string,
  model: string,
  options: ExternalLLMOptions,
  messages?: Array<Record<string, unknown>>,
): Promise<{ text: string; tokens: number }> {
  const body: Record<string, unknown> = {
    model,
    messages: messages ?? [
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
  messages?: Array<Record<string, unknown>>,
): Promise<{ text: string; tokens: number }> {
  const body: Record<string, unknown> = {
    model,
    system: options.system,
    messages: messages ?? [
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

// ─── Cost Estimation ────────────────────────────────────────────────────────

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

// ─── Main LLM Call ──────────────────────────────────────────────────────────

/**
 * Call an external LLM (OpenAI or Anthropic) with automatic fallback.
 *
 * Uses GPT-4o as the primary provider with retry + exponential backoff.
 * Falls back to Anthropic Claude if GPT-4o fails after retries.
 * Circuit breaker skips a provider if it fails 5 times within 60 seconds.
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
  const fallback: 'openai' | 'anthropic' = primary === 'openai' ? 'anthropic' : 'openai';

  const defaultModels: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
  };

  const providers: Array<'openai' | 'anthropic'> = [primary, fallback];

  for (const provider of providers) {
    // Circuit breaker: skip provider if circuit is open
    if (isCircuitOpen(provider)) {
      console.warn(JSON.stringify({
        level: 'info',
        service: 'external_llm',
        event: 'circuit_open_skip',
        provider,
        message: `Skipping ${provider} — circuit breaker is open`,
      }));
      continue;
    }

    const apiKey = provider === 'openai'
      ? env.OPENAI_API_KEY
      : env.ANTHROPIC_API_KEY as string | undefined;

    if (!apiKey) continue;

    const model = options.model ?? defaultModels[provider];
    const start = Date.now();

    try {
      const result = await withRetry(
        () => provider === 'openai'
          ? callOpenAI(apiKey, model, options)
          : callAnthropic(apiKey, model, options),
        {
          maxRetries: 3,
          baseDelayMs: 1000,
          onRetry: (attempt, err, delayMs) => {
            console.warn(JSON.stringify({
              level: 'warn',
              service: 'external_llm',
              event: 'retry',
              provider,
              model,
              attempt,
              delay_ms: delayMs,
              error_category: classifyError(err),
              error: err instanceof Error ? err.message : String(err),
            }));
          },
        },
      );

      const latency = Date.now() - start;
      recordSuccess(provider);

      console.warn(JSON.stringify({
        level: 'info',
        service: 'external_llm',
        event: 'call_success',
        provider,
        model,
        latency_ms: latency,
        tokens: result.tokens,
        output_length: result.text.length,
      }));

      return {
        output: result.text,
        model_used: model,
        provider,
        latency_ms: latency,
        token_count: result.tokens,
        cost_estimate: estimateCost(model, result.tokens),
      };
    } catch (err) {
      const latency = Date.now() - start;
      const errorCategory = classifyError(err);
      recordFailure(provider);

      console.warn(JSON.stringify({
        level: 'warn',
        service: 'external_llm',
        event: 'provider_exhausted',
        provider,
        model,
        latency_ms: latency,
        error_category: errorCategory,
        error: err instanceof Error ? err.message : String(err),
        message: provider === fallback
          ? `Both providers failed`
          : `${provider} failed after retries, trying ${fallback}`,
      }));

      // If this is the fallback too, rethrow
      if (provider === fallback) throw err;
    }
  }

  throw new Error('No LLM provider available — set OPENAI_API_KEY or ANTHROPIC_API_KEY');
}

// ─── Vision Call ────────────────────────────────────────────────────────────

/**
 * Call an external LLM with vision capability (image analysis).
 *
 * Uses GPT-4o vision as primary, falls back to Anthropic Claude vision.
 * Accepts either an image URL or base64-encoded image data.
 *
 * @param env - Worker environment with API keys
 * @param options - Prompt configuration with optional image data
 * @returns LLM response with metadata
 *
 * @example
 * ```ts
 * const result = await callExternalLLMWithVision(env, {
 *   system: 'You are a visual brand analyst.',
 *   user: 'Describe the brand colors and logo in this screenshot.',
 *   imageUrl: 'https://example.com/screenshot.png',
 *   maxTokens: 2000,
 * });
 * ```
 */
export async function callExternalLLMWithVision(
  env: Env,
  options: ExternalLLMOptions & { imageUrl?: string; imageBase64?: string },
): Promise<ExternalLLMResult> {
  if (!options.imageUrl && !options.imageBase64) {
    // No image provided, fall back to standard text call
    return callExternalLLM(env, options);
  }

  const primary = chooseProvider(env, options.provider);
  const fallback: 'openai' | 'anthropic' = primary === 'openai' ? 'anthropic' : 'openai';

  const defaultModels: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
  };

  const providers: Array<'openai' | 'anthropic'> = [primary, fallback];

  for (const provider of providers) {
    if (isCircuitOpen(provider)) {
      console.warn(JSON.stringify({
        level: 'info',
        service: 'external_llm',
        event: 'circuit_open_skip_vision',
        provider,
        message: `Skipping ${provider} vision — circuit breaker is open`,
      }));
      continue;
    }

    const apiKey = provider === 'openai'
      ? env.OPENAI_API_KEY
      : env.ANTHROPIC_API_KEY as string | undefined;

    if (!apiKey) continue;

    const model = options.model ?? defaultModels[provider];
    const start = Date.now();

    try {
      const result = await withRetry(
        () => {
          if (provider === 'openai') {
            return callOpenAIWithVision(apiKey, model, options);
          }
          return callAnthropicWithVision(apiKey, model, options);
        },
        {
          maxRetries: 3,
          baseDelayMs: 1000,
          onRetry: (attempt, err, delayMs) => {
            console.warn(JSON.stringify({
              level: 'warn',
              service: 'external_llm',
              event: 'retry_vision',
              provider,
              model,
              attempt,
              delay_ms: delayMs,
              error_category: classifyError(err),
              error: err instanceof Error ? err.message : String(err),
            }));
          },
        },
      );

      const latency = Date.now() - start;
      recordSuccess(provider);

      console.warn(JSON.stringify({
        level: 'info',
        service: 'external_llm',
        event: 'vision_call_success',
        provider,
        model,
        latency_ms: latency,
        tokens: result.tokens,
        output_length: result.text.length,
      }));

      return {
        output: result.text,
        model_used: model,
        provider,
        latency_ms: latency,
        token_count: result.tokens,
        cost_estimate: estimateCost(model, result.tokens),
      };
    } catch (err) {
      const latency = Date.now() - start;
      const errorCategory = classifyError(err);
      recordFailure(provider);

      console.warn(JSON.stringify({
        level: 'warn',
        service: 'external_llm',
        event: 'vision_provider_exhausted',
        provider,
        model,
        latency_ms: latency,
        error_category: errorCategory,
        error: err instanceof Error ? err.message : String(err),
        message: provider === fallback
          ? `Both vision providers failed`
          : `${provider} vision failed after retries, trying ${fallback}`,
      }));

      if (provider === fallback) throw err;
    }
  }

  throw new Error('No LLM vision provider available — set OPENAI_API_KEY or ANTHROPIC_API_KEY');
}

// ─── Vision Provider Implementations ────────────────────────────────────────

/**
 * Call OpenAI with vision (image_url in messages).
 */
async function callOpenAIWithVision(
  apiKey: string,
  model: string,
  options: ExternalLLMOptions & { imageUrl?: string; imageBase64?: string },
): Promise<{ text: string; tokens: number }> {
  const imageContent: Record<string, unknown> = options.imageUrl
    ? { type: 'image_url', image_url: { url: options.imageUrl, detail: 'high' } }
    : { type: 'image_url', image_url: { url: `data:image/png;base64,${options.imageBase64}`, detail: 'high' } };

  const messages = [
    { role: 'system', content: options.system },
    {
      role: 'user',
      content: [
        { type: 'text', text: options.user },
        imageContent,
      ],
    },
  ];

  return callOpenAI(apiKey, model, options, messages);
}

/**
 * Call Anthropic with vision (base64 image in messages).
 */
async function callAnthropicWithVision(
  apiKey: string,
  model: string,
  options: ExternalLLMOptions & { imageUrl?: string; imageBase64?: string },
): Promise<{ text: string; tokens: number }> {
  // Anthropic requires base64 for images; if we only have a URL, fetch it
  let base64Data = options.imageBase64;
  let mediaType = 'image/png';

  if (!base64Data && options.imageUrl) {
    const imgRes = await fetch(options.imageUrl);
    if (!imgRes.ok) {
      throw new Error(`Failed to fetch image for Anthropic vision: ${imgRes.status}`);
    }
    const contentType = imgRes.headers.get('content-type') ?? 'image/png';
    mediaType = contentType.split(';')[0].trim();
    const buffer = await imgRes.arrayBuffer();
    // Convert ArrayBuffer to base64
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64Data = btoa(binary);
  }

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Data,
          },
        },
        { type: 'text', text: options.user },
      ],
    },
  ];

  return callAnthropic(apiKey, model, options, messages);
}
