/**
 * Prompt Registry — the single lookup table for all prompt versions.
 *
 * Prompts are registered at startup (bundled) and optionally hot-patched
 * from KV at runtime. Supports:
 *   - Version pinning: resolve("research_business", 2)
 *   - A/B variants: resolveVariant("site_copy", 3, orgId)
 *   - KV override: loadFromKv(env) for hotfixes without redeployment
 */

import type { PromptSpec, PromptKey, VariantConfig } from './types.js';
import { buildPromptKey } from './types.js';

/** In-memory prompt store, keyed by `id@version` or `id@version:variant`. */
const store = new Map<PromptKey, PromptSpec>();

/** Variant weight configs for A/B tests. Key: `id@version`. */
const variantConfigs = new Map<string, VariantConfig>();

/**
 * Register a prompt spec in the registry.
 * Overwrites any existing entry with the same key.
 */
export function register(spec: PromptSpec): void {
  const key = buildPromptKey(spec.id, spec.version, spec.variant);
  store.set(key, spec);
}

/**
 * Register multiple prompts at once.
 */
export function registerAll(specs: PromptSpec[]): void {
  for (const spec of specs) {
    register(spec);
  }
}

/**
 * Resolve a prompt by ID and exact version.
 * Returns undefined if not found.
 */
export function resolve(id: string, version: number): PromptSpec | undefined {
  return store.get(buildPromptKey(id, version));
}

/**
 * Resolve a specific variant of a prompt.
 */
export function resolveExact(
  id: string,
  version: number,
  variant?: string,
): PromptSpec | undefined {
  return store.get(buildPromptKey(id, version, variant));
}

/**
 * Get the latest version of a prompt by ID.
 * Scans all registered versions and returns the highest.
 */
export function resolveLatest(id: string): PromptSpec | undefined {
  let best: PromptSpec | undefined;
  for (const spec of store.values()) {
    if (spec.id === id && !spec.variant) {
      if (!best || spec.version > best.version) {
        best = spec;
      }
    }
  }
  return best;
}

/**
 * List all registered prompt specs.
 */
export function listAll(): PromptSpec[] {
  return [...store.values()];
}

/**
 * List all versions of a specific prompt ID (excluding variants).
 */
export function listVersions(id: string): PromptSpec[] {
  return [...store.values()]
    .filter((s) => s.id === id && !s.variant)
    .sort((a, b) => a.version - b.version);
}

/**
 * List all variants for a prompt ID + version.
 */
export function listVariants(id: string, version: number): PromptSpec[] {
  return [...store.values()].filter(
    (s) => s.id === id && s.version === version && s.variant != null,
  );
}

/**
 * Configure A/B test weights for a prompt version.
 *
 * Example:
 *   configureVariants("site_copy", 3, { a: 80, b: 20 })
 *   → 80% of requests get variant "a", 20% get "b"
 */
export function configureVariants(
  id: string,
  version: number,
  weights: Record<string, number>,
): void {
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  if (total !== 100) {
    throw new Error(`Variant weights for ${id}@${version} must sum to 100, got ${total}`);
  }

  variantConfigs.set(`${id}@${version}`, { promptId: id, version, weights });
}

/**
 * Select a variant deterministically based on a seed (e.g. orgId).
 *
 * Uses a simple hash-based bucketing: hash(seed) % 100 maps to a weight bucket.
 * This ensures the same org always gets the same variant.
 */
export function selectVariant(id: string, version: number, seed: string): string | undefined {
  const config = variantConfigs.get(`${id}@${version}`);
  if (!config) return undefined;

  const bucket = simpleHash(seed + id + version) % 100;
  let cumulative = 0;

  for (const [variant, weight] of Object.entries(config.weights)) {
    cumulative += weight;
    if (bucket < cumulative) {
      return variant;
    }
  }

  // Fallback to first variant
  return Object.keys(config.weights)[0];
}

/**
 * Resolve a prompt with automatic A/B variant selection.
 *
 * If variants are configured, selects based on the seed.
 * Otherwise, returns the base (non-variant) version.
 */
export function resolveVariant(id: string, version: number, seed: string): PromptSpec | undefined {
  const variant = selectVariant(id, version, seed);
  if (variant) {
    const variantSpec = resolveExact(id, version, variant);
    if (variantSpec) return variantSpec;
  }
  return resolve(id, version);
}

/**
 * Load prompts from KV for hot-patching without redeployment.
 *
 * KV key format: `prompt:{id}@{version}` or `prompt:{id}@{version}:{variant}`
 * KV value: JSON-serialized PromptSpec
 *
 * Variant config KV key: `variant_config:{id}@{version}`
 * Variant config value: JSON-serialized VariantConfig
 */
export async function loadFromKv(kv: KVNamespace, promptIds?: string[]): Promise<number> {
  let loaded = 0;

  const keys = await kv.list({ prefix: 'prompt:' });
  for (const key of keys.keys) {
    if (promptIds && !promptIds.some((id) => key.name.startsWith(`prompt:${id}@`))) {
      continue;
    }

    const raw = await kv.get(key.name);
    if (raw) {
      try {
        const spec = JSON.parse(raw) as PromptSpec;
        register(spec);
        loaded++;
      } catch {
        console.error(`Failed to parse KV prompt: ${key.name}`);
      }
    }
  }

  // Load variant configs
  const variantKeys = await kv.list({ prefix: 'variant_config:' });
  for (const key of variantKeys.keys) {
    const raw = await kv.get(key.name);
    if (raw) {
      try {
        const config = JSON.parse(raw) as VariantConfig;
        configureVariants(config.promptId, config.version, config.weights);
      } catch {
        console.error(`Failed to parse KV variant config: ${key.name}`);
      }
    }
  }

  return loaded;
}

/**
 * Clear all registered prompts. Useful for testing.
 */
export function clearRegistry(): void {
  store.clear();
  variantConfigs.clear();
}

/**
 * Get registry stats.
 */
export function getStats(): {
  totalPrompts: number;
  uniqueIds: number;
  variantConfigs: number;
} {
  const ids = new Set<string>();
  for (const spec of store.values()) {
    ids.add(spec.id);
  }
  return {
    totalPrompts: store.size,
    uniqueIds: ids.size,
    variantConfigs: variantConfigs.size,
  };
}

// ── Internal helpers ─────────────────────────────────────────

/**
 * Simple non-cryptographic hash for deterministic variant bucketing.
 * Not for security — just consistent distribution.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}
