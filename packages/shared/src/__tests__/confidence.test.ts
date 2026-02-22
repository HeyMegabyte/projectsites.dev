/**
 * @module __tests__/confidence
 * @description Unit tests for confidence types, utilities, and merge logic.
 */

import {
  wrapConf,
  mergeConf,
  applyBoostPenalties,
  computeAggregateConfidence,
  getProminenceLevel,
  shouldShowComponent,
  BASE_CONFIDENCE,
  SECTION_WEIGHTS,
} from '../schemas/confidence.js';

describe('Confidence — wrapConf', () => {
  it('wraps a string value with llm_generated confidence', () => {
    const c = wrapConf('hello', 'llm_generated', { rationale: 'test' });
    expect(c.value).toBe('hello');
    expect(c.confidence).toBe(0.50);
    expect(c.sources).toHaveLength(1);
    expect(c.sources[0].kind).toBe('llm_generated');
    expect(c.rationale).toBe('test');
    expect(c.isPlaceholder).toBe(false);
  });

  it('applies empty penalty for null values', () => {
    const c = wrapConf(null, 'llm_generated');
    // 0.50 - 0.15 = 0.35
    expect(c.confidence).toBe(0.35);
  });

  it('applies empty penalty for empty string', () => {
    const c = wrapConf('', 'user_provided');
    // 0.90 - 0.15 = 0.75
    expect(c.confidence).toBe(0.75);
  });

  it('applies placeholder penalty', () => {
    const c = wrapConf('placeholder', 'internal_inference', { isPlaceholder: true });
    // 0.45 - 0.10 = 0.35
    expect(c.confidence).toBe(0.35);
    expect(c.isPlaceholder).toBe(true);
  });

  it('applies both empty + placeholder penalties', () => {
    const c = wrapConf('', 'stock_photo', { isPlaceholder: true });
    // 0.30 - 0.15 (empty) - 0.10 (placeholder) = 0.05
    expect(c.confidence).toBe(0.05);
  });

  it('uses google_places base confidence', () => {
    const c = wrapConf('ChIJ123', 'google_places', { sourceId: 'abc' });
    expect(c.confidence).toBe(0.92);
    expect(c.sources[0].id).toBe('abc');
  });

  it('respects confidenceOverride', () => {
    const c = wrapConf('test', 'llm_generated', { confidenceOverride: 0.95 });
    expect(c.confidence).toBe(0.95);
  });

  it('uses correct base confidence for all source kinds', () => {
    expect(BASE_CONFIDENCE.business_owner).toBe(0.95);
    expect(BASE_CONFIDENCE.user_provided).toBe(0.90);
    expect(BASE_CONFIDENCE.google_places).toBe(0.92);
    expect(BASE_CONFIDENCE.osm).toBe(0.80);
    expect(BASE_CONFIDENCE.review_platform).toBe(0.80);
    expect(BASE_CONFIDENCE.domain_whois).toBe(0.70);
    expect(BASE_CONFIDENCE.street_view).toBe(0.70);
    expect(BASE_CONFIDENCE.social_profile).toBe(0.70);
    expect(BASE_CONFIDENCE.llm_generated).toBe(0.50);
    expect(BASE_CONFIDENCE.internal_inference).toBe(0.45);
    expect(BASE_CONFIDENCE.stock_photo).toBe(0.30);
  });
});

describe('Confidence — mergeConf', () => {
  it('selects higher confidence value', () => {
    const a = wrapConf('old', 'llm_generated');
    const b = wrapConf('new', 'google_places');
    const merged = mergeConf(a, b);
    expect(merged.value).toBe('new');
    // google_places (0.92) + graduated corroboration boost for 2 sources (0.08) = 0.98 (capped)
    expect(merged.confidence).toBe(0.98);
    expect(merged.sources).toHaveLength(2);
  });

  it('applies corroboration boost for 2+ source kinds', () => {
    const a = wrapConf('val', 'llm_generated');
    const b = wrapConf('val', 'user_provided');
    const merged = mergeConf(a, b);
    // user_provided 0.90 + 0.08 boost = 0.98
    expect(merged.confidence).toBe(0.98);
  });

  it('does not boost when same source kind', () => {
    const a = wrapConf('v1', 'llm_generated');
    const b = wrapConf('v2', 'llm_generated', { rationale: 'second try' });
    const merged = mergeConf(a, b);
    expect(merged.confidence).toBe(0.50);
  });

  it('caps corroboration boost at 0.98', () => {
    const a = wrapConf('val', 'business_owner'); // 0.95
    const b = wrapConf('val', 'google_places');  // 0.92
    const merged = mergeConf(a, b);
    // 0.95 + 0.08 = 1.03 -> capped at 0.98
    expect(merged.confidence).toBe(0.98);
  });

  it('deduplicates sources by kind:id', () => {
    const a = wrapConf('v1', 'google_places', { sourceId: 'same' });
    const b = wrapConf('v2', 'google_places', { sourceId: 'same' });
    const merged = mergeConf(a, b);
    expect(merged.sources).toHaveLength(1);
  });

  it('clears isPlaceholder when merging with non-placeholder', () => {
    const a = wrapConf('placeholder', 'internal_inference', { isPlaceholder: true });
    const b = wrapConf('real', 'google_places');
    const merged = mergeConf(a, b);
    expect(merged.isPlaceholder).toBe(false);
  });
});

