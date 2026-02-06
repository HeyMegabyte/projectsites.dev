/**
 * Prompt evaluation suite — lightweight tests that validate prompt quality
 * without calling an LLM.
 *
 * For each registered prompt:
 *   1. Resolve the prompt from the registry
 *   2. Validate fixture inputs pass Zod schema
 *   3. Render with fixture inputs and verify:
 *      - System prompt is non-empty
 *      - User prompt contains the input values
 *      - No unresolved {{placeholders}} remain
 *   4. Validate template placeholders match declared inputs
 */

import { registerAllPrompts } from '../services/ai_workflows.js';
import { clearRegistry, resolve, listAll } from '../prompts/registry.js';
import { renderPrompt } from '../prompts/renderer.js';
import { validateTemplatePlaceholders } from '../prompts/renderer.js';
import { validatePromptInput } from '../prompts/schemas.js';
import type { PromptSpec } from '../prompts/types.js';

// ─── Fixtures ────────────────────────────────────────────────────

const RESEARCH_BUSINESS_FIXTURES = [
  { business_name: "Mario's Ristorante" },
  {
    business_name: 'Quick Fix Plumbing',
    business_phone: '555-1234',
    business_address: '100 Main St, Denver, CO',
  },
  {
    business_name: 'Grace Community Church',
    additional_context: 'Non-denominational, Sunday services at 9am and 11am',
  },
  { business_name: 'Bright Smile Dentistry', google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4' },
  { business_name: 'Serenity Yoga Studio', business_address: '42 Lotus Lane, Austin, TX' },
  {
    business_name: 'Precision Auto Repair',
    business_phone: '555-9876',
    additional_context: 'Specializes in European imports',
  },
  { business_name: 'Chen & Associates Law Firm', business_address: '500 Justice Blvd, Suite 200' },
  {
    business_name: 'Sweet Crumbs Bakery',
    additional_context: 'Gluten-free options available, custom cakes',
  },
  { business_name: 'Glamour Nails & Spa', business_phone: '555-4567' },
  { business_name: 'Happy Tails Dog Grooming', business_address: '88 Bark Ave, Portland, OR' },
];

const MOCK_RESEARCH_DATA = JSON.stringify({
  business_name: "Mario's Ristorante",
  tagline: 'Authentic Italian dining since 1985',
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
    { question: 'Is there parking available?', answer: 'Free parking lot behind the building.' },
    {
      question: 'Do you offer gluten-free options?',
      answer: 'Yes, ask your server for our GF menu.',
    },
  ],
  seo_title: "Mario's Ristorante - Authentic Italian Dining",
  seo_description:
    'Family-owned Italian restaurant serving traditional recipes. Dine-in, takeout, catering available.',
});

const GENERATE_SITE_FIXTURES = [
  { research_data: MOCK_RESEARCH_DATA },
  {
    research_data: JSON.stringify({
      business_name: 'Quick Fix Plumbing',
      tagline: 'Fast, reliable plumbing solutions',
      description: 'Professional plumbing services for residential and commercial customers.',
      services: ['Emergency Repairs', 'Drain Cleaning', 'Water Heater Installation'],
      hours: [
        { day: 'Monday-Friday', hours: '7am-6pm' },
        { day: 'Saturday', hours: '8am-2pm' },
      ],
      faq: [
        {
          question: 'Do you offer emergency service?',
          answer: 'Yes, 24/7 emergency calls available.',
        },
        { question: 'Are you licensed?', answer: 'Fully licensed and insured.' },
        { question: 'Do you give free estimates?', answer: 'Yes, for all non-emergency work.' },
      ],
      seo_title: 'Quick Fix Plumbing - Fast Reliable Service',
      seo_description:
        'Professional plumbing for homes and businesses. Emergency service available 24/7.',
    }),
  },
  {
    research_data: JSON.stringify({
      business_name: 'Bright Smile Dentistry',
      tagline: 'Your smile, our passion',
      description: 'Comprehensive dental care for the whole family.',
      services: ['Cleanings', 'Fillings', 'Whitening', 'Invisalign', 'Implants'],
      hours: [{ day: 'Monday-Friday', hours: '8am-5pm' }],
      faq: [
        { question: 'Do you accept insurance?', answer: 'We accept most major dental plans.' },
        { question: 'Is there a cancellation fee?', answer: 'Please provide 24 hours notice.' },
        { question: 'Do you see children?', answer: 'Yes, we welcome patients of all ages.' },
      ],
      seo_title: 'Bright Smile Dentistry - Family Dental Care',
      seo_description:
        'Comprehensive dental care for the whole family. Cleanings, whitening, Invisalign and more.',
    }),
  },
];

