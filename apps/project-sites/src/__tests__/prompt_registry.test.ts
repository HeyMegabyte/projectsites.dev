import {
  register,
  registerAll,
  resolve,
  resolveExact,
  resolveLatest,
  listAll,
  listVersions,
  listVariants,
  configureVariants,
  selectVariant,
  resolveVariant,
  loadFromKv,
  clearRegistry,
  getStats,
} from '../prompts/registry.js';
import type { PromptSpec } from '../prompts/types.js';

/**
 * Comprehensive tests for the prompt registry module.
 *
 * Covers registration, resolution, versioning, A/B variant selection,
 * KV hot-patching, and registry introspection.
 */

// ── Test fixture helper ──────────────────────────────────────────

function makeSpec(overrides?: Partial<PromptSpec>): PromptSpec {
  return {
    id: 'test_prompt',
    version: 1,
    description: 'A test prompt',
    models: ['gpt-4'],
    params: { temperature: 0.7, maxTokens: 1024 },
    inputs: { required: ['query'], optional: ['context'] },
    outputs: { format: 'json', schema: 'TestSchema' },
    notes: { quality: 'experimental' },
    system: 'You are a test assistant.',
    user: 'Answer: {{query}}',
    ...overrides,
  };
}

// ── Mock KV helper ───────────────────────────────────────────────

function createMockKv(
  promptEntries: Record<string, string> = {},
  variantConfigEntries: Record<string, string> = {},
) {
  const allEntries = { ...promptEntries, ...variantConfigEntries };

  return {
    list: jest.fn().mockImplementation(({ prefix }: { prefix: string }) => {
      const keys = Object.keys(allEntries)
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return Promise.resolve({ keys });
    }),
    get: jest.fn().mockImplementation((key: string) => {
      return Promise.resolve(allEntries[key] ?? null);
    }),
  };
}

// ── Reset state between tests ────────────────────────────────────

beforeEach(() => {
  clearRegistry();
});

// ─── register / resolve ──────────────────────────────────────────

describe('register and resolve', () => {
  it('registers a prompt and resolves it by id and version', () => {
    const spec = makeSpec();
    register(spec);

    const result = resolve('test_prompt', 1);
    expect(result).toEqual(spec);
  });

  it('returns undefined when resolving a non-existent prompt', () => {
    const result = resolve('nonexistent', 1);
    expect(result).toBeUndefined();
  });

  it('overwrites an existing entry with the same id and version', () => {
    register(makeSpec({ description: 'original' }));
    register(makeSpec({ description: 'updated' }));

    const result = resolve('test_prompt', 1);
    expect(result?.description).toBe('updated');
  });

  it('does not confuse different versions of the same id', () => {
    register(makeSpec({ version: 1, description: 'v1' }));
    register(makeSpec({ version: 2, description: 'v2' }));

    expect(resolve('test_prompt', 1)?.description).toBe('v1');
    expect(resolve('test_prompt', 2)?.description).toBe('v2');
  });
});

// ─── registerAll ─────────────────────────────────────────────────

describe('registerAll', () => {
  it('registers multiple prompts at once', () => {
    const specs = [
      makeSpec({ id: 'alpha', version: 1 }),
      makeSpec({ id: 'beta', version: 1 }),
      makeSpec({ id: 'alpha', version: 2 }),
    ];

    registerAll(specs);

    expect(resolve('alpha', 1)).toBeDefined();
    expect(resolve('alpha', 2)).toBeDefined();
    expect(resolve('beta', 1)).toBeDefined();
  });

  it('handles an empty array without error', () => {
    expect(() => registerAll([])).not.toThrow();
    expect(listAll()).toHaveLength(0);
  });
});

// ─── resolveExact ────────────────────────────────────────────────

describe('resolveExact', () => {
  it('resolves a base prompt when no variant is specified', () => {
    const spec = makeSpec();
    register(spec);

    const result = resolveExact('test_prompt', 1);
    expect(result).toEqual(spec);
  });

  it('resolves a specific variant', () => {
    const variantA = makeSpec({ variant: 'a', description: 'Variant A' });
    register(variantA);

    const result = resolveExact('test_prompt', 1, 'a');
    expect(result).toEqual(variantA);
  });

  it('returns undefined for a non-existent variant', () => {
    register(makeSpec());
    const result = resolveExact('test_prompt', 1, 'nonexistent');
    expect(result).toBeUndefined();
  });

  it('distinguishes between base and variant entries', () => {
    const base = makeSpec({ description: 'base' });
    const variant = makeSpec({ variant: 'a', description: 'variant-a' });
    register(base);
    register(variant);

    expect(resolveExact('test_prompt', 1)?.description).toBe('base');
    expect(resolveExact('test_prompt', 1, 'a')?.description).toBe('variant-a');
  });
});

