import { MarketplaceHealthBrief } from './marketplace-health.brief';
import { MoneyMapBrief } from './money-map.brief';
import { AiPerformanceBrief } from './ai-performance.brief';
import { BriefMetric, FounderBrief } from './brief.types';

// Shared mock prisma — each suite loads its own rows.
const mockPrisma = {
  trip: { findMany: jest.fn(), count: jest.fn() },
  tripEvent: { findMany: jest.fn() },
  bid: { findMany: jest.fn() },
  bidOutcome: { count: jest.fn(), findMany: jest.fn() },
  refund: { aggregate: jest.fn() },
  payment: { count: jest.fn() },
  aiRecommendation: { groupBy: jest.fn() },
  aiInferenceLog: { findMany: jest.fn() },
} as any;

const mockRedis = { keys: jest.fn().mockResolvedValue([]), get: jest.fn(), scard: jest.fn() } as any;

const NOW = new Date('2026-07-11T12:00:00Z');
const IN_WINDOW = new Date('2026-07-09T12:00:00Z');

const allMetrics = (brief: FounderBrief): BriefMetric[] => brief.sections.flatMap((s) => s.metrics);
const findMetric = (brief: FounderBrief, name: string): BriefMetric =>
  allMetrics(brief).find((m) => m.name === name)!;

const trusted = (tripIds: string[]) =>
  mockPrisma.tripEvent.findMany.mockResolvedValue(
    tripIds.map((id) => ({ tripId: id, metadata: { class: 'trusted' } })),
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.trip.findMany.mockResolvedValue([]);
  mockPrisma.trip.count.mockResolvedValue(0);
  mockPrisma.tripEvent.findMany.mockResolvedValue([]);
  mockPrisma.bid.findMany.mockResolvedValue([]);
  mockPrisma.bidOutcome.count.mockResolvedValue(0);
  mockPrisma.bidOutcome.findMany.mockResolvedValue([]);
  mockPrisma.refund.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: 0 });
  mockPrisma.payment.count.mockResolvedValue(0);
  mockPrisma.aiRecommendation.groupBy.mockResolvedValue([]);
  mockPrisma.aiInferenceLog.findMany.mockResolvedValue([]);
  mockRedis.keys.mockResolvedValue([]);
});

// ─── Marketplace Health ───────────────────────────────────────────────────────

describe('MarketplaceHealthBrief', () => {
  const brief = new MarketplaceHealthBrief(mockPrisma, mockRedis);

  it('every metric declares window, sample size, source, and a quality label', async () => {
    const result = await brief.generate(NOW);
    expect(allMetrics(result).length).toBeGreaterThan(5);
    for (const m of allMetrics(result)) {
      expect(m.window).toBeTruthy();
      expect(m.sampleSize).toBeGreaterThanOrEqual(0);
      expect(m.source).toBeTruthy();
      expect(m.qualityLabel).toBeTruthy();
    }
  });

  it('rates below the sample floor render as insufficient evidence, never invented', async () => {
    // 2 completed trips → completion_rate n=2 < 5 → insufficient.
    mockPrisma.trip.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.status === 'completed') {
        return [
          { id: 't1', finalFare: 10, driverEarnings: 8, earningsSupplement: 0, pickupLat: 40.7, pickupLng: -74.1, isAirportTrip: false, createdAt: IN_WINDOW, acceptedAt: IN_WINDOW },
          { id: 't2', finalFare: 12, driverEarnings: 9, earningsSupplement: 0, pickupLat: 40.7, pickupLng: -74.1, isAirportTrip: false, createdAt: IN_WINDOW, acceptedAt: IN_WINDOW },
        ];
      }
      return [];
    });
    trusted(['t1', 't2']);

    const result = await brief.generate(NOW);
    const completion = findMetric(result, 'completion_rate');
    expect(completion.qualityLabel).toBe('insufficient_evidence');
    expect(completion.value).toBeNull();
    expect(result.insufficientEvidence).toContain('completion_rate');
    // Counts stay honest at any n.
    expect(findMetric(result, 'completed_rides').value).toBe(2);
  });

  it('monetary averages use ONLY Trusted/Reconciled trips', async () => {
    const mk = (id: string, fare: number) => ({
      id, finalFare: fare, driverEarnings: fare * 0.8, earningsSupplement: 0,
      pickupLat: 40.7, pickupLng: -74.1, isAirportTrip: false, createdAt: IN_WINDOW, acceptedAt: IN_WINDOW,
    });
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args?.where?.status === 'completed'
        ? [mk('t1', 10), mk('t2', 10), mk('t3', 10), mk('t4', 10), mk('t5', 10), mk('t-excluded', 900)]
        : [],
    );
    trusted(['t1', 't2', 't3', 't4', 't5']); // t-excluded not trusted

    const result = await brief.generate(NOW);
    const avgFare = findMetric(result, 'average_fare');
    expect(avgFare.value).toBe(10); // $900 outlier gated out
    expect(avgFare.sampleSize).toBe(5);
    expect(avgFare.qualityLabel).toBe('canonical_trusted');
  });
});

// ─── Money Map ────────────────────────────────────────────────────────────────

