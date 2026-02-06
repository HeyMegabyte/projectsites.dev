import { ZodError } from 'zod';
import {
  ResearchBusinessInput,
  ResearchBusinessOutput,
  GenerateSiteInput,
  GenerateSiteOutput,
  ScoreQualityInput,
  ScoreQualityOutput,
  SiteCopyInput,
  SiteCopyOutput,
  PROMPT_SCHEMAS,
  validatePromptInput,
  validatePromptOutput,
} from '../prompts/schemas.js';

// ── ResearchBusinessInput ────────────────────────────────────

describe('ResearchBusinessInput', () => {
  it('accepts valid full input', () => {
    const data = {
      business_name: 'Acme Corp',
      business_phone: '555-1234',
      business_address: '123 Main St',
      google_place_id: 'ChIJ...',
      additional_context: 'Open since 2020',
    };
    const result = ResearchBusinessInput.parse(data);
    expect(result.business_name).toBe('Acme Corp');
    expect(result.business_phone).toBe('555-1234');
  });

  it('accepts minimal input with just business_name', () => {
    const result = ResearchBusinessInput.parse({ business_name: 'Solo Shop' });
    expect(result.business_name).toBe('Solo Shop');
  });

  it('rejects missing business_name', () => {
    expect(() => ResearchBusinessInput.parse({})).toThrow(ZodError);
  });

  it('defaults optional fields to empty string', () => {
    const result = ResearchBusinessInput.parse({ business_name: 'Defaults Inc' });
    expect(result.business_phone).toBe('');
    expect(result.business_address).toBe('');
    expect(result.google_place_id).toBe('');
    expect(result.additional_context).toBe('');
  });
});

// ── ResearchBusinessOutput ───────────────────────────────────

describe('ResearchBusinessOutput', () => {
  const validOutput = {
    business_name: 'Acme Corp',
    tagline: 'We deliver excellence',
    description: 'A full-service company.',
    services: ['Service A', 'Service B', 'Service C'],
    hours: [{ day: 'Monday', hours: '9-5' }],
    faq: [
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
      { question: 'Q3', answer: 'A3' },
    ],
    seo_title: 'Acme Corp - Excellence',
    seo_description: 'Best company for your needs.',
  };

  it('accepts valid output', () => {
    const result = ResearchBusinessOutput.parse(validOutput);
    expect(result.business_name).toBe('Acme Corp');
    expect(result.services).toHaveLength(3);
  });

  it('rejects tagline over 60 characters', () => {
    expect(() =>
      ResearchBusinessOutput.parse({
        ...validOutput,
        tagline: 'A'.repeat(61),
      }),
    ).toThrow(ZodError);
  });

  it('rejects fewer than 3 services', () => {
    expect(() =>
      ResearchBusinessOutput.parse({
        ...validOutput,
        services: ['Only one', 'Only two'],
      }),
    ).toThrow(ZodError);
  });

  it('rejects more than 8 services', () => {
    expect(() =>
      ResearchBusinessOutput.parse({
        ...validOutput,
        services: Array.from({ length: 9 }, (_, i) => `Service ${i + 1}`),
      }),
    ).toThrow(ZodError);
  });
});

// ── GenerateSiteInput ────────────────────────────────────────

describe('GenerateSiteInput', () => {
  it('accepts valid input', () => {
    const result = GenerateSiteInput.parse({ research_data: '{"name":"Acme"}' });
    expect(result.research_data).toBe('{"name":"Acme"}');
  });

  it('rejects empty research_data', () => {
    expect(() => GenerateSiteInput.parse({ research_data: '' })).toThrow(ZodError);
  });
});

// ── GenerateSiteOutput ───────────────────────────────────────

describe('GenerateSiteOutput', () => {
  it('accepts valid HTML with DOCTYPE', () => {
    const html = '<!DOCTYPE html><html><body>Hello</body></html>';
    const result = GenerateSiteOutput.parse(html);
    expect(result).toBe(html);
  });

  it('accepts lowercase doctype', () => {
    const html = '<!doctype html><html><body>Hello</body></html>';
    const result = GenerateSiteOutput.parse(html);
    expect(result).toBe(html);
  });

  it('rejects string without DOCTYPE', () => {
    expect(() => GenerateSiteOutput.parse('<html><body>No doctype</body></html>')).toThrow(
      ZodError,
    );
  });
});