// ─── resolveLatest ───────────────────────────────────────────────

describe('resolveLatest', () => {
  it('returns the highest version for a given id', () => {
    register(makeSpec({ version: 1, description: 'v1' }));
    register(makeSpec({ version: 3, description: 'v3' }));
    register(makeSpec({ version: 2, description: 'v2' }));

    const result = resolveLatest('test_prompt');
    expect(result?.version).toBe(3);
    expect(result?.description).toBe('v3');
  });

  it('returns undefined for an unknown id', () => {
    register(makeSpec());
    const result = resolveLatest('unknown_prompt');
    expect(result).toBeUndefined();
  });

  it('ignores variant entries when determining latest version', () => {
    register(makeSpec({ version: 2, description: 'base-v2' }));
    register(makeSpec({ version: 3, variant: 'a', description: 'variant-v3' }));

    const result = resolveLatest('test_prompt');
    expect(result?.version).toBe(2);
    expect(result?.description).toBe('base-v2');
  });
});

// ─── listAll ─────────────────────────────────────────────────────

describe('listAll', () => {
  it('returns all registered specs including variants', () => {
    register(makeSpec({ id: 'p1', version: 1 }));
    register(makeSpec({ id: 'p2', version: 1 }));
    register(makeSpec({ id: 'p1', version: 1, variant: 'a' }));

    const all = listAll();
    expect(all).toHaveLength(3);
  });

  it('returns an empty array when nothing is registered', () => {
    expect(listAll()).toEqual([]);
  });
});

// ─── listVersions ────────────────────────────────────────────────

describe('listVersions', () => {
  it('returns all versions for an id sorted ascending', () => {
    register(makeSpec({ version: 3 }));
    register(makeSpec({ version: 1 }));
    register(makeSpec({ version: 2 }));

    const versions = listVersions('test_prompt');
    expect(versions).toHaveLength(3);
    expect(versions.map((s) => s.version)).toEqual([1, 2, 3]);
  });

  it('excludes variant entries', () => {
    register(makeSpec({ version: 1 }));
    register(makeSpec({ version: 1, variant: 'a' }));
    register(makeSpec({ version: 2 }));

    const versions = listVersions('test_prompt');
    expect(versions).toHaveLength(2);
    expect(versions.every((s) => s.variant == null)).toBe(true);
  });

  it('returns empty array for unknown id', () => {
    expect(listVersions('unknown')).toEqual([]);
  });
});

// ─── listVariants ────────────────────────────────────────────────

describe('listVariants', () => {
  it('returns all variants for a specific id and version', () => {
    register(makeSpec({ version: 1 }));
    register(makeSpec({ version: 1, variant: 'a' }));
    register(makeSpec({ version: 1, variant: 'b' }));
    register(makeSpec({ version: 2, variant: 'a' }));

    const variants = listVariants('test_prompt', 1);
    expect(variants).toHaveLength(2);
    expect(variants.map((s) => s.variant).sort()).toEqual(['a', 'b']);
  });

  it('returns empty array when no variants exist for version', () => {
    register(makeSpec({ version: 1 }));
    expect(listVariants('test_prompt', 1)).toEqual([]);
  });

  it('does not include the base (non-variant) entry', () => {
    register(makeSpec({ version: 1 }));
    register(makeSpec({ version: 1, variant: 'a' }));

    const variants = listVariants('test_prompt', 1);
    expect(variants).toHaveLength(1);
    expect(variants[0].variant).toBe('a');
  });
});

// ─── configureVariants ───────────────────────────────────────────

describe('configureVariants', () => {
  it('accepts weights summing to 100', () => {
    expect(() => {
      configureVariants('test_prompt', 1, { a: 80, b: 20 });
    }).not.toThrow();
  });

  it('throws when weights do not sum to 100', () => {
    expect(() => {
      configureVariants('test_prompt', 1, { a: 60, b: 30 });
    }).toThrow('must sum to 100, got 90');
  });

  it('throws with descriptive error including id and version', () => {
    expect(() => {
      configureVariants('my_prompt', 5, { a: 50 });
    }).toThrow('my_prompt@5');
  });

  it('allows reconfiguring weights for the same id and version', () => {
    configureVariants('test_prompt', 1, { a: 50, b: 50 });
    expect(() => {
      configureVariants('test_prompt', 1, { a: 70, b: 30 });
    }).not.toThrow();
  });
});

