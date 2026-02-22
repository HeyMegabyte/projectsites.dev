/**
 * Tests for extractJsonFromText utility.
 *
 * Verifies that JSON can be reliably extracted from LLM output that may
 * include explanatory text, markdown fences, or other wrapping.
 *
 * @packageDocumentation
 */

import { extractJsonFromText } from '../services/ai_workflows.js';

describe('extractJsonFromText', () => {
  it('parses clean JSON directly', () => {
    const input = '{"name": "Test", "value": 42}';
    expect(extractJsonFromText(input)).toEqual({ name: 'Test', value: 42 });
  });

  it('parses clean JSON array', () => {
    const input = '[1, 2, 3]';
    expect(extractJsonFromText(input)).toEqual([1, 2, 3]);
  });

  it('extracts JSON preceded by explanatory text', () => {
    const input = 'Based on the information provided, here is the result:\n\n{"business_type": "restaurant", "description": "A fine dining establishment"}';
    const result = extractJsonFromText(input) as Record<string, unknown>;
    expect(result.business_type).toBe('restaurant');
    expect(result.description).toBe('A fine dining establishment');
  });

  it('extracts JSON from markdown code fences', () => {
    const input = 'Here is the output:\n\n```json\n{"score": 85, "issues": []}\n```\n\nLet me know if you need more.';
    const result = extractJsonFromText(input) as Record<string, unknown>;
    expect(result.score).toBe(85);
    expect(result.issues).toEqual([]);
  });

  it('extracts JSON from code fences without language tag', () => {
    const input = '```\n{"key": "value"}\n```';
    expect(extractJsonFromText(input)).toEqual({ key: 'value' });
  });

  it('extracts JSON followed by trailing text', () => {
    const input = '{"name": "Test"}\n\nI hope this helps!';
    expect(extractJsonFromText(input)).toEqual({ name: 'Test' });
  });

  it('extracts JSON with both leading and trailing text', () => {
    const input = 'Sure! Here you go:\n{"business_name": "Acme"}\nFeel free to ask more questions.';
    expect(extractJsonFromText(input)).toEqual({ business_name: 'Acme' });
  });

  it('handles nested JSON objects', () => {
    const input = 'Result:\n{"profile": {"name": "Test", "address": {"city": "NYC"}}, "score": 90}';
    const result = extractJsonFromText(input) as Record<string, unknown>;
    expect(result.score).toBe(90);
    expect((result.profile as Record<string, unknown>).name).toBe('Test');
  });

  it('handles JSON with arrays inside', () => {
    const input = 'Based on analysis:\n{"services": ["web", "mobile"], "count": 2}';
    const result = extractJsonFromText(input) as Record<string, unknown>;
    expect(result.services).toEqual(['web', 'mobile']);
  });

  it('throws SyntaxError when no JSON present', () => {
    expect(() => extractJsonFromText('No JSON here at all')).toThrow(SyntaxError);
  });

  it('throws SyntaxError for empty string', () => {
    expect(() => extractJsonFromText('')).toThrow();
  });

  it('handles whitespace-padded JSON', () => {
    const input = '   \n\n  {"key": "value"}  \n\n   ';
    expect(extractJsonFromText(input)).toEqual({ key: 'value' });
  });

  it('extracts JSON when text follows on a new line', () => {
    const input = 'Here is your result:\n{"a": 1, "b": 2}\nHope this helps!';
    const result = extractJsonFromText(input) as Record<string, unknown>;
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('handles the exact error case: "Based on t..." prefix', () => {
    const input = 'Based on the business information provided, here is the research profile:\n\n{"business_type": "local_service", "description": "Express delivery service", "services": [{"name": "delivery"}], "email": null, "address": {"street": "123 Main St", "city": "Springfield", "state": "IL", "zip": "62701"}}';
    const result = extractJsonFromText(input) as Record<string, unknown>;
    expect(result.business_type).toBe('local_service');
  });
});
