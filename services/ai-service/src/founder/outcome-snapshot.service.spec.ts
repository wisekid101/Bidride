import { OutcomeSnapshotService } from './outcome-snapshot.service';

const mockTx = {
  aiRecommendation: { update: jest.fn() },
  aiRecommendationEvent: { create: jest.fn() },
};

const mockPrisma = {
  platformConfig: { findUnique: jest.fn() },
  aiRecommendation: { findMany: jest.fn(), findUnique: jest.fn() },
  trip: { findMany: jest.fn() },
  bidOutcome: { findMany: jest.fn() },
  $transaction: jest.fn(async (fn: any) => fn(mockTx)),
} as any;

let trustedIds = new Set<string>();
const mockQuality = {
  moneyEligibleSubset: jest.fn(async (ids: string[]) => new Set(ids.filter((i) => trustedIds.has(i)))),
} as any;

const service = new OutcomeSnapshotService(mockPrisma, mockQuality);

const ZONE = '2261:-3373';
const DECIDED = new Date('2026-07-01T00:00:00Z');
const AFTER_HORIZON = new Date('2026-07-30T00:00:00Z'); // 29d later — horizon (28d) elapsed
const MID_HORIZON = new Date('2026-07-03T00:00:00Z');

const rec = (status = 'adopted') => ({
  id: 'rec-1',
  status,
  canonicalRefs: { zoneKey: ZONE, window: 'w' },
  events: [
    { action: 'create', createdAt: new Date('2026-06-30T00:00:00Z') },
    { action: status === 'dismissed' ? 'dismiss' : 'adopt', createdAt: DECIDED },
  ],
});

// zone trip factory: lat/lng that map to ZONE (2261*0.018..., -3373*0.022...)
const zoneTrip = (id: string, status: string, createdAt: Date, earnings = 12) => ({
  id, status, pickupLat: 40.7, pickupLng: -74.2, driverEarnings: earnings, earningsSupplement: 0, createdAt,
});

beforeEach(() => {
  jest.clearAllMocks();
  trustedIds = new Set();
  mockPrisma.platformConfig.findUnique.mockResolvedValue(null);
  mockPrisma.aiRecommendation.findUnique.mockResolvedValue(rec());
  mockPrisma.trip.findMany.mockResolvedValue([]);
  mockPrisma.bidOutcome.findMany.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));
  mockTx.aiRecommendation.update.mockResolvedValue({});
  mockTx.aiRecommendationEvent.create.mockResolvedValue({});
});

// Verify the zone math constant used by the factory.
it('test fixture sanity: factory coordinates map to the target zone', () => {
  expect(`${Math.floor(40.7 / 0.018)}:${Math.floor(-74.2 / 0.022)}`).toBe(ZONE);
});