// ─── selectVariant ───────────────────────────────────────────────

describe('selectVariant', () => {
  it('returns undefined when no variant config exists', () => {
    const result = selectVariant('test_prompt', 1, 'seed-abc');
    expect(result).toBeUndefined();
  });

  it('returns a variant when config is present', () => {
    configureVariants('test_prompt', 1, { a: 80, b: 20 });

    const result = selectVariant('test_prompt', 1, 'some-seed');
    expect(result).toBeDefined();
    expect(['a', 'b']).toContain(result);
  });

  it('returns the same variant consistently for the same seed', () => {
    configureVariants('test_prompt', 1, { a: 50, b: 50 });

    const first = selectVariant('test_prompt', 1, 'stable-seed');
    const second = selectVariant('test_prompt', 1, 'stable-seed');
    const third = selectVariant('test_prompt', 1, 'stable-seed');

    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('can produce different variants for different seeds', () => {
    configureVariants('test_prompt', 1, { a: 50, b: 50 });

    // With 50/50 split and enough seeds, at least two distinct results should appear
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const v = selectVariant('test_prompt', 1, `seed-${i}`);
      if (v) results.add(v);
    }

    expect(results.size).toBe(2);
  });
});

// ─── resolveVariant ──────────────────────────────────────────────

describe('resolveVariant', () => {
  it('returns the variant spec when variant config and spec exist', () => {
    register(makeSpec({ version: 1, description: 'base' }));
    register(makeSpec({ version: 1, variant: 'a', description: 'variant-a' }));
    register(makeSpec({ version: 1, variant: 'b', description: 'variant-b' }));
    configureVariants('test_prompt', 1, { a: 50, b: 50 });

    const result = resolveVariant('test_prompt', 1, 'any-seed');
    expect(result).toBeDefined();
    // The result must be one of the registered specs
    expect(['base', 'variant-a', 'variant-b']).toContain(result?.description);
  });

  it('falls back to base spec when selected variant spec is not registered', () => {
    register(makeSpec({ version: 1, description: 'base' }));
    // Configure variants but only register the base, not variant 'a' or 'b'
    configureVariants('test_prompt', 1, { a: 50, b: 50 });

    const result = resolveVariant('test_prompt', 1, 'some-seed');
    expect(result).toBeDefined();
    expect(result?.description).toBe('base');
  });

  it('returns the base spec when no variant config is set', () => {
    register(makeSpec({ version: 1, description: 'base' }));

    const result = resolveVariant('test_prompt', 1, 'some-seed');
    expect(result).toBeDefined();
    expect(result?.description).toBe('base');
    expect(result?.variant).toBeUndefined();
  });

  it('returns undefined when neither variant nor base exist', () => {
    configureVariants('test_prompt', 1, { a: 100 });

    const result = resolveVariant('test_prompt', 1, 'seed');
    expect(result).toBeUndefined();
  });
});

// ─── loadFromKv ──────────────────────────────────────────────────

describe('loadFromKv', () => {
  it('loads prompt specs from KV and registers them', async () => {
    const spec = makeSpec({ id: 'kv_prompt', version: 1 });
    const kv = createMockKv({
      'prompt:kv_prompt@1': JSON.stringify(spec),
    });

    const loaded = await loadFromKv(kv as unknown as KVNamespace);

    expect(loaded).toBe(1);
    expect(resolve('kv_prompt', 1)).toEqual(spec);
  });

  it('loads multiple prompts from KV', async () => {
    const spec1 = makeSpec({ id: 'p1', version: 1 });
    const spec2 = makeSpec({ id: 'p2', version: 2 });
    const kv = createMockKv({
      'prompt:p1@1': JSON.stringify(spec1),
      'prompt:p2@2': JSON.stringify(spec2),
    });

    const loaded = await loadFromKv(kv as unknown as KVNamespace);

    expect(loaded).toBe(2);
    expect(resolve('p1', 1)).toBeDefined();
    expect(resolve('p2', 2)).toBeDefined();
  });

  it('handles JSON parse errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const kv = createMockKv({
      'prompt:bad@1': '{invalid json!!!',
    });

    const loaded = await loadFromKv(kv as unknown as KVNamespace);

    expect(loaded).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse KV prompt'));

    consoleSpy.mockRestore();
  });

  it('filters by promptIds when provided', async () => {
    const spec1 = makeSpec({ id: 'wanted', version: 1 });
    const spec2 = makeSpec({ id: 'unwanted', version: 1 });
    const kv = createMockKv({
      'prompt:wanted@1': JSON.stringify(spec1),
      'prompt:unwanted@1': JSON.stringify(spec2),
    });

    const loaded = await loadFromKv(kv as unknown as KVNamespace, ['wanted']);

    expect(loaded).toBe(1);
    expect(resolve('wanted', 1)).toBeDefined();
    expect(resolve('unwanted', 1)).toBeUndefined();
  });

  it('loads variant configs from KV', async () => {
    const spec = makeSpec({ id: 'ab_test', version: 1 });
    const specA = makeSpec({ id: 'ab_test', version: 1, variant: 'a' });
    register(spec);
    register(specA);

    const kv = createMockKv(
      {},
      {
        'variant_config:ab_test@1': JSON.stringify({
          promptId: 'ab_test',
          version: 1,
          weights: { a: 70, b: 30 },
        }),
      },
    );

    await loadFromKv(kv as unknown as KVNamespace);

    const variant = selectVariant('ab_test', 1, 'some-seed');
    expect(variant).toBeDefined();
    expect(['a', 'b']).toContain(variant);
  });

  it('handles variant config parse errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const kv = createMockKv(
      {},
      {
        'variant_config:test@1': 'not json',
      },
    );

    await loadFromKv(kv as unknown as KVNamespace);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse KV variant config'),
    );

    consoleSpy.mockRestore();
  });

  it('skips keys that return null from kv.get', async () => {
    const kv = {
      list: jest.fn().mockImplementation(({ prefix }: { prefix: string }) => {
        if (prefix === 'prompt:') {
          return Promise.resolve({ keys: [{ name: 'prompt:ghost@1' }] });
        }
        return Promise.resolve({ keys: [] });
      }),
      get: jest.fn().mockResolvedValue(null),
    };

    const loaded = await loadFromKv(kv as unknown as KVNamespace);
    expect(loaded).toBe(0);
  });
});

