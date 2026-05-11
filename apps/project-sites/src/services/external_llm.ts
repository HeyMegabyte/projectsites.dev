/**
 * @module services/external_llm
 *
 * @description
 * Unified external LLM client for OpenAI and Anthropic Messages APIs. Calls
 * GPT-4o / Claude directly via `fetch` — no SDK needed (and no SDK would
 * cleanly run under the Workers runtime anyway, which is why the entire
 * file is hand-rolled HTTP). Covers two surface areas: text completions
 * (`callExternalLLM`) and vision-augmented completions
 * (`callExternalLLMWithVision`).
 *
 * Provider precedence (deterministic, NOT randomized):
 * - **GPT-4o is primary** for every research/vision call. The previous
 *   A/B split between providers was removed — `chooseProvider()` returns
 *   `'openai'` whenever `OPENAI_API_KEY` is present.
 * - **Anthropic Claude is the fallback** when OpenAI fails after retries
 *   OR when its circuit breaker is open OR when only `ANTHROPIC_API_KEY`
 *   is set. Caller can force a provider via `options.provider: 'openai'|'anthropic'`.
 * - **Neither key present** → fall through both loop iterations and throw
 *   a clear "No LLM provider available" error (the throw also fires when
 *   both providers fail after retries — symmetry simplifies the call site).
 *
 * Reliability stack (layered):
 * 1. **Per-request timeout** — OpenAI 240s, Anthropic 480s (Claude Opus
 *    can take 2-4 min for 32K-token generations; OpenAI is faster).
 *    `AbortController` enforces the cap regardless of upstream behavior.
 * 2. **Retry with exponential backoff** — 3 attempts via {@link withRetry}
 *    from `services/retry`, base delay 1000ms. Each retry logs the
 *    classified error category (rate-limit / timeout / 5xx / network /
 *    other) so dashboards can drill into per-category failure trends.
 * 3. **Circuit breaker** — 5 failures within 60s → skip provider for 30s.
 *    State is module-scoped (`circuitState`), so all in-flight requests
 *    across a Worker isolate share the breaker. Successful call resets the
 *    failure counter; circuit auto-closes when `Date.now() >= openUntil`.
 * 4. **Provider-level fallback** — primary fails after retries → fallback
 *    provider gets a fresh 3-retry budget. Both providers failing surfaces
 *    the FALLBACK's error to the caller (the primary's error was already
 *    logged at `provider_exhausted`).
 *
 * Cost estimation: per-1M-token table in {@link MODEL_COSTS}; the
 * estimator assumes a 30/70 input/output token split for generation tasks
 * (cheap heuristic — `usage` from both APIs only returns a total count, not
 * per-direction). Cost is informational, persisted in
 * `ExternalLLMResult.cost_estimate` for analytics — NOT used for routing
 * decisions.
 *
 * Failure modes (all collapse to a thrown `Error` reaching the caller):
 * - Both API keys missing → `'No LLM provider available — set OPENAI_API_KEY or ANTHROPIC_API_KEY'`.
 * - Both providers exhausted (retries + circuit) → the fallback's last error.
 * - JSON Schema mode + invalid schema → OpenAI returns 400, surfaced as
 *   `"OpenAI API error 400: <body>"`.
 *
 * @example
 * ```ts
 * import { callExternalLLM } from './services/external_llm.js';
 *
 * const result = await callExternalLLM(env, {
 *   system: 'You are a senior copywriter.',
 *   user: 'Write 3 hero taglines for a Newark soup kitchen.',
 *   jsonMode: true,
 *   maxTokens: 800,
 * });
 * // result.provider === 'openai' (deterministic default)
 * // result.model_used === 'gpt-4o'
 * // result.cost_estimate ≈ 0.002 (USD)
 * ```
 *
 * @see {@link module:services/retry} — exponential-backoff + jitter helper.
 * @see {@link module:services/ai_workflows} — primary caller.
 * @see {@link module:services/openai_research} — vision-call caller.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { withRetry, classifyError, type ErrorCategory } from './retry.js';

/**
 * Caller-supplied options for a single LLM round-trip. Shared by both
 * {@link callExternalLLM} (text) and {@link callExternalLLMWithVision}
 * (text + image — the vision call extends this with `imageUrl?` /
 * `imageBase64?` inline).
 *
 * @remarks
 * `jsonMode` and `jsonSchema` are mutually-relevant: when BOTH are set,
 * the strict-schema path wins (OpenAI receives `response_format.type =
 * 'json_schema'` with `strict: true`). When only `jsonMode` is set,
 * OpenAI receives `response_format.type = 'json_object'` — looser, no
 * schema enforcement, just "valid JSON". Anthropic Claude ignores both
 * flags at the API level; reliably-shaped JSON from Claude requires
 * spelling out the schema in the system/user prompts.
 *
 * `provider: 'auto'` (default) routes to GPT-4o whenever
 * `OPENAI_API_KEY` is present — the previous randomized A/B split was
 * removed. `provider: 'openai'` / `'anthropic'` are escape hatches for
 * caller-side cost optimization (e.g. force Haiku via `provider:
 * 'anthropic'` + `model: 'claude-haiku-4-5-20251001'`).
 */
