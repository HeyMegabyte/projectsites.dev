/**
 * Tests for the ai_workflows module.
 *
 * Validates that runPrompt, researchBusiness, generateSiteHtml,
 * scoreQuality, generateSiteCopy, and runSiteGenerationWorkflow
 * correctly orchestrate prompt resolution, rendering, AI calls,
 * and output parsing.
 *
 * The Workers AI binding (env.AI.run) is mocked to return appropriate
 * fixture responses for each prompt type.
 */

import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  (globalThis as any).crypto = webcrypto;
}

import type { Env } from '../types/env.js';
import {
  runPrompt,
  researchBusiness,
  generateSiteHtml,
  scoreQuality,
  generateSiteCopy,
  runSiteGenerationWorkflow,
  registerAllPrompts,
} from '../services/ai_workflows.js';
import { clearRegistry, getStats } from '../prompts/registry.js';

// ─── Mock AI Responses ───────────────────────────────────────────

const MOCK_RESEARCH_RESPONSE = JSON.stringify({
  business_name: "Mario's Ristorante",
  tagline: 'Authentic Italian since 1985',
  description:
    'A family-owned Italian restaurant serving traditional recipes passed down through generations.',
  services: ['Dine-in', 'Takeout', 'Catering', 'Private Events'],
  hours: [
    { day: 'Monday-Thursday', hours: '11am-9pm' },
    { day: 'Friday-Saturday', hours: '11am-10pm' },
    { day: 'Sunday', hours: '12pm-8pm' },
  ],
  faq: [
    { question: 'Do you accept reservations?', answer: 'Yes, call us or book online.' },
    { question: 'Is parking available?', answer: 'Free parking behind the building.' },
    { question: 'Gluten-free options?', answer: 'Yes, ask for our GF menu.' },
  ],
  seo_title: "Mario's Ristorante - Italian Dining",
  seo_description:
    'Family-owned Italian restaurant. Dine-in, takeout, catering. Traditional recipes since 1985.',
});

const MOCK_HTML_RESPONSE =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Mario\'s Ristorante</title></head>' +
  '<body><header><h1>Mario\'s Ristorante</h1></header><main><section id="hero"><h2>Authentic Italian since 1985</h2>' +
  '</section><section id="services"><h2>Our Services</h2></section></main></body></html>';

const MOCK_SCORE_RESPONSE = JSON.stringify({
  scores: {
    accuracy: 0.85,
    completeness: 0.9,
    professionalism: 0.88,
    seo: 0.75,
    accessibility: 0.7,
  },
  overall: 0.82,
  issues: ['Missing alt attributes on images'],
  suggestions: ['Add structured data markup'],
});

const MOCK_COPY_RESPONSE =
  "# Welcome to Mario's Ristorante\n\n" +
  '## Your Neighborhood Italian Kitchen in Boston\n\n' +
  '**Call Now** | **View Menu**\n\n' +
  '- Fresh ingredients daily\n' +
  '- Family recipes since 1985\n' +
  '- Private event hosting\n\n' +
  '### About Us\n\nWe are a family-owned restaurant...';

// ─── Mock Env ────────────────────────────────────────────────────

function createMockEnv(aiRunImpl?: jest.Mock): Env {
  const aiRun =
    aiRunImpl ??
    jest
      .fn()
      .mockImplementation(
        (_model: string, params: { messages: Array<{ role: string; content: string }> }) => {
          const userContent = params.messages.find((m) => m.role === 'user')?.content ?? '';

          // Route the mock response based on what appears in the user prompt
          if (userContent.includes('Research this business')) {
            return Promise.resolve({ response: MOCK_RESEARCH_RESPONSE });
          }
          if (userContent.includes('Generate the complete HTML website')) {
            return Promise.resolve({ response: MOCK_HTML_RESPONSE });
          }
          if (userContent.includes('Score the following website HTML')) {
            return Promise.resolve({ response: MOCK_SCORE_RESPONSE });
          }
          if (userContent.includes('Hero headline') || userContent.includes('benefit-led')) {
            return Promise.resolve({ response: MOCK_COPY_RESPONSE });
          }

          return Promise.resolve({ response: '{}' });
        },
      );

  return {
    AI: { run: aiRun },
    ENVIRONMENT: 'test',
    CACHE_KV: {} as any,
    PROMPT_STORE: {} as any,
    DB: {} as any,
    SITES_BUCKET: {} as any,
    QUEUE: {} as any,
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_xxx',
    STRIPE_WEBHOOK_SECRET: 'whsec_xxx',
    CF_API_TOKEN: 'test-cf-token',
    CF_ZONE_ID: 'test-zone-id',
    SENDGRID_API_KEY: 'SG.test',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_PLACES_API_KEY: 'test-places-key',
    SENTRY_DSN: 'https://test@sentry.io/123',
    POSTHOG_API_KEY: 'phc_test',
  } as unknown as Env;
}

