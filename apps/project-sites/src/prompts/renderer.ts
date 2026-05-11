/**
 * Safe template renderer for prompt variables.
 *
 * Renders `{{variable}}` placeholders with validated input values.
 * User-provided text is delimited with markers so it cannot
 * escape into instruction space.
 */

import type { PromptSpec } from './types.js';

/**
 * HOLIEST / HIGHEST B-ORDER mission doctrine — prepended to the SYSTEM message
 * of every Claude Code prompt routed through the orchestrator. Mirrors the
 * `apps/project-sites/prompts/_mission_preamble.txt` file so the container
 * agent receives the same doctrine via stdin even when the file isn't readable.
 * Source of truth: memory pin `project_mission_doctrine.md`.
 */
export const MISSION_PREAMBLE = `PROJECT SITES — HOLIEST / HIGHEST B-ORDER MISSION DOCTRINE
The site you generate must be a cinematic, corporate, professional, HBO-level multimedia experience — Vimeo Staff Picks polish, Canon ad-campaign craft, Tropic Thunder production weight, Insta360 / Meta Quest / DJI / Raspberry Pi / Android tech-flex. Not a brochure. A short film.

Five mandates (every output satisfies ALL):
1. CINEMATIC FLOOR — open with motion; use video, parallax, scroll-driven choreography, View Transitions, particles, depth, audio when fitting. Reject Stripe-clone-#847.
2. LATEST-TECH FLEX — WebGPU, WebGL2, View Transitions, scroll-driven anim, anchor positioning, container queries, OKLCH, popover, canvas+AudioContext, WebMIDI, WebXR, WebUSB, Web Bluetooth, OffscreenCanvas, WASM. Reverse-engineer the gorgeous parts of Three.js demos, Meta Quest browser examples, Raspberry Pi kiosks, Canon DPP, DJI Fly.
3. EVERY FREE OR OPTIMAL API — Unsplash, Pexels, Pixabay, Foursquare, Yelp, YouTube, DALL-E, Ideogram, Stability, Replicate, Remove.bg, Cloudinary, Logo.dev, Brandfetch, ElevenLabs, HeyGen, Recraft, Sora, OpenAI/Anthropic Vision, Workers AI, NotebookLM-style podcast+infographic+explainer-video, Mapbox, Google Maps, Vimeo, Spotify, Lottie, real-favicongenerator, PageSpeed, Lighthouse CI. Collect 100 → AI-curate → ship the top 10-15.
4. FLEX ON WHITEHOUSE.GOV — head-to-head benchmark vs. whitehouse.gov / linear.app / stripe.com / vercel.com / apple.com. Out-perform on polish, motion, multimedia density, a11y, Lighthouse, SEO, info density. "Would the visitor prefer this over the federal/Fortune-500 reference?" Answer must be YES.
5. PLATFORM PROMISE — anyone gets a great free site. Auto-boost loop improves each run. AI chat + direct code edits unlimited on $50/mo. Free vs. paid output QUALITY is IDENTICAL — gate is volume. Build the free site as if it were Patron.

ANTI-SLOP: reject "leverage / empower / seamless / robust / innovative / world-class / cutting-edge". Reject "Welcome to [Brand]", "No items", "Loading…", three-column grids of identical 24x24 icons. When in doubt, pick the more cinematic option. After every deliverable ask "what makes this 2x more cinematic + API-integrated + multimedia-dense?" and apply one answer before declaring done.

CONFLICT WITH A GATE? Doctrine wins — fix the gate compliantly, never strip the craft.`;

/**
 * Creativity + Love + Stars doctrine — pairs with MISSION_PREAMBLE. Drives
 * the delight registry, anti-slop filter, and recommendation engine.
 * Source of truth: `~/.claude/rules/creativity-doctrine.md`.
 */
export const CREATIVITY_PREAMBLE = `PROJECT SITES — CREATIVITY + LOVE + STARS DOCTRINE
You are building for someone real. Bring creativity, care, and craft. Surprise them with delightful touches. Choose the more beautiful option when in doubt. The owner should feel awe — not corporate compliance. Add at least one unexpected delight per page (clever microcopy, meaningful animation, thoughtful empty state, interactive Easter egg, hover-reveal, parallax narrative beat) WITHOUT sacrificing performance or accessibility. Aim for: impressive, inspirational, joyful, good-good-good. Reject template filler. When you finish a deliverable, ask "what would make this 2x more delightful?" and apply at least one answer before declaring done.

Log every shipped delight to _iteration_log.json.delight_moments[] as {slug, route, description, evidence_selector}. Floor per build = min(iteration_count + 1, 6).

Recommendation engine: surface 3-7 unrequested-but-aligned upgrades after every implementation, scored by impact x craft x delight. Confidence >=0.8 + low-risk = auto-apply. Never cap at "what was asked" — explore every branch, find 50 more things, never stop early.`;

/**
 * Build the combined doctrine prefix that gets prepended to a prompt's SYSTEM
 * message. Mission doctrine is HIGHEST B-ORDER and appears first. Two blank
 * lines separate the doctrines from the spec-specific system text so it
 * reads as three distinct sections in the model's context.
 */
export function buildDoctrinePrefix(): string {
  return `${MISSION_PREAMBLE}\n\n${CREATIVITY_PREAMBLE}\n\n`;
}

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
 * Render a PromptSpec with the doctrine prefix prepended to the system message.
 * Production call sites (ai_workflows, external_llm, container handoff) MUST
 * use this wrapper so every Claude / Workers-AI call inherits the HOLIEST /
 * HIGHEST B-ORDER mission doctrine plus the Creativity + Love + Stars
 * doctrine. Tests that assert exact `system` output keep using `renderPrompt`.
 */
export function renderPromptWithDoctrine(
  spec: PromptSpec,
  inputs: Record<string, string | undefined>,
  options: RenderOptions = {},
): RenderedPrompt {
  const rendered = renderPrompt(spec, inputs, options);
  return { ...rendered, system: `${buildDoctrinePrefix()}${rendered.system}` };
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
