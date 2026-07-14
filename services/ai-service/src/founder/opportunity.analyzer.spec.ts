import { OpportunityAnalyzer } from './opportunity.analyzer';
import { validateRecommendation } from '../recommendations/recommendation-validator';
import { UniversalRecommendation } from '../recommendations/recommendation.types';

const mockPrisma = {
  trip: { findMany: jest.fn() },
  aiRecommendation: { findFirst: jest.fn() },
  tripEvent: { findMany: jest.fn() },
  bidOutcome: { findMany: jest.fn() },
} as any;

// Capture what the analyzer submits to the ledger and vet it against the contract.
const created: UniversalRecommendation[] = [];
const mockLedger = {
  create: jest.fn(async (rec: UniversalRecommendation) => {
    const errors = validateRecommendation(rec);
    if (errors.length) throw new Error(`contract violation: ${errors.join('; ')}`);
    created.push(rec);
    return { id: `rec-${created.length}` };
  }),
} as any;

let trustedIds = new Set<string>();
const mockQuality = {
  classesFor: jest.fn(async (ids: string[]) => {
    const map = new Map<string, string>();
    for (const id of ids) if (trustedIds.has(id)) map.set(id, 'trusted');
    return map;
  }),
  reset: jest.fn(),
} as any;

const analyzer = new OpportunityAnalyzer(mockPrisma, mockLedger, mockQuality);
const NOW = new Date('2026-07-11T12:00:00Z');
const IN_WINDOW = new Date('2026-07-09T12:00:00Z');

const trip = (id: string, over: Partial<Record<string, unknown>> = {}) => ({
  id, status: 'completed', pickupLat: 40.7360, pickupLng: -74.1720,
  driverEarnings: 12, earningsSupplement: 0, driverId: 'driver-A', finalFare: 15,
  createdAt: IN_WINDOW, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  created.length = 0;
  mockPrisma.trip.findMany.mockResolvedValue([]);
  mockPrisma.aiRecommendation.findFirst.mockResolvedValue(null);
  mockPrisma.tripEvent.findMany.mockResolvedValue([]);
  trustedIds = new Set();
  mockPrisma.bidOutcome.findMany.mockResolvedValue([]);
});

describe('OpportunityAnalyzer', () => {
  it('produces an honest insufficient-evidence recommendation when no zone has enough data', async () => {
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args?.where?.createdAt?.gte && args?.where?.createdAt?.lte ? [trip('t1'), trip('t2')] : [],
    );

    const res = await analyzer.generate(NOW);

    expect(res.kind).toBe('insufficient_evidence');
    expect(created[0].insufficientEvidence).toBe(true);
    expect(created[0].recommendation.action).toBe('no_action');
    expect(created[0].expectedValue).toBe('insufficient_evidence');
  });

  it('detects a supply shortage and emits a contract-valid recommendation', async () => {
    const trips = Array.from({ length: 12 }, (_, i) => trip(`t${i}`, { driverId: 'driver-A' })); // 12 requests, 1 driver
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args?.where?.createdAt?.lte ? trips : [],
    );
    trustedIds = new Set(trips.map((t) => t.id));

    const res = await analyzer.generate(NOW);

    expect(res.kind).toBe('supply_shortage');
    expect(res.zone).toBe('2263:-3372');
    const rec = created[0];
    expect(rec.domain).toBe('opportunity');
    expect(rec.sampleSize).toBe(12);
    expect(rec.evidence.length).toBeGreaterThanOrEqual(4);
    expect(rec.whyNot).toBeTruthy();
    expect(rec.safetyImpact).toMatch(/^none/);
    // ledger.create ran the full validator — reaching here means the contract passed
    expect(mockLedger.create).toHaveBeenCalledTimes(1);
  });

  it('never identifies individual riders or drivers — zone aggregates only', async () => {
    const trips = Array.from({ length: 12 }, (_, i) => trip(`t${i}`));
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args?.where?.createdAt?.lte ? trips : [],
    );

    await analyzer.generate(NOW);

    const flat = JSON.stringify(created[0]);
    expect(flat).not.toContain('driver-A'); // driver ids never leave the aggregate
    expect(flat).not.toMatch(/40\.73/); // no raw coordinates — zone keys only
  });

  it('flags a driver-earnings gap when quality-gated take-home is below target', async () => {
    // 8 completed trusted trips at $6 take-home (< $10 target), 3 distinct drivers.
    const trips = Array.from({ length: 8 }, (_, i) =>
      trip(`t${i}`, { driverEarnings: 6, driverId: `driver-${i % 3}` }),
    );
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args?.where?.createdAt?.lte ? trips : [],
    );
    trustedIds = new Set(trips.map((t) => t.id));

    const res = await analyzer.generate(NOW);

    expect(res.kind).toBe('driver_earnings_gap');
    const evidence = created[0].evidence.find((e) => e.metric === 'avg_driver_take_home_usd')!;
    expect(evidence.value).toBe(6);
    expect(evidence.source).toContain('canonical');
  });

  it('deduplicates: an undecided same-window recommendation is returned, not recreated', async () => {
    mockPrisma.aiRecommendation.findFirst.mockResolvedValue({ id: 'existing-rec', recommendationType: 'marketplace_opportunity' });

    const res = await analyzer.generate(NOW);

    expect(res).toEqual({ id: 'existing-rec', kind: 'deduplicated', deduplicated: true });
    expect(mockLedger.create).not.toHaveBeenCalled();
  });

  it('reports "no actionable gap" honestly when zones are healthy', async () => {
    const trips = Array.from({ length: 10 }, (_, i) =>
      trip(`t${i}`, { driverEarnings: 14, driverId: `driver-${i % 5}` }),
    );
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args?.where?.createdAt?.lte ? trips : [],
    );
    trustedIds = new Set(trips.map((t) => t.id));

    const res = await analyzer.generate(NOW);
    expect(res.kind).toBe('no_actionable_gap');
  });
});