// ─── clearRegistry ───────────────────────────────────────────────

describe('clearRegistry', () => {
  it('empties all registered prompts', () => {
    register(makeSpec({ id: 'a', version: 1 }));
    register(makeSpec({ id: 'b', version: 2 }));
    expect(listAll()).toHaveLength(2);

    clearRegistry();
    expect(listAll()).toHaveLength(0);
  });

  it('also clears variant configurations', () => {
    register(makeSpec({ version: 1 }));
    configureVariants('test_prompt', 1, { a: 100 });

    clearRegistry();

    expect(selectVariant('test_prompt', 1, 'seed')).toBeUndefined();
    expect(getStats().variantConfigs).toBe(0);
  });
});

// ─── getStats ────────────────────────────────────────────────────

describe('getStats', () => {
  it('returns zeros for an empty registry', () => {
    const stats = getStats();
    expect(stats).toEqual({
      totalPrompts: 0,
      uniqueIds: 0,
      variantConfigs: 0,
    });
  });

  it('returns correct counts with prompts and variants', () => {
    register(makeSpec({ id: 'alpha', version: 1 }));
    register(makeSpec({ id: 'alpha', version: 2 }));
    register(makeSpec({ id: 'alpha', version: 1, variant: 'a' }));
    register(makeSpec({ id: 'beta', version: 1 }));
    configureVariants('alpha', 1, { a: 100 });

    const stats = getStats();
    expect(stats.totalPrompts).toBe(4);
    expect(stats.uniqueIds).toBe(2);
    expect(stats.variantConfigs).toBe(1);
  });

  it('counts variant specs as part of totalPrompts', () => {
    register(makeSpec({ id: 'p', version: 1 }));
    register(makeSpec({ id: 'p', version: 1, variant: 'x' }));
    register(makeSpec({ id: 'p', version: 1, variant: 'y' }));

    expect(getStats().totalPrompts).toBe(3);
  });

  it('counts variant entries under the same uniqueId', () => {
    register(makeSpec({ id: 'same', version: 1 }));
    register(makeSpec({ id: 'same', version: 1, variant: 'a' }));
    register(makeSpec({ id: 'same', version: 2 }));

    // All have id "same", so uniqueIds should be 1
    expect(getStats().uniqueIds).toBe(1);
  });
});
