import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { RecommendationLedgerService, encodeCursor, decodeCursor } from './recommendation-ledger.service';
import { INSUFFICIENT_EVIDENCE, UniversalRecommendation } from './recommendation.types';

const mockTx = {
  aiRecommendation: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
  aiRecommendationEvent: { create: jest.fn() },
};

const mockPrisma = {
  aiRecommendation: {
    create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn(), update: jest.fn(),
  },
  aiRecommendationEvent: { create: jest.fn() },
  $transaction: jest.fn(),
} as any;

const service = new RecommendationLedgerService(mockPrisma);
const founder = { actor: 'marq@bidride.com', actorRole: 'founder' };

const validRec = (): UniversalRecommendation => ({
  domain: 'opportunity',
  family: 'zone-opportunity',
  recommendationType: 'marketplace_opportunity',
  title: 'Test opportunity',
  summary: 'Test.',
  recommendation: { action: 'review_zone_opportunity' },
  confidence: 0.5,
  sampleSize: 10,
  evidence: [{ source: 'trips (canonical)', metric: 'zone_requests', value: 10, asOf: '2026-07-11T00:00:00Z' }],
  reasoning: ['Because zone requests measured 10 in the window (n=10).'],
  expectedOutcome: 'Better zone.',
  expectedValue: { metric: 'trips', delta: '+', horizon: '4w' },
  alternatives: [],
  why: 'Evidence.', whyNot: 'Small n.', rollback: 'Advisory only.',
  businessImpact: 'Focus.', userImpact: 'None.', safetyImpact: 'none', revenueImpact: 'Indirect.', trustImpact: 'Neutral.',
  constitutionTags: ['meaningful_ai'],
  sourceVersion: 'opportunity-v1',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? arg(mockTx) : Promise.all(arg),
  );
  mockTx.aiRecommendation.create.mockResolvedValue({ id: 'rec-1' });
  mockTx.aiRecommendation.update.mockResolvedValue({});
  mockTx.aiRecommendation.updateMany.mockResolvedValue({ count: 1 });
  mockTx.aiRecommendationEvent.create.mockResolvedValue({});
});

