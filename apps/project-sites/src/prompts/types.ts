/**
 * Core types for the prompt registry and AI workflow infrastructure.
 *
 * Every prompt is referenced by `promptId@version` (never "latest" in production).
 * Variants (A/B tests) are identified by an optional suffix: `promptId@version:variant`.
 */

/** Metadata + content for a single prompt version. */
export interface PromptSpec {
  /** Unique identifier, e.g. "research_business" */
  id: string;

  /** Monotonically increasing integer */
  version: number;

  /** Optional variant label for A/B tests, e.g. "a", "b" */
  variant?: string;

  /** Human-readable purpose */
  description: string;

  /** Ordered preference list of model identifiers */
  models: string[];

  /** LLM generation parameters */
  params: {
    temperature: number;
    maxTokens: number;
  };

  /** Input schema metadata */
  inputs: {
    required: string[];
    optional: string[];
  };

  /** Expected output metadata */
  outputs: {
    format: 'json' | 'markdown' | 'html' | 'text';
    schema?: string;
  };

  /** Free-form notes (pii policy, quality notes, etc.) */
  notes: Record<string, string>;

  /** System prompt template (may contain {{var}} placeholders) */
  system: string;

  /** User prompt template (contains {{var}} placeholders) */
  user: string;
}

/** Canonical key: "id@version" or "id@version:variant" */
export type PromptKey = string;

/** Build a PromptKey from parts */
export function buildPromptKey(id: string, version: number, variant?: string): PromptKey {
  const base = `${id}@${version}`;
  return variant ? `${base}:${variant}` : base;
}

/** Parse a PromptKey into its parts */
export function parsePromptKey(key: PromptKey): { id: string; version: number; variant?: string } {
  const variantSplit = key.split(':');
  const mainPart = variantSplit[0];
  const variant = variantSplit[1];
  const atSplit = mainPart.split('@');
  return {
    id: atSplit[0],
    version: Number(atSplit[1]),
    variant,
  };
}

/** Result of a single LLM call */
export interface LlmCallResult {
  success: boolean;
  output: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  promptId: string;
  promptVersion: number;
  promptVariant?: string;
}

/** Structured log entry emitted for every LLM call */
export interface LlmCallLog {
  promptId: string;
  promptVersion: number;
  promptVariant?: string;
  model: string;
  params: { temperature: number; maxTokens: number };
  inputHash: string;
  latencyMs: number;
  tokenCount: number;
  cost?: number;
  outcome: 'success' | 'error';
  retryCount: number;
  errorMessage?: string;
  timestamp: string;
}

/** Variant weight configuration for A/B tests */
export interface VariantConfig {
  promptId: string;
  version: number;
  weights: Record<string, number>;
}

/** Feature flag for prompt variant selection */
export interface PromptFeatureFlag {
  promptId: string;
  version: number;
  variants: Record<string, number>;
  enabled: boolean;
}
