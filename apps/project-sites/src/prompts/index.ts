/**
 * Prompt infrastructure — public API.
 *
 * Usage:
 *   import { registry, renderer, schemas, observability } from './prompts/index.js';
 *
 *   // Register prompts at startup
 *   registry.registerAll(allPrompts);
 *
 *   // Resolve and render
 *   const spec = registry.resolve('research_business', 2)!;
 *   const { system, user, model, params } = renderer.renderPrompt(spec, inputs);
 *
 *   // Validate inputs
 *   const validated = schemas.validatePromptInput('research_business', rawInputs);
 *
 *   // Call LLM with observability
 *   const { result, log } = await observability.withObservability(spec, model, inputs, 0, callFn);
 */

export * as types from './types.js';
export * as parser from './parser.js';
export * as renderer from './renderer.js';
export * as schemas from './schemas.js';
export * as observability from './observability.js';
export * as registry from './registry.js';

// Re-export commonly used types
export type { PromptSpec, LlmCallResult, LlmCallLog, PromptKey } from './types.js';
export type { RenderedPrompt, RenderOptions } from './renderer.js';
