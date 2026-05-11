/**
 * Guards the L10 Template-First Construction directive in buildPrompt().
 * If anyone weakens this language, builds drift back to from-scratch
 * generation, which inflates build time + token cost and produces
 * inconsistent visuals across sites. Brian's explicit ask: "Make sure it
 * mostly uses the template to construct the websites."
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const WORKFLOW_PATH = join(__dirname, '..', 'workflows', 'site-generation.ts');
const SOURCE = readFileSync(WORKFLOW_PATH, 'utf-8');

describe('L10 Template-First Construction directive', () => {
  it('declares L10 as a build-breaking section', () => {
    expect(SOURCE).toMatch(/L10 — Template-First Construction.*BUILD-BREAKING/);
  });

  it('mandates `cp -r ~/template/.` as step-1 of customize', () => {
    expect(SOURCE).toMatch(/cp -r ~\/template\/\.\s*<build dir>\//);
  });

  it('forbids recreating template-shipped primitives', () => {
    expect(SOURCE).toMatch(/Do NOT recreate Button\/Card\/Section\/Hero\/Nav\/Footer/);
    expect(SOURCE).toMatch(/do NOT recreate Button\/Card\/Hero\/Nav\/Footer/);
  });

  it('locks vite/tailwind/postcss/package configs against rewrite', () => {
    expect(SOURCE).toMatch(/Forbidden:.*vite\.config\.ts.*tailwind\.config\.ts.*postcss\.config\.js.*package\.json/s);
  });

  it('requires _template_audit.json with from-scratch refactor gate', () => {
    expect(SOURCE).toContain('_template_audit.json');
    expect(SOURCE).toContain('from_scratch_components');
    expect(SOURCE).toMatch(/refactor to use template equivalents BEFORE/);
  });

  it('treats brand customization as a token swap, not a rewrite', () => {
    expect(SOURCE).toMatch(/TOKEN SWAP, not a rewrite/);
  });
});
