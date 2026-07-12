import { DataQualityService, CLASSIFIER_VERSION } from './data-quality.service';

const mockPrisma = {
  trip: { findMany: jest.fn() },
  tripEvent: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  bid: { findUnique: jest.fn() },
  payment: { count: jest.fn(), findMany: jest.fn() },
} as any;

const service = new DataQualityService(mockPrisma);

// Route the two tripEvent.findMany call shapes: per-trip integrity lookups vs
// the summary's classification scan.
const setIntegrityEvents = (events: Array<{ metadata: unknown }>) => {
  mockPrisma.tripEvent.findMany.mockImplementation(async (args: any) =>
    args?.where?.eventType === 'fare_integrity_error' ? events : [],
  );
};

const oneTrip = (overrides: Partial<{ id: string; bidId: string | null; finalFare: number | null; aiFare: number }> = {}) => ({
  id: 'trip-1',
  bidId: null,
  finalFare: 20,
  aiFare: 20,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  setIntegrityEvents([]);
  mockPrisma.tripEvent.findFirst.mockResolvedValue(null);
  mockPrisma.tripEvent.create.mockResolvedValue({});
  mockPrisma.bid.findUnique.mockResolvedValue(null);
  mockPrisma.payment.count.mockResolvedValue(1);
  mockPrisma.payment.findMany.mockResolvedValue([{ amount: 20 }]);
});

const classifySingle = async (trip: ReturnType<typeof oneTrip>) => {
  mockPrisma.trip.findMany.mockResolvedValue([trip]);
  return service.classifyAll();
};

const writtenMetadata = () => mockPrisma.tripEvent.create.mock.calls[0][0].data.metadata;

// ─── C1–C5 classifications ────────────────────────────────────────────────────

describe('DataQualityService — C1..C5 verdicts', () => {
  it('C1: completed fare differing from the accepted negotiation is Excluded', async () => {
    mockPrisma.bid.findUnique.mockResolvedValue({ riderOffer: 14, counterOffer: null, finalFare: 14 });

    const res = await classifySingle(oneTrip({ bidId: 'bid-1', finalFare: 18.31 }));

    expect(res.counts.excluded).toBe(1);
    expect(writtenMetadata().reason).toContain('C1');
    expect(writtenMetadata().evidence.c1_acceptedOffer).toBe(14);
  });

  it('C2/C4: booked payment disagreeing with the canonical fare is Excluded', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([{ amount: 24.66 }]);

    const res = await classifySingle(oneTrip({ finalFare: 20.16 }));

    expect(res.counts.excluded).toBe(1);
    expect(writtenMetadata().reason).toContain('C4/C2');
  });

  it('C3: a bid trip with no payments row at all is Excluded (invisible settlement)', async () => {
    mockPrisma.bid.findUnique.mockResolvedValue({ riderOffer: 16, counterOffer: null, finalFare: 16 });
    mockPrisma.payment.count.mockResolvedValue(0);

    const res = await classifySingle(oneTrip({ bidId: 'bid-3', finalFare: 16 }));

    expect(res.counts.excluded).toBe(1);
    expect(writtenMetadata().reason).toContain('C3');
  });

  it('C4: no succeeded payment makes the trip Suspect — behavioral features only', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);

    const res = await classifySingle(oneTrip());

    expect(res.counts.suspect).toBe(1);
    expect(writtenMetadata().class).toBe('suspect');
    expect(writtenMetadata().reason).toContain('behavioral features only');
  });

  it('precedence: organic integrity error + no payment is Excluded, never softened to Suspect', async () => {
    setIntegrityEvents([{ metadata: {} }]);
    mockPrisma.payment.findMany.mockResolvedValue([]);

    const res = await classifySingle(oneTrip());

    expect(res.counts.excluded).toBe(1);
    expect(res.counts.suspect).toBe(0);
    expect(writtenMetadata().reason).toContain('C5');
  });

  it('a succeeded payment with a MISSING canonical fare is Suspect — never Trusted unreconciled', async () => {
    const res = await classifySingle(oneTrip({ finalFare: null }));

    expect(res.counts.suspect).toBe(1);
    expect(res.counts.trusted).toBe(0);
    expect(writtenMetadata().reason).toContain('canonical finalFare is missing');
  });

  it('C5: a bid trip completed with a frozen money chain (null finalFare) is Excluded', async () => {
    mockPrisma.bid.findUnique.mockResolvedValue({ riderOffer: 15, counterOffer: null, finalFare: 15 });

    const res = await classifySingle(oneTrip({ bidId: 'bid-5', finalFare: null }));

    expect(res.counts.excluded).toBe(1);
    expect(writtenMetadata().reason).toContain('C5');
  });

  it('C5: an organic fare_integrity_error is Excluded even when money reconciles', async () => {
    setIntegrityEvents([{ metadata: {} }]);

    const res = await classifySingle(oneTrip());

    expect(res.counts.excluded).toBe(1);
    expect(writtenMetadata().reason).toContain('C5');
  });

  it('flagged guard-test artifacts do NOT exclude an otherwise reconciled trip', async () => {
    setIntegrityEvents([{ metadata: { testArtifact: true } }]);

    const res = await classifySingle(oneTrip());

    expect(res.counts.trusted).toBe(1);
    expect(writtenMetadata().evidence.c5_integrityEvents).toBe(1);
  });

  it('a fully reconciled trip is Trusted', async () => {
    const res = await classifySingle(oneTrip());

    expect(res.counts).toEqual({ trusted: 1, reconciled: 0, suspect: 0, excluded: 0 });
    expect(writtenMetadata().class).toBe('trusted');
  });

  it('reconciled is never assigned automatically', async () => {
    mockPrisma.trip.findMany.mockResolvedValue([
      oneTrip({ id: 't-a' }),
      oneTrip({ id: 't-b', finalFare: null, bidId: 'bid-x' }),
    ]);
    mockPrisma.bid.findUnique.mockResolvedValue({ riderOffer: 10, counterOffer: null, finalFare: 10 });

    const res = await service.classifyAll();

    expect(res.counts.reconciled).toBe(0);
  });
});

