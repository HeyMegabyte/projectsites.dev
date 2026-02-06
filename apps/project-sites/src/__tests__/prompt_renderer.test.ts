import {
  renderPrompt,
  renderTemplate,
  extractPlaceholders,
  validateTemplatePlaceholders,
} from '../prompts/renderer.js';
import type { PromptSpec } from '../prompts/types.js';

/**
 * Unit tests for the prompt renderer module.
 *
 * Covers renderPrompt, renderTemplate, extractPlaceholders,
 * and validateTemplatePlaceholders with edge cases.
 */

// ─── Helpers ───────────────────────────────────────────────────

function makeSpec(overrides: Partial<PromptSpec> = {}): PromptSpec {
  return {
    id: 'test_prompt',
    version: 1,
    description: 'A test prompt',
    models: ['gpt-4', 'claude-3'],
    params: { temperature: 0.7, maxTokens: 1024 },
    inputs: { required: ['topic'], optional: ['style'] },
    outputs: { format: 'text' },
    notes: { usage: 'testing only' },
    system: 'You are an expert on {{topic}}.',
    user: 'Write about {{topic}} in {{style}} style.',
    ...overrides,
  };
}

// ─── renderPrompt ──────────────────────────────────────────────

describe('renderPrompt', () => {
  it('renders system and user templates with all required inputs', () => {
    const spec = makeSpec();
    const result = renderPrompt(spec, { topic: 'biology', style: 'formal' });

    expect(result.system).toContain('biology');
    expect(result.user).toContain('biology');
    expect(result.user).toContain('formal');
  });

  it('throws when a required input is missing', () => {
    const spec = makeSpec();

    expect(() => renderPrompt(spec, {})).toThrow(
      'Missing required prompt inputs for "test_prompt@1": topic',
    );
  });

  it('throws when a required input is whitespace-only', () => {
    const spec = makeSpec();

    expect(() => renderPrompt(spec, { topic: '   ' })).toThrow(
      'Missing required prompt inputs for "test_prompt@1": topic',
    );
  });

  it('defaults optional inputs to empty string when not provided', () => {
    const spec = makeSpec();
    const result = renderPrompt(spec, { topic: 'history' });

    // style placeholder replaced with empty string (no delimiters for empty)
    expect(result.user).toBe('Write about <<<USER_INPUT>>>history<<<END_USER_INPUT>>> in  style.');
  });

  it('wraps user values in safe delimiters by default', () => {
    const spec = makeSpec();
    const result = renderPrompt(spec, { topic: 'math', style: 'casual' });

    expect(result.system).toBe('You are an expert on <<<USER_INPUT>>>math<<<END_USER_INPUT>>>.');
    expect(result.user).toBe(
      'Write about <<<USER_INPUT>>>math<<<END_USER_INPUT>>> in <<<USER_INPUT>>>casual<<<END_USER_INPUT>>> style.',
    );
  });

  it('skips delimiter wrapping when safeDelimit is false', () => {
    const spec = makeSpec();
    const result = renderPrompt(spec, { topic: 'art', style: 'brief' }, { safeDelimit: false });

    expect(result.system).toBe('You are an expert on art.');
    expect(result.user).toBe('Write about art in brief style.');
    expect(result.system).not.toContain('<<<USER_INPUT>>>');
    expect(result.user).not.toContain('<<<USER_INPUT>>>');
  });

  it('strips unresolved placeholders when stripUnresolved is true', () => {
    const spec = makeSpec({
      system: 'System: {{topic}} and {{unknown}}',
      user: 'User: {{topic}} with {{mystery}}',
    });
    const result = renderPrompt(spec, { topic: 'science' }, { stripUnresolved: true });

    expect(result.system).not.toContain('{{unknown}}');
    expect(result.user).not.toContain('{{mystery}}');
    expect(result.system).toContain('science');
  });

  it('returns the first model from the spec', () => {
    const spec = makeSpec({ models: ['claude-3-opus', 'gpt-4-turbo'] });
    const result = renderPrompt(spec, { topic: 'testing' });

    expect(result.model).toBe('claude-3-opus');
  });

  it('returns a copy of params from the spec', () => {
    const spec = makeSpec({ params: { temperature: 0.3, maxTokens: 2048 } });
    const result = renderPrompt(spec, { topic: 'params' });

    expect(result.params).toEqual({ temperature: 0.3, maxTokens: 2048 });
    // Ensure it is a copy, not the same reference
    expect(result.params).not.toBe(spec.params);
  });

  it('lists all missing required inputs in the error message', () => {
    const spec = makeSpec({
      inputs: { required: ['a', 'b', 'c'], optional: [] },
      system: '{{a}} {{b}} {{c}}',
      user: '{{a}}',
    });

    expect(() => renderPrompt(spec, {})).toThrow('a, b, c');
  });
});