export interface ExternalLLMOptions {
  /** System prompt (role: system). REQUIRED — empty string allowed but discouraged. */
  system: string;
  /** User prompt (role: user). REQUIRED — empty string allowed but discouraged. */
  user: string;
  /** Sampling temperature, 0-1. Default `0.3` (analytical/research tasks). Set higher (0.7-0.9) for creative copy. */
  temperature?: number;
  /** Max output tokens. Default `8192`. OpenAI uses `max_completion_tokens`, Anthropic uses `max_tokens` — both surfaces accept this single field. */
  maxTokens?: number;
  /** Request JSON output. OpenAI: `response_format.type='json_object'`. Anthropic: ignored — must be encoded in the prompt text. */
  jsonMode?: boolean;
  /** Strict JSON schema for OpenAI structured output. When set, `jsonMode` is implied + the schema is enforced server-side (400 on mismatch). Anthropic ignores. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** Preferred provider. `'auto'` (default) → GPT-4o primary, Anthropic fallback. `'openai'`/`'anthropic'` forces that provider as primary. */
  provider?: 'openai' | 'anthropic' | 'auto';
  /** Specific model override. Defaults to `gpt-4o` / `claude-sonnet-4-20250514` per provider. See {@link MODEL_COSTS} for the priced set. */
  model?: string;
}

/**
 * Result envelope returned by both {@link callExternalLLM} and
 * {@link callExternalLLMWithVision}. Persisted in upstream services
 * (`ai_workflows`, `openai_research`) for cost analytics and run-history
 * dashboards.
 *
 * @remarks
 * `token_count` is the API-reported total (OpenAI: `usage.total_tokens`;
 * Anthropic: `usage.input_tokens + usage.output_tokens`). Neither API
 * surfaces a clean per-direction split per call, so `cost_estimate`
 * applies the module-internal 30/70 heuristic on top of `token_count`
 * (see module-level `@description`).
 *
 * `latency_ms` measures wall-clock from the first `fetch()` attempt to
 * the successful response, INCLUDING `withRetry` backoff delays — so a
 * 30s value with `attempts=3` reflects ~6-8s of cumulative backoff plus
 * the successful third call.
 */