describe('MoneyMapBrief', () => {
  const brief = new MoneyMapBrief(mockPrisma);
  const mk = (id: string, over: Partial<Record<string, unknown>> = {}) => ({
    id, finalFare: 20, driverEarnings: 16, platformFee: 4, earningsSupplement: 0,
    pickupLat: 40.7, pickupLng: -74.1, isAirportTrip: false, bidId: null, ...over,
  });

  it('every money figure identifies a canonical source — AI tables are never cited', async () => {
    const result = await brief.generate(NOW);
    for (const m of allMetrics(result)) {
      expect(m.source).toMatch(/trips|payments|refunds/);
      expect(m.source).not.toMatch(/ai_pricing_logs|ai_inference_logs|ai_recommendations/);
    }
  });

  it('quality-gates every dollar: untrusted trips contribute nothing', async () => {
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args?.where?.completedAt?.gte?.getTime() > NOW.getTime() - 8 * 86400000
        ? [mk('t1'), mk('t2'), mk('t3'), mk('t4'), mk('t5'), mk('t-dirty', { finalFare: 5000 })]
        : [],
    );
    trusted(['t1', 't2', 't3', 't4', 't5']);

    const result = await brief.generate(NOW);
    expect(findMetric(result, 'gross_ride_value').value).toBe(100); // 5 × $20, dirty $5000 excluded
    expect(findMetric(result, 'platform_revenue').value).toBe(20);
  });

  it('flags zones where floor supplements exceed platform fees as possibly losing money', async () => {
    const losing = (id: string) => mk(id, { platformFee: 1, earningsSupplement: 3, pickupLat: 40.7, pickupLng: -74.1 });
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args?.where?.completedAt?.gte?.getTime() > NOW.getTime() - 8 * 86400000
        ? [losing('t1'), losing('t2'), losing('t3'), losing('t4'), losing('t5')]
        : [],
    );
    trusted(['t1', 't2', 't3', 't4', 't5']);

    const result = await brief.generate(NOW);
    const contribution = result.sections.find((s) => s.title === 'Contribution')!;
    expect(contribution.zoneTable!.rows[0].contribution).toBe(-10);
    expect(contribution.notes!.join(' ')).toContain('losing');
  });

  it('computes the completed-payment rate from the payments table', async () => {
    mockPrisma.payment.count.mockImplementation(async (args: any) =>
      args.where.status === 'succeeded' ? 9 : 1,
    );
    const result = await brief.generate(NOW);
    expect(findMetric(result, 'completed_payment_rate').value).toBe(90);
    expect(findMetric(result, 'failed_payments').value).toBe(1);
  });
});

// ─── AI Performance ───────────────────────────────────────────────────────────

describe('AiPerformanceBrief', () => {
  const brief = new AiPerformanceBrief(mockPrisma);

  it('reports ledger lifecycle counts', async () => {
    mockPrisma.aiRecommendation.groupBy.mockResolvedValue([
      { status: 'proposed', _count: { _all: 3 } },
      { status: 'adopted', _count: { _all: 1 } },
    ]);
    const result = await brief.generate(NOW);
    expect(findMetric(result, 'recommendations_proposed').value).toBe(3);
    expect(findMetric(result, 'recommendations_adopted').value).toBe(1);
    expect(findMetric(result, 'recommendations_dismissed').value).toBe(0);
  });

  it('NEVER suggests activation without outcome evidence — generating recommendations is not evidence', async () => {
    mockPrisma.aiInferenceLog.findMany.mockResolvedValue([
      { modelName: 'fare-adjustment', modelVersion: 'fare-shadow-v1', fallbackUsed: false, latencyMs: 12 },
    ]);
    mockPrisma.bidOutcome.findMany.mockResolvedValue([]); // zero outcomes

    const result = await brief.generate(NOW);
    const notes = result.sections.flatMap((s) => s.notes ?? []).join(' ');
    expect(notes).toContain('REMAIN SHADOWED');
    expect(notes).toContain('NOT outcome evidence');
  });

  it('computes fallback and over-budget rates per family', async () => {
    mockPrisma.aiInferenceLog.findMany.mockResolvedValue([
      { modelName: 'driver-ranking', modelVersion: 'ranking-v1', fallbackUsed: false, latencyMs: 100 },
      { modelName: 'driver-ranking', modelVersion: 'ranking-v1', fallbackUsed: true, latencyMs: 400 }, // over 300ms budget
    ]);
    const result = await brief.generate(NOW);
    const table = result.sections.find((s) => s.title.includes('Inference health'))!.zoneTable!;
    expect(table.rows[0]).toMatchObject({ family: 'driver-ranking', inferences: 2, fallbackRatePct: 50, overBudgetRatePct: 50 });
  });

  it('calibration buckets compare REAL shadow predictions to outcomes', async () => {
    mockPrisma.bidOutcome.findMany.mockResolvedValue([
      { predictionProbability: 0.8, wasAccepted: true },
      { predictionProbability: 0.79, wasAccepted: false },
      { predictionProbability: 0.3, wasAccepted: false },
    ]);
    const result = await brief.generate(NOW);
    const table = result.sections.find((s) => s.title.includes('calibration'))!.zoneTable!;
    const high = table.rows.find((r) => r.bucket === '0.75–1.00')!;
    expect(high.n).toBe(2);
    expect(high.actualAcceptance).toBe(0.5);
  });
});