// ─── renderTemplate ────────────────────────────────────────────

describe('renderTemplate', () => {
  it('replaces {{key}} placeholders with provided values', () => {
    const result = renderTemplate('Hello {{name}}, welcome to {{place}}!', {
      name: 'Alice',
      place: 'Wonderland',
    });

    expect(result).toBe('Hello Alice, welcome to Wonderland!');
  });

  it('leaves unknown placeholders intact by default', () => {
    const result = renderTemplate('{{known}} and {{unknown}}', {
      known: 'resolved',
    });

    expect(result).toBe('resolved and {{unknown}}');
  });

  it('strips unknown placeholders when stripUnresolved is true', () => {
    const result = renderTemplate('Start {{a}} middle {{b}} end', { a: 'X' }, true);

    expect(result).toBe('Start X middle  end');
  });

  it('returns empty string for empty template', () => {
    const result = renderTemplate('', { key: 'value' });

    expect(result).toBe('');
  });

  it('returns original string when template has no placeholders', () => {
    const original = 'No placeholders here.';
    const result = renderTemplate(original, { key: 'value' });

    expect(result).toBe(original);
  });
});

// ─── extractPlaceholders ───────────────────────────────────────

describe('extractPlaceholders', () => {
  it('finds all unique placeholder names in a template', () => {
    const result = extractPlaceholders('{{alpha}} and {{beta}} with {{gamma}}');

    expect(result).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']));
    expect(result).toHaveLength(3);
  });

  it('returns empty array when there are no placeholders', () => {
    const result = extractPlaceholders('No variables here.');

    expect(result).toEqual([]);
  });

  it('deduplicates repeated placeholder names', () => {
    const result = extractPlaceholders('{{x}} then {{x}} and {{x}} again');

    expect(result).toEqual(['x']);
    expect(result).toHaveLength(1);
  });
});

// ─── validateTemplatePlaceholders ──────────────────────────────

describe('validateTemplatePlaceholders', () => {
  it('returns empty array when all placeholders are declared', () => {
    const spec = makeSpec({
      inputs: { required: ['topic'], optional: ['style'] },
      system: 'About {{topic}}.',
      user: '{{topic}} in {{style}}.',
    });
    const result = validateTemplatePlaceholders(spec);

    expect(result).toEqual([]);
  });

  it('returns undeclared placeholder keys found in templates', () => {
    const spec = makeSpec({
      inputs: { required: ['topic'], optional: [] },
      system: '{{topic}} and {{rogue}}',
      user: '{{topic}} with {{extra}}',
    });
    const result = validateTemplatePlaceholders(spec);

    expect(result).toEqual(expect.arrayContaining(['rogue', 'extra']));
    expect(result).toHaveLength(2);
  });

  it('does not flag keys that appear in optional inputs', () => {
    const spec = makeSpec({
      inputs: { required: [], optional: ['flavor'] },
      system: '{{flavor}}',
      user: '{{flavor}}',
    });
    const result = validateTemplatePlaceholders(spec);

    expect(result).toEqual([]);
  });
});