// ── ScoreQualityInput ────────────────────────────────────────

describe('ScoreQualityInput', () => {
  it('accepts valid input', () => {
    const result = ScoreQualityInput.parse({ html_content: '<div>Content</div>' });
    expect(result.html_content).toBe('<div>Content</div>');
  });

  it('rejects empty html_content', () => {
    expect(() => ScoreQualityInput.parse({ html_content: '' })).toThrow(ZodError);
  });
});

// ── ScoreQualityOutput ───────────────────────────────────────

describe('ScoreQualityOutput', () => {
  const validScores = {
    scores: {
      accuracy: 0.9,
      completeness: 0.85,
      professionalism: 0.95,
      seo: 0.8,
      accessibility: 0.7,
    },
    overall: 0.84,
    issues: ['Minor spacing issue'],
    suggestions: ['Add alt text to images'],
  };

  it('accepts valid scores', () => {
    const result = ScoreQualityOutput.parse(validScores);
    expect(result.overall).toBe(0.84);
    expect(result.scores.accuracy).toBe(0.9);
  });

  it('rejects scores greater than 1', () => {
    expect(() =>
      ScoreQualityOutput.parse({
        ...validScores,
        scores: { ...validScores.scores, accuracy: 1.1 },
      }),
    ).toThrow(ZodError);
  });

  it('rejects scores less than 0', () => {
    expect(() =>
      ScoreQualityOutput.parse({
        ...validScores,
        scores: { ...validScores.scores, seo: -0.1 },
      }),
    ).toThrow(ZodError);
  });
});

// ── SiteCopyInput ────────────────────────────────────────────

describe('SiteCopyInput', () => {
  it('accepts valid input', () => {
    const result = SiteCopyInput.parse({
      businessName: 'Cool Biz',
      city: 'Springfield',
      services: ['Consulting'],
      tone: 'premium',
    });
    expect(result.businessName).toBe('Cool Biz');
    expect(result.tone).toBe('premium');
  });

  it('applies default tone of friendly', () => {
    const result = SiteCopyInput.parse({
      businessName: 'Defaults Co',
      city: 'Townsville',
    });
    expect(result.tone).toBe('friendly');
    expect(result.services).toEqual([]);
  });

  it('rejects invalid tone value', () => {
    expect(() =>
      SiteCopyInput.parse({
        businessName: 'Bad Tone',
        city: 'Errorville',
        tone: 'aggressive',
      }),
    ).toThrow(ZodError);
  });

  it('rejects missing businessName', () => {
    expect(() =>
      SiteCopyInput.parse({
        city: 'NoName City',
      }),
    ).toThrow(ZodError);
  });
});

// ── validatePromptInput ──────────────────────────────────────

describe('validatePromptInput', () => {
  it('validates against the correct schema and returns parsed input', () => {
    const result = validatePromptInput('research_business', {
      business_name: 'Valid Biz',
    });
    expect(result).toMatchObject({
      business_name: 'Valid Biz',
      business_phone: '',
      business_address: '',
    });
  });

  it('throws ZodError for invalid input', () => {
    expect(() => validatePromptInput('research_business', {})).toThrow(ZodError);
  });

  it('throws Error for unknown promptId', () => {
    expect(() => validatePromptInput('nonexistent_prompt', { foo: 'bar' })).toThrow(
      'No schema registered for prompt: nonexistent_prompt',
    );
  });
});

// ── validatePromptOutput ─────────────────────────────────────

describe('validatePromptOutput', () => {
  it('validates output against the correct schema', () => {
    const html = '<!DOCTYPE html><html><body>Site</body></html>';
    const result = validatePromptOutput('generate_site', html);
    expect(result).toBe(html);
  });

  it('throws ZodError for invalid output', () => {
    expect(() => validatePromptOutput('generate_site', 'no doctype here')).toThrow(ZodError);
  });

  it('passes through raw output when no output schema is registered', () => {
    // Temporarily add a prompt with no output schema to verify pass-through
    PROMPT_SCHEMAS['_test_no_output'] = { input: ResearchBusinessInput };
    try {
      const raw = { anything: 'goes' };
      const result = validatePromptOutput('_test_no_output', raw);
      expect(result).toBe(raw);
    } finally {
      delete PROMPT_SCHEMAS['_test_no_output'];
    }
  });
});