// ─── Test Suite ──────────────────────────────────────────────────

beforeEach(() => {
  clearRegistry();
  registerAllPrompts();
});

describe('registerAllPrompts', () => {
  it('populates the registry with all prompts', () => {
    // clearRegistry + registerAllPrompts already called in beforeEach
    const stats = getStats();

    // 5 legacy + 8 v2 = 13 prompts, legacy has 4 unique IDs + 8 v2 = 12 unique
    expect(stats.totalPrompts).toBe(13);
    expect(stats.uniqueIds).toBe(12);
  });

  it('configures variant weights for site_copy', () => {
    const stats = getStats();

    expect(stats.variantConfigs).toBe(1);
  });

  it('is idempotent when called multiple times', () => {
    registerAllPrompts(); // call a second time
    const stats = getStats();

    // registerAll overwrites existing keys, so counts stay the same
    expect(stats.totalPrompts).toBe(13);
    expect(stats.uniqueIds).toBe(12);
  });
});

describe('runPrompt', () => {
  it('calls AI.run and returns an LlmCallResult for research_business', async () => {
    const env = createMockEnv();
    const result = await runPrompt(env, 'research_business', 2, {
      business_name: 'Test Biz',
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe(MOCK_RESEARCH_RESPONSE);
    expect(result.promptId).toBe('research_business');
    expect(result.promptVersion).toBe(2);
    expect(result.model).toBe('@cf/meta/llama-3.1-70b-instruct');
    expect(typeof result.latencyMs).toBe('number');
    expect(env.AI.run).toHaveBeenCalledTimes(1);
  });

  it('throws for an unknown prompt ID', async () => {
    const env = createMockEnv();

    await expect(runPrompt(env, 'nonexistent_prompt', 1, { foo: 'bar' })).rejects.toThrow(
      'Prompt not found: nonexistent_prompt@1',
    );
  });

  it('throws for a valid prompt ID but wrong version', async () => {
    const env = createMockEnv();

    await expect(
      runPrompt(env, 'research_business', 99, { business_name: 'Test' }),
    ).rejects.toThrow('Prompt not found: research_business@99');
  });

  it('passes rendered messages to AI.run with correct structure', async () => {
    const env = createMockEnv();
    await runPrompt(env, 'research_business', 2, {
      business_name: 'Acme Corp',
    });

    const callArgs = (env.AI.run as jest.Mock).mock.calls[0];
    expect(callArgs[0]).toBe('@cf/meta/llama-3.1-70b-instruct');

    const payload = callArgs[1];
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[0].role).toBe('system');
    expect(payload.messages[1].role).toBe('user');
    expect(payload.messages[1].content).toContain('Acme Corp');
    expect(typeof payload.temperature).toBe('number');
    expect(typeof payload.max_tokens).toBe('number');
  });
});

describe('researchBusiness', () => {
  it('calls AI and returns a parsed ResearchResult', async () => {
    const env = createMockEnv();
    const result = await researchBusiness(env, {
      businessName: "Mario's Ristorante",
    });

    expect(result.businessName).toBe("Mario's Ristorante");
    expect(result.tagline).toBe('Authentic Italian since 1985');
    expect(result.services).toEqual(['Dine-in', 'Takeout', 'Catering', 'Private Events']);
    expect(result.hours).toHaveLength(3);
    expect(result.faq).toHaveLength(3);
    expect(result.seoTitle).toBeTruthy();
    expect(result.seoDescription).toBeTruthy();
  });

  it('passes optional fields to the prompt', async () => {
    const env = createMockEnv();
    await researchBusiness(env, {
      businessName: 'Test Biz',
      businessPhone: '555-0000',
      businessAddress: '123 Main St',
      googlePlaceId: 'ChIJabc123',
      additionalContext: 'Open late on weekends',
    });

    const callArgs = (env.AI.run as jest.Mock).mock.calls[0];
    const userContent = callArgs[1].messages[1].content;
    expect(userContent).toContain('Test Biz');
    expect(userContent).toContain('555-0000');
    expect(userContent).toContain('123 Main St');
    expect(userContent).toContain('ChIJabc123');
    expect(userContent).toContain('Open late on weekends');
  });
});

describe('generateSiteHtml', () => {
  it('calls AI and returns HTML string', async () => {
    const env = createMockEnv();
    const researchData = {
      businessName: "Mario's Ristorante",
      tagline: 'Authentic Italian since 1985',
      description: 'Family-owned Italian restaurant.',
      services: ['Dine-in', 'Takeout', 'Catering'],
      hours: [{ day: 'Mon-Fri', hours: '11am-9pm' }],
      faq: [
        { question: 'Reservations?', answer: 'Yes.' },
        { question: 'Parking?', answer: 'Yes.' },
        { question: 'GF options?', answer: 'Yes.' },
      ],
      seoTitle: "Mario's Ristorante",
      seoDescription: 'Italian dining in Boston.',
    };

    const html = await generateSiteHtml(env, researchData);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Mario');
    expect(env.AI.run).toHaveBeenCalledTimes(1);
  });
});

describe('scoreQuality', () => {
  it('calls AI and returns parsed QualityScore', async () => {
    const env = createMockEnv();
    const score = await scoreQuality(env, MOCK_HTML_RESPONSE);

    expect(score.scores.accuracy).toBe(0.85);
    expect(score.scores.completeness).toBe(0.9);
    expect(score.scores.professionalism).toBe(0.88);
    expect(score.scores.seo).toBe(0.75);
    expect(score.scores.accessibility).toBe(0.7);
    expect(score.overall).toBe(0.82);
    expect(score.issues).toContain('Missing alt attributes on images');
    expect(score.suggestions).toContain('Add structured data markup');
  });

  it('truncates HTML content to 4000 characters', async () => {
    const env = createMockEnv();
    const longHtml = '<!DOCTYPE html>' + 'x'.repeat(5000);

    await scoreQuality(env, longHtml);

    const callArgs = (env.AI.run as jest.Mock).mock.calls[0];
    const userContent = callArgs[1].messages[1].content;
    // The html_content should be truncated — the rendered user prompt
    // should not contain the full 5000+ char string
    expect(userContent.length).toBeLessThan(longHtml.length + 500);
  });
});

describe('generateSiteCopy', () => {
  it('calls AI with A/B variant selection using orgId seed', async () => {
    const env = createMockEnv();
    const result = await generateSiteCopy(
      env,
      {
        businessName: "Mario's Ristorante",
        city: 'Boston',
        services: ['Dine-in', 'Catering'],
        tone: 'friendly',
      },
      'org_12345',
    );

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(env.AI.run).toHaveBeenCalledTimes(1);
  });

  it('works without an orgId (no variant selection)', async () => {
    const env = createMockEnv();
    const result = await generateSiteCopy(env, {
      businessName: 'Quick Fix Plumbing',
      city: 'Denver',
      services: ['Repairs'],
      tone: 'no-nonsense',
    });

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('runSiteGenerationWorkflow', () => {
  it('runs research, generate, and score steps in sequence', async () => {
    const env = createMockEnv();
    const result = await runSiteGenerationWorkflow(env, {
      businessName: "Mario's Ristorante",
    });

    // Verify all three steps produced results
    expect(result.research.businessName).toBe("Mario's Ristorante");
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.quality.overall).toBe(0.82);

    // AI.run should have been called 3 times (research, generate, score)
    expect(env.AI.run).toHaveBeenCalledTimes(3);
  });

  it('passes optional fields through to researchBusiness', async () => {
    const env = createMockEnv();
    await runSiteGenerationWorkflow(env, {
      businessName: 'Test Biz',
      businessPhone: '555-1111',
      businessAddress: '1 Test St',
      googlePlaceId: 'ChIJtest',
    });

    // First AI.run call should be research_business
    const firstCallArgs = (env.AI.run as jest.Mock).mock.calls[0];
    const userContent = firstCallArgs[1].messages[1].content;
    expect(userContent).toContain('Test Biz');
    expect(userContent).toContain('555-1111');
    expect(userContent).toContain('1 Test St');
    expect(userContent).toContain('ChIJtest');
  });
});
