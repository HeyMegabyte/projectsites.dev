/**
 * Safe template renderer for prompt variables.
 *
 * Renders `{{variable}}` placeholders with validated input values.
 * User-provided text is delimited with markers so it cannot
 * escape into instruction space.
 */

import type { PromptSpec } from './types.js';

/** Delimiter wrapping for user-provided values to prevent injection. */
const INPUT_DELIM_OPEN = '<<<USER_INPUT>>>';
const INPUT_DELIM_CLOSE = '<<<END_USER_INPUT>>>';

export interface RenderOptions {
  /** Wrap user values in delimiters to prevent prompt injection (default: true) */
  safeDelimit?: boolean;

  /** Strip unresolved {{placeholders}} instead of throwing (default: false) */
  stripUnresolved?: boolean;
}

export interface RenderedPrompt {
  system: string;
  user: string;
  model: string;
  params: { temperature: number; maxTokens: number };
}

/**
 * Render a PromptSpec with the given input values.
 *
 * - Validates all required inputs are present.
 * - Replaces `{{key}}` placeholders with values.
 * - Wraps user input in delimiters by default (prevents injection).
 * - Throws on missing required inputs (unless stripUnresolved=true).
 */
export function renderPrompt(
  spec: PromptSpec,
  inputs: Record<string, string | undefined>,
  options: RenderOptions = {},
): RenderedPrompt {
  const { safeDelimit = true, stripUnresolved = false } = options;

  // Validate required inputs
  const missing = spec.inputs.required.filter((key) => !inputs[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required prompt inputs for "${spec.id}@${spec.version}": ${missing.join(', ')}`,
    );
  }

  // Build replacement map
  const allKeys = [...spec.inputs.required, ...spec.inputs.optional];
  const replacements: Record<string, string> = {};
  for (const key of allKeys) {
    const raw = inputs[key] ?? '';
    replacements[key] = safeDelimit && raw ? `${INPUT_DELIM_OPEN}${raw}${INPUT_DELIM_CLOSE}` : raw;
  }

  // Render templates
  const system = renderTemplate(spec.system, replacements, stripUnresolved);
  const user = renderTemplate(spec.user, replacements, stripUnresolved);

  return {
    system,
    user,
    model: spec.models[0],
    params: { ...spec.params },
  };
}

/**
 * Replace `{{key}}` placeholders in a template string.
 * Unknown keys are left as-is (or stripped if stripUnresolved=true).
 */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
  stripUnresolved = false,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in values) {
      return values[key];
    }
    return stripUnresolved ? '' : match;
  });
}

/**
 * Extract all `{{key}}` placeholder names from a template string.
 */
export function extractPlaceholders(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  const keys = new Set<string>();
  for (const m of matches) {
    keys.add(m[1]);
  }
  return [...keys];
}

/**
 * Validate that a PromptSpec's templates use only declared input keys.
 * Returns an array of undeclared keys found in templates.
 */
export function validateTemplatePlaceholders(spec: PromptSpec): string[] {
  const declared = new Set([...spec.inputs.required, ...spec.inputs.optional]);
  const used = new Set([...extractPlaceholders(spec.system), ...extractPlaceholders(spec.user)]);

  const undeclared: string[] = [];
  for (const key of used) {
    if (!declared.has(key)) {
      undeclared.push(key);
    }
  }
  return undeclared;
}
