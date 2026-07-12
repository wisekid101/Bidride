import { validateRecommendation } from './recommendation-validator';
import { INSUFFICIENT_EVIDENCE, UniversalRecommendation } from './recommendation.types';

// A fully valid non-financial recommendation — each test breaks one rule.
const valid = (): UniversalRecommendation => ({
  domain: 'opportunity',
  family: 'zone-opportunity',
  recommendationType: 'marketplace_opportunity',
  title: 'Supply shortage in zone 2261:-3373',
  summary: '12 requests served by 1 driver.',
  recommendation: { action: 'review_zone_opportunity', value: '2261:-3373', unit: 'zoneKey' },
  confidence: 0.54,
  sampleSize: 12,
  evidence: [
    { source: 'trips (canonical)', metric: 'zone_requests', value: 12, window: '7d', sampleSize: 12, asOf: '2026-07-11T00:00:00Z' },
  ],
  reasoning: ['Zone 2261:-3373 had 12 requests and 1 distinct driver.'],
  expectedOutcome: 'More drivers reduces match time.',
  expectedValue: { metric: 'weekly_zone_trips', delta: '+directional', horizon: '4 weeks' },
  alternatives: [{ action: 'wait', tradeoff: 'gap persists' }],
  why: 'Most evidenced gap.',
  whyNot: 'Small sample.',
  rollback: 'Advisory only; nothing executes.',
  businessImpact: 'Focus.',
  userImpact: 'None directly.',
  safetyImpact: 'none — no safety surface',
  revenueImpact: 'Indirect.',
  trustImpact: 'Neutral.',
  constitutionTags: ['move_people'],
  sourceVersion: 'opportunity-v1',
});

describe('recommendation validator — black-box rejection', () => {
  it('accepts a fully-evidenced recommendation', () => {
    expect(validateRecommendation(valid())).toEqual([]);
  });

  it('rejects a recommendation with no evidence', () => {
    const rec = { ...valid(), evidence: [] };
    expect(validateRecommendation(rec).join(' ')).toContain('black-box');
  });

  it('rejects evidence items that do not name their source', () => {
    const rec = valid();
    rec.evidence[0].source = '';
    expect(validateRecommendation(rec).join(' ')).toContain('evidence[0].source');
  });

  it('rejects empty reasoning', () => {
    const rec = { ...valid(), reasoning: ['  '] };
    expect(validateRecommendation(rec).join(' ')).toContain('reasoning');
  });

  it('rejects unbounded confidence', () => {
    expect(validateRecommendation({ ...valid(), confidence: 1.2 }).join(' ')).toContain('confidence');
    expect(validateRecommendation({ ...valid(), confidence: -0.1 }).join(' ')).toContain('confidence');
    expect(validateRecommendation({ ...valid(), confidence: NaN }).join(' ')).toContain('confidence');
  });

  it('rejects a missing sample size', () => {
    expect(validateRecommendation({ ...valid(), sampleSize: undefined as unknown as number }).join(' ')).toContain('sampleSize');
  });

  it('rejects missing constitution tags and unknown tags', () => {
    expect(validateRecommendation({ ...valid(), constitutionTags: [] }).join(' ')).toContain('constitution');
    expect(validateRecommendation({ ...valid(), constitutionTags: ['world_domination' as never] }).join(' ')).toContain('unknown constitution tag');
  });

  it('rejects any recommendation claiming a safety impact', () => {
    const rec = { ...valid(), safetyImpact: 'reduces SOS response time' };
    expect(validateRecommendation(rec).join(' ')).toContain('safety');
  });

  it('requires missing why/whyNot/rollback to be present', () => {
    expect(validateRecommendation({ ...valid(), whyNot: '' }).join(' ')).toContain('whyNot');
    expect(validateRecommendation({ ...valid(), rollback: '' }).join(' ')).toContain('rollback');
  });
});

describe('recommendation validator — financial rules', () => {
  it('financial recommendations must name a canonical financial source', () => {
    const rec = { ...valid(), constitutionTags: ['move_money' as const] };
    expect(validateRecommendation(rec).join(' ')).toContain('canonicalFinancialSource');
  });

  it('accepts a financial recommendation citing trips.finalFare', () => {
    const rec = {
      ...valid(),
      constitutionTags: ['move_money' as const],
      canonicalFinancialSource: 'trips.finalFare (canonical, Trusted-only)',
    };
    expect(validateRecommendation(rec)).toEqual([]);
  });

  it('rejects a financial recommendation citing an AI table as its money source', () => {
    const rec = {
      ...valid(),
      constitutionTags: ['move_money' as const],
      canonicalFinancialSource: 'ai_pricing_logs',
    };
    expect(validateRecommendation(rec).join(' ')).toContain('canonicalFinancialSource');
  });

  it('pricing-domain recommendations are always financial', () => {
    const rec = { ...valid(), domain: 'pricing' };
    expect(validateRecommendation(rec).join(' ')).toContain('canonicalFinancialSource');
  });
});

describe('recommendation validator — insufficient evidence honesty', () => {
  it('a small sample must declare insufficient evidence', () => {
    const rec = { ...valid(), sampleSize: 3 };
    expect(validateRecommendation(rec).join(' ')).toContain('insufficient');
  });

  it('accepts a small sample when honestly declared', () => {
    const rec: UniversalRecommendation = {
      ...valid(),
      sampleSize: 3,
      insufficientEvidence: true,
      expectedValue: INSUFFICIENT_EVIDENCE,
    };
    expect(validateRecommendation(rec)).toEqual([]);
  });

  it('rejects a malformed expectedValue', () => {
    const rec = { ...valid(), expectedValue: { metric: '', delta: '', horizon: '' } };
    expect(validateRecommendation(rec).join(' ')).toContain('expectedValue');
  });
});

describe('recommendation validator — content hygiene', () => {
  it('rejects payloads containing apparent secrets', () => {
    const rec = { ...valid(), summary: 'use key sk_test_abcdefghij1234567890 for access' };
    expect(validateRecommendation(rec).join(' ')).toContain('secret');
  });

  it('rejects raw coordinates in evidence values (zone keys only)', () => {
    const rec = valid();
    rec.evidence[0].value = '40.735712, -74.172366';
    expect(validateRecommendation(rec).join(' ')).toContain('coordinates');
  });
});