export interface ExternalLLMResult {
  /** Raw text completion. JSON-mode callers MUST `JSON.parse()` before use. */
  output: string;
  /** Actual model that responded (matches request, but persisted so logs survive future default-model changes). */
  model_used: string;
  /** Provider that successfully responded. Useful for downstream cost dashboards + fallback-rate alerts. */
  provider: 'openai' | 'anthropic';
  /** Wall-clock latency from first attempt to successful response, INCLUDING `withRetry` backoff. */
  latency_ms: number;
  /** API-reported total token count (input + output). */
  token_count: number;
  /** USD cost estimate via 30/70 input/output heuristic + {@link MODEL_COSTS}. Informational — never used for routing. */
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
 * Routes through the 4-layer reliability stack documented at module
 * level: per-request timeout (240s OpenAI / 480s Anthropic),
 * {@link withRetry} with exponential backoff (3 attempts, 1000ms base),
 * module-scoped circuit breaker (5 failures / 60s → skip 30s), and
 * primary→fallback provider chain. Each retry classifies the error
 * (rate-limit / timeout / 5xx / network / other) via
 * `classifyError` from `services/retry` so dashboards can drill into
 * per-category failure trends.
 *
 * @param env     - Worker environment. `OPENAI_API_KEY` and/or
 *   `ANTHROPIC_API_KEY` must be set; with neither, the call throws
 *   immediately. Provider with no key configured is silently skipped
 *   in the provider loop (no error — just falls through to the next).
 * @param options - Prompt configuration. See {@link ExternalLLMOptions}
 *   for the full field-level contract, including `jsonMode` vs
 *   `jsonSchema` precedence and provider/model overrides.
 *
 * @returns A populated {@link ExternalLLMResult} — `latency_ms` includes
 *   `withRetry` backoff time, `token_count` is API-reported total,
 *   `cost_estimate` derives from the 30/70 heuristic and
 *   {@link MODEL_COSTS}. The returned `provider` reflects whoever
 *   actually answered (so when primary fails over to fallback, the
 *   result will say `'anthropic'` even though the caller didn't request
 *   it).
 *
 * @remarks
 * Fallback-error-surfacing rule: when BOTH providers fail after
 * retries, the FALLBACK provider's last error reaches the caller — the
 * primary's error was already logged at `provider_exhausted` and is
 * not preserved further. If the caller needs to distinguish which
 * provider failed, parse `error.message` for the `OpenAI API error` /
 * `Anthropic API error` prefix.
 *
 * The 240s OpenAI timeout / 480s Anthropic timeout asymmetry is
 * deliberate: Claude Opus generations of 32K-token outputs routinely
 * take 2-4 minutes, while GPT-4o is typically <60s for the same prompt
 * size. Lowering the Anthropic cap caused spurious aborts on long
 * structure-planning prompts in the November 2025 timeframe.
 *
 * @throws {Error} `'No LLM provider available — set OPENAI_API_KEY or
 *   ANTHROPIC_API_KEY'` when neither API key is configured AND no
 *   provider fell through to a thrown upstream error first.
 * @throws {Error} `'OpenAI API error <status>: <body>'` when OpenAI
 *   returns non-2xx after retries (rate limit / invalid model /
 *   structured-output schema validation 400).
 * @throws {Error} `'Anthropic API error <status>: <body>'` when
 *   Anthropic returns non-2xx after retries (rate limit / overloaded /
 *   invalid model).
 *
 * @example
 * ```ts
 * const result = await callExternalLLM(env, {
 *   system: 'You are a web designer.',
 *   user: 'Generate a site plan for a bakery.',
 *   jsonMode: true,
 *   maxTokens: 4000,
 * });
 * const plan = JSON.parse(result.output) as SitePlan;
 * console.warn(JSON.stringify({ cost: result.cost_estimate }));
 * ```
 *
 * @see {@link ExternalLLMOptions}
 * @see {@link ExternalLLMResult}
 * @see {@link MODEL_COSTS}
 * @see {@link module:services/retry} — `withRetry` and `classifyError`.
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
 * GPT-4o vision is the primary path; Claude vision is the fallback.
 * The same 4-layer reliability stack as {@link callExternalLLM}
 * applies (per-request timeout, `withRetry`, circuit breaker,
 * provider-level fallback) — the vision path just routes to different
 * internal helpers (`callOpenAIWithVision` / `callAnthropicWithVision`)
 * that wrap the base text helpers with the right multi-part message
 * shape per provider.
 *
 * @param env     - Worker environment. Same key requirements as
 *   {@link callExternalLLM}.
 * @param options - Prompt configuration extended with `imageUrl?` /
 *   `imageBase64?`. Exactly one image source SHOULD be provided. When
 *   both are present, providers prefer their native form (OpenAI keeps
 *   URL; Anthropic uses the base64 directly without refetching). When
 *   NEITHER is provided, this function silently delegates to
 *   {@link callExternalLLM} for a plain text completion — a deliberate
 *   ergonomic for callers that build prompts up dynamically and may
 *   end up without an image.
 *
 * @returns A populated {@link ExternalLLMResult}. Same fields as the
 *   text path; `latency_ms` for Anthropic vision will include the
 *   base64-conversion fetch round-trip when only `imageUrl` was
 *   supplied (see Anthropic quirk below).
 *
 * @remarks
 * Anthropic base64 auto-fetch quirk: the Anthropic Messages API
 * accepts ONLY base64-encoded image data — no URL fetching server-side.
 * When the caller passes `imageUrl` but not `imageBase64`, this
 * function fetches the URL, reads it as `ArrayBuffer`, walks the bytes
 * via `String.fromCharCode` (chunked to avoid stack overflow on large
 * images), then `btoa`-encodes the result. The `content-type` from
 * the fetch response is preserved as `media_type` (falls back to
 * `image/png`). OpenAI does NOT need this conversion — it accepts
 * URLs directly in `image_url.url`.
 *
 * Empty-image short-circuit: if both `imageUrl` and `imageBase64` are
 * absent, we delegate to {@link callExternalLLM} BEFORE checking API
 * keys / circuit state. This means a vision call with no image carries
 * the same throw semantics as a plain text call.
 *
 * @throws {Error} `'No LLM vision provider available — set
 *   OPENAI_API_KEY or ANTHROPIC_API_KEY'` when neither key is set AND
 *   an image was provided.
 * @throws {Error} `'Failed to fetch image for Anthropic vision:
 *   <status>'` when the auto-fetch step for `imageUrl` → base64
 *   conversion returns non-2xx (broken CDN URL, expired signed link,
 *   404). Only fires on the Anthropic fallback path.
 * @throws {Error} `'OpenAI API error <status>: <body>'` /
 *   `'Anthropic API error <status>: <body>'` on provider-side
 *   failures (same as text path).
 *
 * @example
 * ```ts
 * const result = await callExternalLLMWithVision(env, {
 *   system: 'You are a visual brand analyst.',
 *   user: 'Describe the brand colors and logo in this screenshot.',
 *   imageUrl: 'https://example.com/screenshot.png',
 *   maxTokens: 2000,
 * });
 * const analysis = result.output;
 * ```
 *
 * @see {@link callExternalLLM} — text-only path; this function
 *   delegates here when no image is provided.
 * @see {@link ExternalLLMOptions}
 * @see {@link module:services/openai_research} — primary caller (brand
 *   + screenshot analysis).
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