// ─── Versioned evidence ───────────────────────────────────────────────────────

describe('DataQualityService — versioned evidence trail', () => {
  it('every classification event carries class, reason, evidence, version, and timestamp', async () => {
    await classifySingle(oneTrip());

    const call = mockPrisma.tripEvent.create.mock.calls[0][0].data;
    expect(call.eventType).toBe('data_quality_classified');
    expect(call.metadata).toEqual(expect.objectContaining({
      class: 'trusted',
      reason: expect.any(String),
      evidence: expect.any(Object),
      classifierVersion: CLASSIFIER_VERSION,
      classifiedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    }));
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('DataQualityService — idempotency', () => {
  it('re-running the classifier writes no duplicate event when the verdict is unchanged', async () => {
    mockPrisma.tripEvent.findFirst.mockResolvedValue({
      metadata: { class: 'trusted', classifierVersion: CLASSIFIER_VERSION },
    });

    const res = await classifySingle(oneTrip());

    expect(res.changed).toBe(0);
    expect(mockPrisma.tripEvent.create).not.toHaveBeenCalled();
  });

  it('a version bump re-records the verdict (audited reclassification, not mutation)', async () => {
    mockPrisma.tripEvent.findFirst.mockResolvedValue({
      metadata: { class: 'trusted', classifierVersion: 'dq-v0' },
    });

    const res = await classifySingle(oneTrip());

    expect(res.changed).toBe(1);
    expect(mockPrisma.tripEvent.create).toHaveBeenCalledTimes(1);
  });

  it('a changed verdict appends a new assessment event', async () => {
    mockPrisma.tripEvent.findFirst.mockResolvedValue({
      metadata: { class: 'suspect', classifierVersion: CLASSIFIER_VERSION },
    });

    const res = await classifySingle(oneTrip());

    expect(res.changed).toBe(1);
  });
});

// ─── Malformed inputs fail safely ─────────────────────────────────────────────

describe('DataQualityService — malformed inputs', () => {
  it('null metadata on integrity events is treated as organic (fail SAFE → Excluded)', async () => {
    setIntegrityEvents([{ metadata: null }]);

    const res = await classifySingle(oneTrip());

    expect(res.counts.excluded).toBe(1);
  });

  it('a bid trip whose bid row is missing still classifies without throwing', async () => {
    mockPrisma.bid.findUnique.mockResolvedValue(null);

    const res = await classifySingle(oneTrip({ bidId: 'bid-ghost', finalFare: 20 }));

    expect(res.classified).toBe(1);
    expect(res.counts.trusted + res.counts.suspect + res.counts.excluded).toBe(1);
  });

  it('classification events with malformed metadata are ignored by the summary', async () => {
    mockPrisma.tripEvent.findMany.mockImplementation(async (args: any) =>
      args?.where?.eventType === 'data_quality_classified'
        ? [
            { tripId: 't-1', metadata: null },
            { tripId: 't-2', metadata: { class: 'trusted' } },
          ]
        : [],
    );

    const summary = await service.summary();

    expect(summary.counts.trusted).toBe(1);
    expect(summary.counts.excluded).toBe(0);
  });
});

// ─── Summary accuracy ─────────────────────────────────────────────────────────

describe('DataQualityService — summary', () => {
  it('counts the LATEST assessment per trip and states the training gate', async () => {
    mockPrisma.tripEvent.findMany.mockImplementation(async (args: any) =>
      args?.where?.eventType === 'data_quality_classified'
        ? [
            // chronological order (orderBy createdAt asc): t-1 was suspect, then trusted
            { tripId: 't-1', metadata: { class: 'suspect' } },
            { tripId: 't-1', metadata: { class: 'trusted' } },
            { tripId: 't-2', metadata: { class: 'excluded' } },
          ]
        : [],
    );

    const summary = await service.summary();

    expect(summary.counts).toEqual({ trusted: 1, reconciled: 0, suspect: 0, excluded: 1 });
    expect(summary.classifierVersion).toBe(CLASSIFIER_VERSION);
    expect(summary.gate).toContain('Trusted + approved Reconciled ONLY');
  });
});
