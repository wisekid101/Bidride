import { FocusBrief } from './focus.brief';
import { validateRecommendation } from '../../recommendations/recommendation-validator';
import { UniversalRecommendation } from '../../recommendations/recommendation.types';
import { BriefMetric, FounderBrief } from './brief.types';

const mockPrisma = {
  aiRecommendation: { findMany: jest.fn() },
} as any;

const emptyBrief = (briefType: string, metrics: BriefMetric[] = []): FounderBrief => ({
  briefType: briefType as FounderBrief['briefType'],
  windowStart: '2026-07-05T00:00:00Z', windowEnd: '2026-07-12T00:00:00Z',
  comparisonWindowStart: '2026-06-28T00:00:00Z', comparisonWindowEnd: '2026-07-05T00:00:00Z',
  generatedAt: '2026-07-12T00:00:00Z', sourceVersion: 'test',
  sections: [{ title: 'metrics', metrics }],
  insufficientEvidence: [],
});

const metric = (over: Partial<BriefMetric>): BriefMetric => ({
  name: 'completed_rides', value: 10, window: 'w', sampleSize: 10,
  source: 'trips (canonical)', qualityLabel: 'canonical_all',
  comparison: { period: 'prev', value: 10, changePct: 0 },
  ...over,
});

const mockHealth = { generate: jest.fn() } as any;
const mockMoney = { generate: jest.fn() } as any;
const mockOpportunity = { generate: jest.fn(), analyze: jest.fn() } as any;

const created: UniversalRecommendation[] = [];
const mockLedger = {
  create: jest.fn(async (rec: UniversalRecommendation) => {
    const errors = validateRecommendation(rec);
    if (errors.length) throw new Error(`contract violation: ${errors.join('; ')}`);
    created.push(rec);
    return { id: `focus-rec-${created.length}` };
  }),
} as any;

const brief = new FocusBrief(mockPrisma, mockHealth, mockMoney, mockOpportunity, mockLedger);
const NOW = new Date('2026-07-12T06:00:00Z');

const zoneCandidate = (kind = 'supply_shortage') => ({
  kind, zone: '2261:-3373', score: 6,
  headline: `Supply shortage in zone 2261:-3373`,
  detail: '12 requests served by 2 drivers.',
  stats: {
    zone: '2261:-3373', trips: 12, prevTrips: 6, completed: 8, cancelled: 4,
    completionRate: 66.67, cancellationRate: 33.33, growthPct: 100,
    offerOutcomes: 0, offerAcceptance: null, moneyTrips: 6, avgDriverEarnings: 8.5, distinctDrivers: 2,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  created.length = 0;
  mockPrisma.aiRecommendation.findMany.mockResolvedValue([]); // no scored rows, no existing priorities
  mockHealth.generate.mockResolvedValue(emptyBrief('marketplace_health'));
  mockMoney.generate.mockResolvedValue(emptyBrief('money_map'));
  mockOpportunity.analyze.mockResolvedValue({ evidenced: [], thin: [], candidates: [], windowLabel: '2026-07-05..2026-07-12' });
});

describe('FocusBrief — seven required sections', () => {
  it('always renders all seven sections in order', async () => {
    const result = await brief.generate(NOW);
    expect(result.sections.map((s) => s.title)).toEqual([
      'Week over week', 'Needs attention', 'Recommendation report',
      'Family evidence status', 'Top 3 priorities', 'Do not act yet', 'Sources',
    ]);
    expect(result.briefType).toBe('focus');
  });

  it('week over week states improvements and regressions direction-aware', async () => {
    mockHealth.generate.mockResolvedValue(emptyBrief('marketplace_health', [
      metric({ name: 'completed_rides', comparison: { period: 'prev', value: 8, changePct: 25 } }),
      metric({ name: 'cancelled_rides', betterWhen: 'down', comparison: { period: 'prev', value: 4, changePct: 50 } }),
    ]));

    const result = await brief.generate(NOW);
    const notes = result.sections[0].notes!.join(' ');
    expect(notes).toContain('improved: completed_rides (+25%)');
    expect(notes).toContain('got worse: cancelled_rides (+50%)');
  });

  it('needs-attention includes only wrong-direction moves beyond threshold with n≥5', async () => {
    mockHealth.generate.mockResolvedValue(emptyBrief('marketplace_health', [
      metric({ name: 'cancelled_rides', betterWhen: 'down', sampleSize: 10, comparison: { period: 'prev', value: 4, changePct: 50 } }),
      metric({ name: 'small_move', betterWhen: 'down', sampleSize: 10, comparison: { period: 'prev', value: 4, changePct: 10 } }),  // below threshold
      metric({ name: 'thin_signal', betterWhen: 'down', sampleSize: 2, comparison: { period: 'prev', value: 4, changePct: 90 } }),  // below n floor
    ]));

    const result = await brief.generate(NOW);
    const attention = result.sections[1];
    expect(attention.metrics.map((m) => m.name)).toEqual(['cancelled_rides']);
    // the thin signal lands in do-not-act instead
    const doNotAct = result.sections[5].zoneTable!.rows.map((r) => r.signal);
    expect(doNotAct).toContain('thin_signal');
  });

  it('recommendation report separates worked (≥0.7) from failed (<0.3) with sufficient evidence only', async () => {
    mockPrisma.aiRecommendation.findMany.mockImplementation(async (args: any) =>
      args.where.status === 'outcome_scored'
        ? [
            { id: 'r-worked', family: 'zone-opportunity', title: 'good', confidence: 0.6, outcomeScore: 0.8, outcomeEvidence: { insufficientEvidence: false }, constitutionTags: [] },
            { id: 'r-failed', family: 'zone-opportunity', title: 'bad', confidence: 0.6, outcomeScore: 0.1, outcomeEvidence: { insufficientEvidence: false }, constitutionTags: [] },
            { id: 'r-thin', family: 'zone-opportunity', title: 'thin', confidence: 0.6, outcomeScore: 0.9, outcomeEvidence: { insufficientEvidence: true }, constitutionTags: [] },
          ]
        : [],
    );

    const result = await brief.generate(NOW);
    const report = result.sections[2];
    const ids = report.zoneTable!.rows.map((r) => r.recommendationId);
    expect(ids).toEqual(['r-worked', 'r-failed']); // thin excluded
    expect(report.notes!.join(' ')).toContain('correlation, not causation');
  });

  it('family evidence status requires 20 scored outcomes before calibration is meaningful', async () => {
    mockPrisma.aiRecommendation.findMany.mockImplementation(async (args: any) =>
      args.where.status === 'outcome_scored'
        ? Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, family: 'zone-opportunity', title: 't', confidence: 0.5, outcomeScore: 0.5, outcomeEvidence: null, constitutionTags: [] }))
        : [],
    );

    const result = await brief.generate(NOW);
    const rows = result.sections[3].zoneTable!.rows;
    expect(rows[0].calibration).toContain('insufficient_evidence (3 < 20)');
  });
});

