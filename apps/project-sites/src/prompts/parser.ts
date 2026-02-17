/**
 * Parse prompt Markdown files with YAML frontmatter.
 *
 * Format:
 * ```
 * ---
 * id: research_business
 * version: 2
 * models:
 *   - "@cf/meta/llama-3.1-70b-instruct"
 * params:
 *   temperature: 0.3
 *   max_tokens: 4096
 * inputs:
 *   required: [business_name, city]
 *   optional: [phone]
 * outputs:
 *   format: json
 * notes:
 *   pii: "Avoid customer personal data"
 * ---
 *
 * # System
 * You are a business research assistant...
 *
 * # User
 * Business: {{business_name}}
 * ```
 */

import type { PromptSpec } from './types.js';

/** Parse a complete prompt Markdown string into a PromptSpec. */
export function parsePromptMarkdown(raw: string): PromptSpec {
  const { frontmatter, body } = extractFrontmatter(raw);
  const meta = parseSimpleYaml(frontmatter);
  const sections = splitSections(body);

  const id = expectString(meta, 'id');
  const version = expectNumber(meta, 'version');

  const params = (meta.params ?? {}) as Record<string, unknown>;
  const inputs = (meta.inputs ?? {}) as Record<string, unknown>;
  const outputs = (meta.outputs ?? {}) as Record<string, unknown>;
  const notes = (meta.notes ?? {}) as Record<string, unknown>;

  return {
    id,
    version,
    variant: meta.variant != null ? String(meta.variant) : undefined,
    description: String(meta.description ?? ''),
    models: asStringArray(meta.models),
    params: {
      temperature: Number(params.temperature ?? 0.3),
      maxTokens: Number(params.max_tokens ?? 4096),
    },
    inputs: {
      required: asStringArray(inputs.required),
      optional: asStringArray(inputs.optional),
    },
    outputs: {
      format: String(outputs.format ?? 'text') as PromptSpec['outputs']['format'],
      schema: outputs.schema != null ? String(outputs.schema) : undefined,
    },
    notes: Object.fromEntries(Object.entries(notes).map(([k, v]) => [k, String(v)])),
    system: sections.system,
    user: sections.user,
  };
}

/** Extract YAML frontmatter and body from a raw Markdown string. */
export function extractFrontmatter(raw: string): { frontmatter: string; body: string } {
  const trimmed = raw.trim();

  if (!trimmed.startsWith('---')) {
    throw new Error('Prompt file must start with YAML frontmatter (---)');
  }

  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    throw new Error('Prompt file has unclosed YAML frontmatter');
  }

  const frontmatter = trimmed.substring(4, endIndex).trim();
  const body = trimmed.substring(endIndex + 4).trim();

  return { frontmatter, body };
}

/** Split the body into # System and # User sections. */
export function splitSections(body: string): { system: string; user: string } {
  const systemMatch = body.match(/^#\s+System\s*\n/im);
  const userMatch = body.match(/^#\s+User\s*\n/im);

  if (!systemMatch) {
    throw new Error('Prompt body must contain a "# System" section');
  }
  if (!userMatch) {
    throw new Error('Prompt body must contain a "# User" section');
  }

  const systemStart = (systemMatch.index ?? 0) + systemMatch[0].length;
  const userStart = (userMatch.index ?? 0) + userMatch[0].length;

  // System section ends where User section heading begins
  const systemEnd = userMatch.index ?? body.length;
  const system = body.substring(systemStart, systemEnd).trim();
  const user = body.substring(userStart).trim();

  return { system, user };
}

/**
 * Minimal YAML parser for our prompt frontmatter subset.
 *
 * Supports:
 * - Scalars: `key: value`, `key: "quoted value"`
 * - Inline arrays: `key: [a, b, c]`
 * - Block arrays: `key:\n  - item1\n  - item2`
 * - One-level nested objects: `key:\n  sub_key: value`
 * - Nested objects with inline arrays: `key:\n  sub_key: [a, b]`
 */
export function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    // Must be a top-level key: value
    const topMatch = line.match(/^([\w][\w_]*)\s*:\s*(.*)/);
    if (!topMatch) {
      i++;
      continue;
    }

    const key = topMatch[1];
    const inlineValue = topMatch[2].trim();

    if (inlineValue.startsWith('[') && inlineValue.endsWith(']')) {
      // Inline array: [a, b, c]
      result[key] = parseInlineArray(inlineValue);
      i++;
    } else if (inlineValue !== '') {
      // Simple scalar value
      result[key] = parseYamlScalar(inlineValue);
      i++;
    } else {
      // Empty value — look ahead for indented children
      i++;
      const children: string[] = [];
      while (i < lines.length) {
        const nextLine = lines[i];
        if (nextLine.trim() === '' || /^\s+/.test(nextLine)) {
          if (nextLine.trim()) {
            children.push(nextLine);
          }
          i++;
        } else {
          break;
        }
      }

      if (children.length === 0) {
        result[key] = null;
      } else if (children[0].trim().startsWith('- ')) {
        // Block array
        result[key] = children
          .filter((c) => c.trim().startsWith('- '))
          .map((c) => parseYamlScalar(c.trim().substring(2).trim()));
      } else {
        // Nested object (one level deep)
        const obj: Record<string, unknown> = {};
        for (const child of children) {
          const childMatch = child.trim().match(/^([\w][\w_]*)\s*:\s*(.*)/);
          if (childMatch) {
            const childVal = childMatch[2].trim();
            if (childVal.startsWith('[') && childVal.endsWith(']')) {
              obj[childMatch[1]] = parseInlineArray(childVal);
            } else {
              obj[childMatch[1]] = parseYamlScalar(childVal);
            }
          }
        }
        result[key] = obj;
      }
    }
  }

  return result;
}

/** Parse an inline YAML array: `[a, b, "c d"]` */
function parseInlineArray(value: string): unknown[] {
  const inner = value.slice(1, -1).trim();
  if (inner === '') return [];

  const items: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of inner) {
    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = true;
      quoteChar = ch;
      current += ch;
    } else if (inQuote && ch === quoteChar) {
      inQuote = false;
      current += ch;
    } else if (!inQuote && ch === ',') {
      items.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    items.push(current.trim());
  }

  return items.map((s) => parseYamlScalar(s));
}

/** Parse a single YAML scalar value. */
export function parseYamlScalar(value: string): string | number | boolean | null {
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Quoted string
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Number
  const num = Number(value);
  if (value !== '' && !isNaN(num)) return num;

  return value;
}

// ── Helpers ──────────────────────────────────────────────────

function expectString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  if (val == null) throw new Error(`Prompt frontmatter missing required field: ${key}`);
  return String(val);
}

function expectNumber(obj: Record<string, unknown>, key: string): number {
  const val = obj[key];
  if (val == null) throw new Error(`Prompt frontmatter missing required field: ${key}`);
  const n = Number(val);
  if (isNaN(n)) throw new Error(`Prompt frontmatter field "${key}" must be a number`);
  return n;
}

function asStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  return [];
}