const SCORE_QUALITY_FIXTURES = [
  {
    html_content:
      '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>',
  },
  {
    html_content:
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Bakery</title></head><body><main><section><h1>Sweet Crumbs</h1><p>Fresh baked daily</p></section></main></body></html>',
  },
  {
    html_content:
      '<html><body><div class="hero"><h1>Welcome</h1></div><div class="services"><h2>Our Services</h2><ul><li>Service A</li></ul></div></body></html>',
  },
  {
    html_content:
      '<!DOCTYPE html><html><head><title>Law Firm</title><style>body{font-family:sans-serif}</style></head><body><header><nav>Home About Contact</nav></header><main><h1>Chen & Associates</h1></main></body></html>',
  },
  {
    html_content:
      '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><title>Yoga Studio</title></head><body><section id="hero"><h1>Find Your Peace</h1><a href="#contact">Book Now</a></section></body></html>',
  },
];

const SITE_COPY_FIXTURES = [
  {
    businessName: "Mario's Ristorante",
    city: 'Boston',
    services: ['Dine-in', 'Catering'],
    tone: 'friendly' as const,
  },
  {
    businessName: 'Quick Fix Plumbing',
    city: 'Denver',
    services: ['Emergency Repairs', 'Drain Cleaning'],
    tone: 'no-nonsense' as const,
  },
  {
    businessName: 'Bright Smile Dentistry',
    city: 'Austin',
    services: ['Cleanings', 'Whitening'],
    tone: 'premium' as const,
  },
  {
    businessName: 'Serenity Yoga Studio',
    city: 'Portland',
    services: ['Vinyasa', 'Meditation', 'Prenatal Yoga'],
    tone: 'friendly' as const,
  },
  {
    businessName: 'Chen & Associates',
    city: 'Chicago',
    services: ['Business Law', 'Estate Planning'],
    tone: 'premium' as const,
  },
  {
    businessName: 'Happy Tails Grooming',
    city: 'Seattle',
    services: ['Baths', 'Haircuts', 'Nail Trimming'],
    tone: 'friendly' as const,
  },
  {
    businessName: 'Precision Auto Repair',
    city: 'Dallas',
    services: ['Oil Change', 'Brake Service', 'Engine Diagnostics'],
    tone: 'no-nonsense' as const,
  },
  {
    businessName: 'Sweet Crumbs Bakery',
    city: 'San Francisco',
    services: ['Custom Cakes', 'Pastries', 'Bread'],
    tone: 'friendly' as const,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────

/** Check that a rendered string has no unresolved {{placeholder}} patterns. */
function hasNoUnresolvedPlaceholders(text: string): boolean {
  return !/\{\{\w+\}\}/.test(text);
}

// ─── Test Suite ──────────────────────────────────────────────────

beforeEach(() => {
  clearRegistry();
  registerAllPrompts();
});

describe('prompt eval: registry integrity', () => {
  it('registers all expected prompt IDs', () => {
    const allSpecs = listAll();
    const ids = new Set(allSpecs.map((s) => s.id));

    expect(ids).toContain('research_business');
    expect(ids).toContain('generate_site');
    expect(ids).toContain('score_quality');
    expect(ids).toContain('site_copy');
  });

  it('registers the correct number of prompt specs (including variants)', () => {
    const allSpecs = listAll();
    // 4 base prompts + 1 site_copy variant b = 5 total
    expect(allSpecs.length).toBe(5);
  });

  it('every registered prompt has valid template placeholders', () => {
    const allSpecs = listAll();

    for (const spec of allSpecs) {
      const undeclared = validateTemplatePlaceholders(spec);
      expect(undeclared).toEqual([]);
    }
  });
});

describe('prompt eval: research_business', () => {
  let spec: PromptSpec;

  beforeEach(() => {
    spec = resolve('research_business', 2)!;
  });

  it('resolves from registry at version 2', () => {
    expect(spec).toBeDefined();
    expect(spec.id).toBe('research_business');
    expect(spec.version).toBe(2);
  });

  it('has non-empty system and user templates', () => {
    expect(spec.system.length).toBeGreaterThan(0);
    expect(spec.user.length).toBeGreaterThan(0);
  });

  it('system prompt mentions JSON output format', () => {
    expect(spec.system).toContain('JSON');
  });

  it.each(RESEARCH_BUSINESS_FIXTURES)('validates fixture input: $business_name', (fixture) => {
    const validated = validatePromptInput('research_business', fixture);
    expect(validated).toHaveProperty('business_name');
  });

  it.each(RESEARCH_BUSINESS_FIXTURES)(
    'renders without unresolved placeholders: $business_name',
    (fixture) => {
      const validated = validatePromptInput('research_business', fixture) as Record<
        string,
        unknown
      >;
      const stringInputs: Record<string, string> = {};
      for (const [k, v] of Object.entries(validated)) {
        stringInputs[k] = String(v ?? '');
      }

      const rendered = renderPrompt(spec, stringInputs, { safeDelimit: false });

      expect(rendered.system.length).toBeGreaterThan(0);
      expect(rendered.user).toContain(String(fixture.business_name));
      expect(hasNoUnresolvedPlaceholders(rendered.system)).toBe(true);
      expect(hasNoUnresolvedPlaceholders(rendered.user)).toBe(true);
    },
  );

  it('rejects empty business_name', () => {
    expect(() => validatePromptInput('research_business', { business_name: '' })).toThrow();
  });

  it('rejects missing business_name', () => {
    expect(() => validatePromptInput('research_business', {})).toThrow();
  });
});

describe('prompt eval: generate_site', () => {
  let spec: PromptSpec;

  beforeEach(() => {
    spec = resolve('generate_site', 2)!;
  });

  it('resolves from registry at version 2', () => {
    expect(spec).toBeDefined();
    expect(spec.id).toBe('generate_site');
    expect(spec.version).toBe(2);
  });

  it('system prompt mentions HTML and DOCTYPE', () => {
    expect(spec.system).toContain('HTML');
    expect(spec.system).toContain('DOCTYPE');
  });

  it.each(GENERATE_SITE_FIXTURES)('validates and renders fixture input #%#', (fixture) => {
    const validated = validatePromptInput('generate_site', fixture) as Record<string, unknown>;
    const stringInputs: Record<string, string> = {};
    for (const [k, v] of Object.entries(validated)) {
      stringInputs[k] = String(v ?? '');
    }

    const rendered = renderPrompt(spec, stringInputs, { safeDelimit: false });

    expect(rendered.system.length).toBeGreaterThan(0);
    expect(rendered.user).toContain('business_name');
    expect(hasNoUnresolvedPlaceholders(rendered.system)).toBe(true);
    expect(hasNoUnresolvedPlaceholders(rendered.user)).toBe(true);
  });

  it('rejects empty research_data', () => {
    expect(() => validatePromptInput('generate_site', { research_data: '' })).toThrow();
  });
});

describe('prompt eval: score_quality', () => {
  let spec: PromptSpec;

  beforeEach(() => {
    spec = resolve('score_quality', 2)!;
  });

  it('resolves from registry at version 2', () => {
    expect(spec).toBeDefined();
    expect(spec.id).toBe('score_quality');
    expect(spec.version).toBe(2);
  });

  it('system prompt mentions scoring dimensions', () => {
    expect(spec.system).toContain('accuracy');
    expect(spec.system).toContain('completeness');
    expect(spec.system).toContain('seo');
  });

  it.each(SCORE_QUALITY_FIXTURES)('validates and renders HTML fixture #%#', (fixture) => {
    const validated = validatePromptInput('score_quality', fixture) as Record<string, unknown>;
    const stringInputs: Record<string, string> = {};
    for (const [k, v] of Object.entries(validated)) {
      stringInputs[k] = String(v ?? '');
    }

    const rendered = renderPrompt(spec, stringInputs, { safeDelimit: false });

    expect(rendered.system.length).toBeGreaterThan(0);
    expect(rendered.user).toContain(fixture.html_content);
    expect(hasNoUnresolvedPlaceholders(rendered.system)).toBe(true);
    expect(hasNoUnresolvedPlaceholders(rendered.user)).toBe(true);
  });

  it('rejects empty html_content', () => {
    expect(() => validatePromptInput('score_quality', { html_content: '' })).toThrow();
  });
});

describe('prompt eval: site_copy', () => {
  let spec: PromptSpec;

  beforeEach(() => {
    spec = resolve('site_copy', 3)!;
  });

  it('resolves from registry at version 3', () => {
    expect(spec).toBeDefined();
    expect(spec.id).toBe('site_copy');
    expect(spec.version).toBe(3);
  });

  it('system prompt mentions tone guide', () => {
    expect(spec.system).toContain('friendly');
    expect(spec.system).toContain('premium');
    expect(spec.system).toContain('no-nonsense');
  });

  it.each(SITE_COPY_FIXTURES)(
    'validates and renders fixture: $businessName in $city ($tone)',
    (fixture) => {
      const validated = validatePromptInput('site_copy', fixture) as Record<string, unknown>;
      const stringInputs: Record<string, string> = {};
      for (const [k, v] of Object.entries(validated)) {
        stringInputs[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
      }

      const rendered = renderPrompt(spec, stringInputs, { safeDelimit: false });

      expect(rendered.system.length).toBeGreaterThan(0);
      expect(rendered.user).toContain(fixture.businessName);
      expect(rendered.user).toContain(fixture.city);
      expect(rendered.user).toContain(fixture.tone);
      expect(hasNoUnresolvedPlaceholders(rendered.system)).toBe(true);
      expect(hasNoUnresolvedPlaceholders(rendered.user)).toBe(true);
    },
  );

  it('rejects missing required fields', () => {
    expect(() => validatePromptInput('site_copy', { businessName: 'Test' })).toThrow();
  });

  it('rejects invalid tone value', () => {
    expect(() =>
      validatePromptInput('site_copy', {
        businessName: 'Test',
        city: 'NYC',
        services: [],
        tone: 'aggressive',
      }),
    ).toThrow();
  });
});

describe('prompt eval: site_copy variant b', () => {
  it('has a variant b registered with benefit-led instructions', () => {
    const allSpecs = listAll();
    const variantB = allSpecs.find((s) => s.id === 'site_copy' && s.variant === 'b');

    expect(variantB).toBeDefined();
    expect(variantB!.system).toContain('benefit');
    expect(variantB!.system).toContain('BENEFIT');
  });

  it('variant b renders correctly with fixture inputs', () => {
    const allSpecs = listAll();
    const variantB = allSpecs.find((s) => s.id === 'site_copy' && s.variant === 'b')!;
    const fixture = SITE_COPY_FIXTURES[0];
    const validated = validatePromptInput('site_copy', fixture) as Record<string, unknown>;
    const stringInputs: Record<string, string> = {};
    for (const [k, v] of Object.entries(validated)) {
      stringInputs[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
    }

    const rendered = renderPrompt(variantB, stringInputs, { safeDelimit: false });

    expect(rendered.system.length).toBeGreaterThan(0);
    expect(rendered.user).toContain(fixture.businessName);
    expect(hasNoUnresolvedPlaceholders(rendered.system)).toBe(true);
    expect(hasNoUnresolvedPlaceholders(rendered.user)).toBe(true);
  });

  it('variant b has valid template placeholders', () => {
    const allSpecs = listAll();
    const variantB = allSpecs.find((s) => s.id === 'site_copy' && s.variant === 'b')!;
    const undeclared = validateTemplatePlaceholders(variantB);

    expect(undeclared).toEqual([]);
  });
});