describe('Confidence — applyBoostPenalties', () => {
  it('applies corroboration boost', () => {
    const c = {
      value: 'test',
      confidence: 0.80,
      sources: [
        { kind: 'llm_generated' as const, retrievedAt: '' },
        { kind: 'google_places' as const, retrievedAt: '' },
      ],
    };
    const score = applyBoostPenalties(c);
    // 0.80 + 0.08 (graduated boost for 2 sources) = 0.88
    expect(score).toBe(0.88);
  });

  it('applies empty penalty', () => {
    const c = wrapConf('test', 'llm_generated');
    const score = applyBoostPenalties(c, { isEmpty: true });
    expect(score).toBe(0.35); // 0.50 - 0.15
  });

  it('applies stale penalty', () => {
    const c = wrapConf('test', 'google_places');
    const score = applyBoostPenalties(c, { isStale: true });
    expect(score).toBe(0.82); // 0.92 - 0.10
  });

  it('applies format validation penalty', () => {
    const c = wrapConf('bad-phone', 'user_provided');
    const score = applyBoostPenalties(c, { formatValid: false });
    expect(score).toBe(0.80); // 0.90 - 0.10
  });

  it('never goes below 0', () => {
    const c = wrapConf('', 'stock_photo', { isPlaceholder: true });
    // already 0.05, apply isEmpty and stale and formatValid
    const score = applyBoostPenalties(c, { isEmpty: true, isStale: true, formatValid: false });
    expect(score).toBe(0);
  });
});

describe('Confidence — computeAggregateConfidence', () => {
  it('computes weighted mean of Conf leaves', () => {
    const obj = {
      name: wrapConf('Test', 'user_provided'),    // 0.90
      phone: wrapConf('+1234', 'google_places'),   // 0.92
    };
    const agg = computeAggregateConfidence(obj);
    expect(agg).toBe(0.91); // (0.90 + 0.92) / 2
  });

  it('handles nested objects', () => {
    const obj = {
      identity: {
        name: wrapConf('Test', 'llm_generated'),    // 0.50
        phone: wrapConf('+1234', 'google_places'),   // 0.92
      },
    };
    const agg = computeAggregateConfidence(obj);
    expect(agg).toBe(0.71); // (0.50 + 0.92) / 2
  });

  it('handles empty objects', () => {
    expect(computeAggregateConfidence({})).toBe(0);
  });

  it('applies section weights', () => {
    const obj = {
      identity: wrapConf('high', 'user_provided'),   // 0.90, weight 5
      media: wrapConf('low', 'stock_photo'),          // 0.30, weight 1
    };
    const agg = computeAggregateConfidence(obj, SECTION_WEIGHTS);
    // (0.90*5 + 0.30*1) / (5+1) = 4.80/6 = 0.80
    expect(agg).toBe(0.8);
  });
});

describe('Confidence — UI Prominence', () => {
  it('getProminenceLevel returns correct levels', () => {
    expect(getProminenceLevel(0.90)).toBe('prominent');
    expect(getProminenceLevel(0.85)).toBe('prominent');
    expect(getProminenceLevel(0.84)).toBe('standard');
    expect(getProminenceLevel(0.70)).toBe('standard');
    expect(getProminenceLevel(0.69)).toBe('deemphasize');
    expect(getProminenceLevel(0.50)).toBe('deemphasize');
    expect(getProminenceLevel(0.49)).toBe('hide_or_placeholder');
    expect(getProminenceLevel(0)).toBe('hide_or_placeholder');
  });

  it('shouldShowComponent respects thresholds', () => {
    expect(shouldShowComponent('contact.phone', 0.85)).toBe(true);
    expect(shouldShowComponent('contact.phone', 0.84)).toBe(false);
    expect(shouldShowComponent('marketing.copy', 0.60)).toBe(true);
    expect(shouldShowComponent('marketing.copy', 0.59)).toBe(false);
    expect(shouldShowComponent('images.gallery', 0.40)).toBe(true);
    expect(shouldShowComponent('images.gallery', 0.39)).toBe(false);
  });

  it('shouldShowComponent defaults to 0.50 for unknown components', () => {
    expect(shouldShowComponent('unknown.widget', 0.50)).toBe(true);
    expect(shouldShowComponent('unknown.widget', 0.49)).toBe(false);
  });
});