describe('OutcomeSnapshotService — before/after measurement', () => {
  const seedWindows = () => {
    // before window [Jun24, Jul1): 9 terminal trips, 5 completed (55.56%)
    // after window [Jul1, Jul29): 8 terminal trips, 6 completed (75%)
    const before = [
      ...Array.from({ length: 5 }, (_, i) => zoneTrip(`b-c${i}`, 'completed', new Date('2026-06-26T00:00:00Z'))),
      ...Array.from({ length: 4 }, (_, i) => zoneTrip(`b-x${i}`, 'cancelled', new Date('2026-06-27T00:00:00Z'))),
    ];
    const after = [
      ...Array.from({ length: 6 }, (_, i) => zoneTrip(`a-c${i}`, 'completed', new Date('2026-07-10T00:00:00Z'))),
      ...Array.from({ length: 2 }, (_, i) => zoneTrip(`a-x${i}`, 'cancelled', new Date('2026-07-11T00:00:00Z'))),
    ];
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args.where.createdAt.gte >= DECIDED ? after : before,
    );
  };

  it('computes direction-aware before/after/delta with sample sizes and quality labels', async () => {
    seedWindows();
    trustedIds = new Set(['b-c0', 'b-c1', 'b-c2', 'b-c3', 'b-c4', 'a-c0', 'a-c1', 'a-c2', 'a-c3', 'a-c4', 'a-c5']);

    const evidence = await service.snapshotOne('rec-1', AFTER_HORIZON);

    const completion = evidence.metrics.find((m) => m.metric === 'completion_rate_pct')!;
    expect(completion.before).toBe(55.56);
    expect(completion.after).toBe(75);
    expect(completion.delta).toBe(19.44);
    expect(completion.sampleSizeBefore).toBe(9);
    expect(completion.sampleSizeAfter).toBe(8);
    expect(completion.betterWhen).toBe('up');

    const cancellation = evidence.metrics.find((m) => m.metric === 'cancellation_rate_pct')!;
    expect(cancellation.betterWhen).toBe('down');
    expect(cancellation.delta).toBe(-19.44);

    const money = evidence.metrics.find((m) => m.metric === 'avg_driver_take_home_usd')!;
    expect(money.qualityLabel).toBe('canonical_trusted');
    expect(money.source).toContain('canonical, Trusted/Reconciled only');
  });

  it('monetary evidence excludes non-Trusted trips (quality gate)', async () => {
    seedWindows();
    // Only after-window completions trusted, at $12; before-window money insufficient.
    trustedIds = new Set(['a-c0', 'a-c1', 'a-c2', 'a-c3', 'a-c4', 'a-c5']);

    const evidence = await service.snapshotOne('rec-1', AFTER_HORIZON);
    const money = evidence.metrics.find((m) => m.metric === 'avg_driver_take_home_usd')!;
    expect(money.qualityLabel).toBe('insufficient_evidence'); // before side n=0 < 5
    expect(money.before).toBeNull();
  });

  it('suggests a bounded score with an advisory, non-causal basis when the horizon elapsed', async () => {
    seedWindows();
    trustedIds = new Set(['b-c0', 'b-c1', 'b-c2', 'b-c3', 'b-c4', 'a-c0', 'a-c1', 'a-c2', 'a-c3', 'a-c4', 'a-c5']);

    const evidence = await service.snapshotOne('rec-1', AFTER_HORIZON);

    expect(evidence.suggestedScore).toBeGreaterThan(0.5); // things improved
    expect(evidence.suggestedScore).toBeLessThanOrEqual(1);
    expect(evidence.suggestedScoreBasis).toContain('advisory only');
    expect(evidence.suggestedScoreBasis).toContain('NOT causation');
    expect(evidence.insufficientEvidence).toBe(false);
  });

  it('NO suggested score before the horizon elapses — partial windows are informational', async () => {
    seedWindows();
    const evidence = await service.snapshotOne('rec-1', MID_HORIZON);

    expect(evidence.window.horizonElapsed).toBe(false);
    expect(evidence.suggestedScore).toBeNull();
    expect(evidence.insufficientEvidence).toBe(true);
  });

  it('NO suggested score when every metric is below the sample floor', async () => {
    mockPrisma.trip.findMany.mockResolvedValue([zoneTrip('only', 'completed', new Date('2026-07-10T00:00:00Z'))]);

    const evidence = await service.snapshotOne('rec-1', AFTER_HORIZON);

    expect(evidence.suggestedScore).toBeNull();
    expect(evidence.suggestedScoreBasis).toContain('sample floor');
    expect(evidence.insufficientEvidence).toBe(true);
  });

  it('never writes the suggested score into outcomeScore', async () => {
    seedWindows();
    trustedIds = new Set(['b-c0', 'b-c1', 'b-c2', 'b-c3', 'b-c4', 'a-c0', 'a-c1', 'a-c2', 'a-c3', 'a-c4', 'a-c5']);
    await service.snapshotOne('rec-1', AFTER_HORIZON);

    const update = mockTx.aiRecommendation.update.mock.calls[0][0].data;
    expect(update).not.toHaveProperty('outcomeScore');
    expect(update).toHaveProperty('outcomeEvidence');
  });
});

describe('OutcomeSnapshotService — lifecycle and audit', () => {
  it('moves adopted → outcome_pending with an audit event', async () => {
    await service.snapshotOne('rec-1', AFTER_HORIZON);

    expect(mockTx.aiRecommendation.update.mock.calls[0][0].data.status).toBe('outcome_pending');
    const event = mockTx.aiRecommendationEvent.create.mock.calls[0][0].data;
    expect(event).toMatchObject({ action: 'attach_outcome_evidence', actor: 'ai-service', newStatus: 'outcome_pending' });
  });

  it('dismissed recommendations keep their status (still scorable later)', async () => {
    mockPrisma.aiRecommendation.findUnique.mockResolvedValue(rec('dismissed'));

    await service.snapshotOne('rec-1', AFTER_HORIZON);

    expect(mockTx.aiRecommendation.update.mock.calls[0][0].data.status).toBeUndefined();
  });

  it('refuses recommendations without a decision event or zone reference', async () => {
    mockPrisma.aiRecommendation.findUnique.mockResolvedValue({ ...rec(), events: [] });
    await expect(service.snapshotOne('rec-1', AFTER_HORIZON)).rejects.toThrow(/decision event/);

    mockPrisma.aiRecommendation.findUnique.mockResolvedValue({ ...rec(), canonicalRefs: {} });
    await expect(service.snapshotOne('rec-1', AFTER_HORIZON)).rejects.toThrow(/zoneKey/);
  });
});

describe('OutcomeSnapshotService — batch bounds', () => {
  it('processes due recommendations in bounded batches (never more than 100)', async () => {
    mockPrisma.aiRecommendation.findMany.mockResolvedValue([]);

    await service.snapshotDue(5000);

    const args = mockPrisma.aiRecommendation.findMany.mock.calls[0][0];
    expect(args.take).toBe(100);
    expect(args.where.status.in).toEqual(['adopted', 'dismissed', 'outcome_pending']);
  });

  it('one failing snapshot never blocks the rest of the batch', async () => {
    mockPrisma.aiRecommendation.findMany.mockResolvedValue([{ id: 'bad' }, { id: 'rec-1' }]);
    mockPrisma.aiRecommendation.findUnique.mockImplementation(async (args: any) =>
      args.where.id === 'bad' ? null : rec(),
    );

    const res = await service.snapshotDue(100, AFTER_HORIZON);

    expect(res.skipped).toBe(1);
    expect(res.snapshotted).toBe(1);
  });
});
