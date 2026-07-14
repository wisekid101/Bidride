import { QualityClassService } from './quality-class.service';

const mockPrisma = {
  tripEvent: { findMany: jest.fn() },
} as any;

let service: QualityClassService;

const eventRow = (tripId: string, cls: string) => ({ tripId, metadata: { class: cls } });

beforeEach(() => {
  jest.clearAllMocks();
  service = new QualityClassService(mockPrisma);
  mockPrisma.tripEvent.findMany.mockResolvedValue([]);
});

describe('QualityClassService — bounded query shape', () => {
  it('queries ONLY the requested trip ids, latest-per-trip resolved in SQL (DISTINCT ON)', async () => {
    mockPrisma.tripEvent.findMany.mockResolvedValue([eventRow('t1', 'trusted')]);

    await service.classesFor(['t1', 't2']);

    const args = mockPrisma.tripEvent.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ eventType: 'data_quality_classified', tripId: { in: ['t1', 't2'] } });
    expect(args.distinct).toEqual(['tripId']);
    expect(args.orderBy).toEqual([{ tripId: 'asc' }, { createdAt: 'desc' }]);
  });

  it('chunks large id sets so the IN clause stays bounded (500 per query)', async () => {
    const ids = Array.from({ length: 1100 }, (_, i) => `t${i}`);

    await service.classesFor(ids);

    expect(mockPrisma.tripEvent.findMany).toHaveBeenCalledTimes(3);
    const sizes = mockPrisma.tripEvent.findMany.mock.calls.map((c) => c[0].where.tripId.in.length);
    expect(sizes).toEqual([500, 500, 100]);
  });

  it('deduplicates requested ids before querying', async () => {
    await service.classesFor(['t1', 't1', 't1']);
    expect(mockPrisma.tripEvent.findMany.mock.calls[0][0].where.tripId.in).toEqual(['t1']);
  });

  it('preserves Trusted/Reconciled/Suspect/Excluded semantics exactly', async () => {
    mockPrisma.tripEvent.findMany.mockResolvedValue([
      eventRow('t1', 'trusted'), eventRow('t2', 'reconciled'), eventRow('t3', 'suspect'), eventRow('t4', 'excluded'),
    ]);

    const classes = await service.classesFor(['t1', 't2', 't3', 't4', 't5']);
    expect(classes.get('t1')).toBe('trusted');
    expect(classes.get('t2')).toBe('reconciled');
    expect(classes.get('t3')).toBe('suspect');
    expect(classes.get('t4')).toBe('excluded');
    expect(classes.has('t5')).toBe(false); // unclassified stays absent

    const money = await service.moneyEligibleSubset(['t1', 't2', 't3', 't4', 't5']);
    expect(money).toEqual(new Set(['t1', 't2'])); // Suspect/Excluded never touch money
  });
});

describe('QualityClassService — cache', () => {
  afterEach(() => jest.restoreAllMocks());

  it('serves repeat reads from the 5-minute cache without re-querying', async () => {
    mockPrisma.tripEvent.findMany.mockResolvedValue([eventRow('t1', 'trusted')]);

    await service.classesFor(['t1', 't2']);
    await service.classesFor(['t1', 't2']);

    expect(mockPrisma.tripEvent.findMany).toHaveBeenCalledTimes(1); // second read fully cached (incl. known-unclassified t2)
  });

  it('queries only the uncached subset on partial hits', async () => {
    mockPrisma.tripEvent.findMany.mockResolvedValue([eventRow('t1', 'trusted')]);
    await service.classesFor(['t1']);

    await service.classesFor(['t1', 't9']);
    expect(mockPrisma.tripEvent.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.tripEvent.findMany.mock.calls[1][0].where.tripId.in).toEqual(['t9']);
  });

  it('expires cache entries after 5 minutes', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await service.classesFor(['t1']);

    now += 5 * 60_000 + 1;
    await service.classesFor(['t1']);

    expect(mockPrisma.tripEvent.findMany).toHaveBeenCalledTimes(2);
  });

  it('reset() invalidates immediately — the classifier hook', async () => {
    mockPrisma.tripEvent.findMany.mockResolvedValue([eventRow('t1', 'suspect')]);
    expect((await service.classesFor(['t1'])).get('t1')).toBe('suspect');

    // Classifier reclassifies then resets the cache.
    mockPrisma.tripEvent.findMany.mockResolvedValue([eventRow('t1', 'trusted')]);
    service.reset();

    expect((await service.classesFor(['t1'])).get('t1')).toBe('trusted');
  });
});

describe('QualityClassService — all-time gate counts', () => {
  it('latestClassCounts uses one DISTINCT ON query, never an in-memory history rescan', async () => {
    mockPrisma.tripEvent.findMany.mockResolvedValue([
      eventRow('t1', 'trusted'), eventRow('t2', 'excluded'), eventRow('t3', 'suspect'),
    ]);

    const { counts, total } = await service.latestClassCounts();

    const args = mockPrisma.tripEvent.findMany.mock.calls[0][0];
    expect(args.distinct).toEqual(['tripId']);
    expect(args.orderBy).toEqual([{ tripId: 'asc' }, { createdAt: 'desc' }]);
    expect(counts).toEqual({ trusted: 1, reconciled: 0, suspect: 1, excluded: 1 });
    expect(total).toBe(3);
  });
});