describe('ledger — create', () => {
  it('stores a valid recommendation as proposed with a create audit event', async () => {
    const { id } = await service.create(validRec());

    expect(id).toBe('rec-1');
    expect(mockTx.aiRecommendation.create.mock.calls[0][0].data.status).toBe('proposed');
    const event = mockTx.aiRecommendationEvent.create.mock.calls[0][0].data;
    expect(event).toMatchObject({ actor: 'ai-service', actorRole: 'system', action: 'create', newStatus: 'proposed' });
  });

  it('rejects invalid recommendations with 422 and the full violation list', async () => {
    const bad = { ...validRec(), evidence: [], constitutionTags: [] };
    await expect(service.create(bad)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(mockTx.aiRecommendation.create).not.toHaveBeenCalled();
  });

  it('rejects recommendations from reserved (inactive) domains as 422', async () => {
    const reserved = { ...validRec(), domain: 'delivery' };
    await expect(service.create(reserved)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects recommendations from unmanifested domains as 422', async () => {
    const unknown = { ...validRec(), domain: 'shadow-govt' };
    await expect(service.create(unknown)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects families not declared in the domain manifest', async () => {
    const rogue = { ...validRec(), family: 'rogue-family' };
    await expect(service.create(rogue)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(mockTx.aiRecommendation.create).not.toHaveBeenCalled();
  });

  it('a concurrent decision surfaces as a conflict, never a silent overwrite', async () => {
    mockTx.aiRecommendation.findUnique.mockResolvedValue({ id: 'rec-1', status: 'viewed' });
    mockTx.aiRecommendation.updateMany.mockResolvedValue({ count: 0 }); // someone else moved it
    await expect(service.adopt('rec-1', founder, 'race test')).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts an honest insufficient-evidence recommendation', async () => {
    const thin = { ...validRec(), sampleSize: 2, insufficientEvidence: true, expectedValue: INSUFFICIENT_EVIDENCE };
    await expect(service.create(thin)).resolves.toEqual({ id: 'rec-1' });
  });
});

describe('ledger — lifecycle transitions', () => {
  const setStatus = (status: string) =>
    mockTx.aiRecommendation.findUnique.mockResolvedValue({ id: 'rec-1', status });

  it('proposed → viewed → adopted, with audit fields on every step', async () => {
    setStatus('proposed');
    await service.markViewed('rec-1', founder);
    setStatus('viewed');
    await service.adopt('rec-1', founder, 'Strong evidence; assigning ops review.');

    const events = mockTx.aiRecommendationEvent.create.mock.calls.map((c) => c[0].data);
    expect(events[0]).toMatchObject({ action: 'view', previousStatus: 'proposed', newStatus: 'viewed', actor: founder.actor, actorRole: 'founder' });
    expect(events[1]).toMatchObject({ action: 'adopt', previousStatus: 'viewed', newStatus: 'adopted', reason: 'Strong evidence; assigning ops review.' });
  });

  it('adopt and dismiss REQUIRE a reason', () => {
    setStatus('viewed');
    expect(() => service.adopt('rec-1', founder, '')).toThrow(BadRequestException);
    expect(() => service.dismiss('rec-1', founder, '  ')).toThrow(BadRequestException);
  });

  it('rejects illegal transitions (dismissed is terminal)', async () => {
    setStatus('dismissed');
    await expect(service.adopt('rec-1', founder, 'changed my mind')).rejects.toBeInstanceOf(ConflictException);
  });

  it('an expired recommendation cannot be adopted', async () => {
    setStatus('expired');
    await expect(service.adopt('rec-1', founder, 'late adopt')).rejects.toBeInstanceOf(ConflictException);
  });

  it('viewing twice is a no-op, not an error', async () => {
    setStatus('viewed');
    await expect(service.markViewed('rec-1', founder)).resolves.toMatchObject({ changed: false });
  });

  it('outcome scoring requires a bounded score and lands on outcome_scored', async () => {
    setStatus('adopted');
    await expect(service.scoreOutcome('rec-1', founder, 1.5)).rejects.toBeInstanceOf(BadRequestException);
    await service.scoreOutcome('rec-1', founder, 0.8, 'zone trips rose');
    expect(mockTx.aiRecommendation.updateMany.mock.calls[0][0].data.status).toBe('outcome_scored');
  });
});

describe('ledger — cursor pagination', () => {
  const row = (id: string, iso: string) => ({
    id, createdAt: new Date(iso), domain: 'opportunity', family: 'zone-opportunity',
    recommendationType: 't', title: 't', status: 'proposed', confidence: 0.5, sampleSize: 5,
    constitutionTags: [], outcomeScore: null, expiresAt: null,
  });

  beforeEach(() => {
    mockPrisma.aiRecommendation.findMany.mockResolvedValue([]);
    mockPrisma.aiRecommendation.count.mockResolvedValue(0);
  });

  it('caps page size at 100 and over-fetches one to detect a next page', async () => {
    await service.list({ limit: 5000 });
    expect(mockPrisma.aiRecommendation.findMany.mock.calls[0][0].take).toBe(101); // 100 + 1
  });

  it('orders by (createdAt desc, id desc) for stable keyset pagination', async () => {
    await service.list({ limit: 10 });
    expect(mockPrisma.aiRecommendation.findMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: 'desc' }, { id: 'desc' },
    ]);
  });

  it('returns a nextCursor only when more rows exist, and never returns the extra row', async () => {
    // limit 2, but 3 rows returned → hasMore
    mockPrisma.aiRecommendation.findMany.mockResolvedValue([
      row('c', '2026-07-03T00:00:00Z'), row('b', '2026-07-02T00:00:00Z'), row('a', '2026-07-01T00:00:00Z'),
    ]);
    const res = await service.list({ limit: 2 });
    expect(res.items.map((i) => i.id)).toEqual(['c', 'b']); // extra 'a' withheld
    expect(res.nextCursor).toBeTruthy();
  });

  it('no nextCursor on the last page', async () => {
    mockPrisma.aiRecommendation.findMany.mockResolvedValue([row('b', '2026-07-02T00:00:00Z')]);
    const res = await service.list({ limit: 2 });
    expect(res.nextCursor).toBeNull();
  });

  it('a next-page cursor produces a keyset predicate that breaks ties by id (no dup/skip on equal timestamps)', async () => {
    const cursor = encodeCursor({ createdAt: new Date('2026-07-02T00:00:00Z'), id: 'b' });
    await service.list({ limit: 10, cursor });
    const where = mockPrisma.aiRecommendation.findMany.mock.calls[0][0].where;
    // AND[filters, OR[ createdAt<cursor, (createdAt=cursor AND id<cursorId) ]]
    const or = where.AND[1].OR;
    expect(or[0]).toEqual({ createdAt: { lt: new Date('2026-07-02T00:00:00Z') } });
    expect(or[1]).toEqual({ createdAt: new Date('2026-07-02T00:00:00Z'), id: { lt: 'b' } });
  });

  it('rejects a malformed cursor', async () => {
    await expect(service.list({ limit: 10, cursor: 'not-a-real-cursor!!' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects date ranges wider than a year', async () => {
    await expect(
      service.list({ limit: 10, from: new Date('2020-01-01'), to: new Date('2026-01-01') }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters by domain, status, and constitution tag (total is filter-scoped)', async () => {
    await service.list({ limit: 10, domain: 'opportunity', status: 'proposed', constitutionTag: 'meaningful_ai' });
    const findWhere = mockPrisma.aiRecommendation.findMany.mock.calls[0][0].where;
    expect(findWhere).toMatchObject({ domain: 'opportunity', status: 'proposed', constitutionTags: { has: 'meaningful_ai' } });
    // count uses the same filter (no keyset), so the total is meaningful
    expect(mockPrisma.aiRecommendation.count.mock.calls[0][0].where).toMatchObject({ domain: 'opportunity' });
  });
});

describe('cursor encode/decode round-trips', () => {
  it('round-trips createdAt + id and rejects garbage', () => {
    const k = { createdAt: new Date('2026-07-02T03:04:05.678Z'), id: 'abc-123' };
    const decoded = decodeCursor(encodeCursor(k));
    expect(decoded.createdAt.toISOString()).toBe(k.createdAt.toISOString());
    expect(decoded.id).toBe('abc-123');
    expect(() => decodeCursor('###')).toThrow();
  });
});

describe('ledger — expiry sweep', () => {
  it('expires stale proposed/viewed rows with audit events', async () => {
    mockPrisma.aiRecommendation.findMany.mockResolvedValue([{ id: 'old-1', status: 'proposed' }]);
    mockPrisma.$transaction.mockResolvedValue([]);

    const res = await service.expireSweep();

    expect(res.expired).toBe(1);
    const where = mockPrisma.aiRecommendation.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['proposed', 'viewed']);
  });
});