describe('FocusBrief — top 3 priorities are governed ledger recommendations', () => {
  it('creates contract-valid priorities from zone candidates and attention metrics (max 3)', async () => {
    mockOpportunity.analyze.mockResolvedValue({
      evidenced: [], thin: [],
      candidates: [zoneCandidate('supply_shortage'), zoneCandidate('low_completion')],
      windowLabel: '2026-07-05..2026-07-12',
    });
    mockMoney.generate.mockResolvedValue(emptyBrief('money_map', [
      metric({ name: 'failed_payments', betterWhen: 'down', unit: undefined, source: 'payments.status=failed (canonical)', sampleSize: 8, comparison: { period: 'prev', value: 2, changePct: 300 } }),
    ]));

    const result = await brief.generate(NOW);
    const rows = result.sections[4].zoneTable!.rows;
    expect(rows).toHaveLength(3);
    expect(created).toHaveLength(3); // every priority passed the full validator inside the mock ledger
    for (const rec of created) {
      expect(rec.domain).toBe('founder');
      expect(rec.family).toBe('focus-recommendation');
      expect(rec.safetyImpact).toMatch(/^none/);
      expect(rec.whyNot).toBeTruthy();
      expect(rec.alternatives.length).toBeGreaterThan(0);
    }
    // the payments-derived priority names a canonical financial source
    const paymentsPriority = created.find((r) => r.title.includes('failed payments'))!;
    expect(paymentsPriority.canonicalFinancialSource).toBe('payments (canonical)');
  });

  it('reuses undecided same-window priorities instead of duplicating them', async () => {
    mockPrisma.aiRecommendation.findMany.mockImplementation(async (args: any) =>
      args.where.family === 'focus-recommendation'
        ? [{ id: 'existing-1', title: 'Priority: existing', confidence: 0.5, payload: { expectedValue: { metric: 'x', delta: '+', horizon: 'h' } } }]
        : [],
    );
    mockOpportunity.analyze.mockResolvedValue({
      evidenced: [], thin: [], candidates: [zoneCandidate()], windowLabel: '2026-07-05..2026-07-12',
    });

    const result = await brief.generate(NOW);
    expect(mockLedger.create).not.toHaveBeenCalled();
    expect(result.sections[4].zoneTable!.rows[0].recommendationId).toBe('existing-1');
    expect(result.sections[4].notes!.join(' ')).toContain('reused, not duplicated');
  });

  it('produces no priorities when nothing clears the evidence floor — weak signals stay out', async () => {
    const result = await brief.generate(NOW);
    expect(result.sections[4].zoneTable!.rows).toHaveLength(0);
    expect(result.sections[4].notes!.join(' ')).toContain('no priority clears the evidence floor');
    expect(mockLedger.create).not.toHaveBeenCalled();
  });
});

describe('FocusBrief — sources and privacy', () => {
  it('names canonical sources and asserts aggregate-only privacy', async () => {
    const result = await brief.generate(NOW);
    const sources = result.sections[6].notes!.join(' ');
    expect(sources).toContain('trips.finalFare');
    expect(sources).toContain('never financial truth');
    expect(sources).toContain('no rider or driver is identified');
  });
});
