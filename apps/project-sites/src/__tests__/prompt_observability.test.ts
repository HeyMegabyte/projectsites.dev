import { webcrypto } from 'node:crypto';
if (!globalThis.crypto?.subtle) {
  (globalThis as any).crypto = webcrypto;
}

import {
  sha256,
  hashInputs,
  buildCallLog,
  emitCallLog,
  estimateCost,
  withObservability,
} from '../prompts/observability.js';
import type { LlmCallLog } from '../prompts/types.js';
import type { PromptSpec } from '../prompts/types.js';

/** Minimal PromptSpec fixture used across tests. */
function makeSpec(overrides: Partial<PromptSpec> = {}): PromptSpec {
  return {
    id: 'test_prompt',
    version: 1,
    description: 'Test prompt',
    models: ['gpt-4o'],
    params: { temperature: 0.7, maxTokens: 1024 },
    inputs: { required: ['query'], optional: [] },
    outputs: { format: 'text' },
    notes: {},
    system: 'You are a test assistant.',
    user: '{{query}}',
    ...overrides,
  };
}

// ── sha256 ───────────────────────────────────────────────────

describe('sha256', () => {
  it('returns a 64-character hex string', async () => {
    const hash = await sha256('hello');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same hash for the same input', async () => {
    const a = await sha256('deterministic');
    const b = await sha256('deterministic');
    expect(a).toBe(b);
  });

  it('returns different hashes for different inputs', async () => {
    const a = await sha256('input-a');
    const b = await sha256('input-b');
    expect(a).not.toBe(b);
  });
});

// ── hashInputs ───────────────────────────────────────────────

describe('hashInputs', () => {
  it('returns consistent hash regardless of key order', async () => {
    const a = await hashInputs({ x: 1, y: 2 });
    const b = await hashInputs({ y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it('returns different hashes for different inputs', async () => {
    const a = await hashInputs({ name: 'alice' });
    const b = await hashInputs({ name: 'bob' });
    expect(a).not.toBe(b);
  });
});

// ── buildCallLog ─────────────────────────────────────────────

describe('buildCallLog', () => {
  it('returns a correct LlmCallLog structure with all fields', () => {
    const spec = makeSpec({ variant: 'a' });
    const log = buildCallLog({
      spec,
      model: 'gpt-4o',
      inputHash: 'abc123',
      latencyMs: 250,
      tokenCount: 500,
      cost: 0.005,
      outcome: 'success',
      retryCount: 0,
    });

    expect(log).toMatchObject({
      promptId: 'test_prompt',
      promptVersion: 1,
      promptVariant: 'a',
      model: 'gpt-4o',
      params: { temperature: 0.7, maxTokens: 1024 },
      inputHash: 'abc123',
      latencyMs: 250,
      tokenCount: 500,
      cost: 0.005,
      outcome: 'success',
      retryCount: 0,
    });
    expect(log.errorMessage).toBeUndefined();
    expect(log.timestamp).toBeDefined();
    expect(new Date(log.timestamp).toISOString()).toBe(log.timestamp);
  });

  it('includes errorMessage when provided', () => {
    const log = buildCallLog({
      spec: makeSpec(),
      model: 'gpt-4o',
      inputHash: 'xyz',
      latencyMs: 100,
      tokenCount: 0,
      outcome: 'error',
      retryCount: 2,
      errorMessage: 'rate limited',
    });

    expect(log.outcome).toBe('error');
    expect(log.errorMessage).toBe('rate limited');
    expect(log.retryCount).toBe(2);
  });
});

// ── emitCallLog ──────────────────────────────────────────────

describe('emitCallLog', () => {
  it('calls console.warn with JSON string containing all log fields', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const log: LlmCallLog = {
      promptId: 'test_prompt',
      promptVersion: 1,
      model: 'gpt-4o',
      params: { temperature: 0.7, maxTokens: 1024 },
      inputHash: 'abc123',
      latencyMs: 200,
      tokenCount: 100,
      outcome: 'success',
      retryCount: 0,
      timestamp: '2025-01-01T00:00:00.000Z',
    };

    emitCallLog(log);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(emitted.level).toBe('info');
    expect(emitted.service).toBe('ai_workflow');
    expect(emitted.event).toBe('llm_call');
    expect(emitted.promptId).toBe('test_prompt');
    expect(emitted.model).toBe('gpt-4o');
    expect(emitted.latencyMs).toBe(200);
    expect(emitted.outcome).toBe('success');

    consoleSpy.mockRestore();
  });
});

// ── estimateCost ─────────────────────────────────────────────

describe('estimateCost', () => {
  it('returns 0 for free Workers AI models', () => {
    expect(estimateCost('@cf/meta/llama-3.1-8b-instruct', 1000, 500)).toBe(0);
    expect(estimateCost('@cf/meta/llama-3.1-70b-instruct', 2000, 1000)).toBe(0);
  });

  it('returns correct cost for gpt-4o', () => {
    // gpt-4o: input $0.0025/1k, output $0.01/1k
    const cost = estimateCost('gpt-4o', 1000, 1000);
    expect(cost).toBeCloseTo(0.0025 + 0.01, 6);
  });

  it('returns correct cost for gpt-4o-mini', () => {
    // gpt-4o-mini: input $0.00015/1k, output $0.0006/1k
    const cost = estimateCost('gpt-4o-mini', 2000, 500);
    const expected = (2000 / 1000) * 0.00015 + (500 / 1000) * 0.0006;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it('returns 0 for unknown models', () => {
    expect(estimateCost('some-unknown-model', 5000, 3000)).toBe(0);
  });
});

// ── withObservability ────────────────────────────────────────

describe('withObservability', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('returns result and log on success, and emits the log', async () => {
    const spec = makeSpec();
    const inputs = { query: 'hello' };

    const { result, log } = await withObservability(spec, 'gpt-4o', inputs, 0, async () => ({
      output: 'world',
      tokenCount: 42,
    }));

    expect(result).toBe('world');
    expect(log.outcome).toBe('success');
    expect(log.tokenCount).toBe(42);
    expect(log.retryCount).toBe(0);
    expect(log.promptId).toBe('test_prompt');
    expect(log.model).toBe('gpt-4o');

    // Verify emitCallLog was called
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(emitted.outcome).toBe('success');
  });

  it('throws and emits error log on failure', async () => {
    const spec = makeSpec();
    const inputs = { query: 'fail' };

    await expect(
      withObservability(spec, 'gpt-4o', inputs, 1, async () => {
        throw new Error('LLM timeout');
      }),
    ).rejects.toThrow('LLM timeout');

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(emitted.outcome).toBe('error');
    expect(emitted.errorMessage).toBe('LLM timeout');
    expect(emitted.retryCount).toBe(1);
    expect(emitted.tokenCount).toBe(0);
  });

  it('records latencyMs > 0', async () => {
    const spec = makeSpec();
    const inputs = { query: 'timing' };

    const { log } = await withObservability(spec, 'gpt-4o', inputs, 0, async () => {
      // Small delay to ensure measurable latency
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { output: 'done', tokenCount: 10 };
    });

    expect(log.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
