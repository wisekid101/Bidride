import { Prisma } from '@bidride/database/generated/client';
import { BidOutcomeService } from './bid-outcome.service';

// The upsert runs inside prisma.$transaction — the mock hands the callback a
// tx client and records the isolation level it was asked for.
const mockTx = {
  bidOutcome: {
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
};

const mockPrisma = {
  aiInferenceLog: { findFirst: jest.fn() },
  driverBidExposure: { count: jest.fn() },
  $transaction: jest.fn(),
} as any;

const service = new BidOutcomeService(mockPrisma);

// recordOutcome's DB write is fire-and-forget — flush the microtask queue so
// assertions observe the completed write.
const flush = () => new Promise((r) => setImmediate(r));

const serializationFailure = () =>
  new Prisma.PrismaClientKnownRequestError('serialization failure', {
    code: 'P2034',
    clientVersion: 'test',
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.aiInferenceLog.findFirst.mockResolvedValue(null);
  mockPrisma.driverBidExposure.count.mockResolvedValue(0);
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx));
  mockTx.bidOutcome.findFirst.mockResolvedValue(null);
  mockTx.bidOutcome.create.mockResolvedValue({});
  mockTx.bidOutcome.update.mockResolvedValue({});
});

// ─── One complete outcome chain per trip ──────────────────────────────────────

describe('BidOutcomeService — submit + completion form ONE outcome row', () => {
  it('creates the row on the first event for a trip', async () => {
    await service.recordOutcome({ tripId: 'trip-1', bidId: 'bid-1', wasAccepted: true, finalAcceptedAmount: 16.5 });
    await flush();

    expect(mockTx.bidOutcome.create).toHaveBeenCalledTimes(1);
    expect(mockTx.bidOutcome.update).not.toHaveBeenCalled();
    const { data } = mockTx.bidOutcome.create.mock.calls[0][0];
    expect(data.tripId).toBe('trip-1');
    expect(data.finalAcceptedAmount).toEqual(new Prisma.Decimal(16.5));
  });

  it('updates the existing row on the completion event — never a second row', async () => {
    mockTx.bidOutcome.findFirst.mockResolvedValue({ id: 'row-1' });

    await service.recordOutcome({
      tripId: 'trip-1', wasAccepted: true,
      finalFare: 16.5, driverEarnings: 12.9, platformFee: 3.6,
    });
    await flush();

    expect(mockTx.bidOutcome.create).not.toHaveBeenCalled();
    expect(mockTx.bidOutcome.update).toHaveBeenCalledTimes(1);
    const call = mockTx.bidOutcome.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'row-1' });
    expect(call.data.finalFare).toEqual(new Prisma.Decimal(16.5));
    expect(call.data.driverEarnings).toEqual(new Prisma.Decimal(12.9));
    expect(call.data.platformFee).toEqual(new Prisma.Decimal(3.6));
  });

  it('fields omitted by the later event keep their submit-time values (undefined = Prisma no-op)', async () => {
    mockTx.bidOutcome.findFirst.mockResolvedValue({ id: 'row-1' });

    // Completion event carries money but no bidId/zoneKey — those came from submit.
    await service.recordOutcome({ tripId: 'trip-1', wasAccepted: true, finalFare: 20 });
    await flush();

    const { data } = mockTx.bidOutcome.update.mock.calls[0][0];
    expect(data.bidId).toBeUndefined();
    expect(data.zoneKey).toBeUndefined();
    expect(data.finalAcceptedAmount).toBeUndefined();
    expect(data.finalFare).toEqual(new Prisma.Decimal(20));
  });

  it('a rejection followed by later acceptance overwrites wasAccepted (repeated events)', async () => {
    // Event 1 — rejected at submit time: creates the row.
    await service.recordOutcome({ tripId: 'trip-2', bidId: 'bid-2', wasAccepted: false });
    await flush();
    expect(mockTx.bidOutcome.create).toHaveBeenCalledTimes(1);
    expect(mockTx.bidOutcome.create.mock.calls[0][0].data.wasAccepted).toBe(false);

    // Event 2 — the same trip completes: updates, never duplicates.
    mockTx.bidOutcome.findFirst.mockResolvedValue({ id: 'row-2' });
    await service.recordOutcome({ tripId: 'trip-2', wasAccepted: true, finalFare: 18 });
    await flush();

    expect(mockTx.bidOutcome.create).toHaveBeenCalledTimes(1); // still one
    expect(mockTx.bidOutcome.update).toHaveBeenCalledTimes(1);
    expect(mockTx.bidOutcome.update.mock.calls[0][0].data.wasAccepted).toBe(true);
  });

  it('acceptance is STICKY: a late per-driver rejection cannot flip a completed acceptance', async () => {
    // Completion already recorded wasAccepted=true; a declining driver's
    // rejection event arrives afterwards.
    mockTx.bidOutcome.findFirst.mockResolvedValue({ id: 'row-late', wasAccepted: true });
    mockPrisma.aiInferenceLog.findFirst.mockResolvedValue({
      output: { probability: 0.5, shadowRecommendation: 0.61 },
      confidence: 0.6,
      modelVersion: 'rule-v1',
    });

    await service.recordOutcome({ tripId: 'trip-late', bidId: 'bid-late', wasAccepted: false });
    await flush();

    const { data } = mockTx.bidOutcome.update.mock.calls[0][0];
    expect(data.wasAccepted).toBe(true); // sticky
    expect(data.predictionCorrect).toBe(true); // 0.61 ≥ 0.5 scored against the STICKY truth
  });

  it('is idempotent: replaying the same completion event just rewrites the same row', async () => {
    mockTx.bidOutcome.findFirst.mockResolvedValue({ id: 'row-3' });

    const dto = { tripId: 'trip-3', wasAccepted: true, finalFare: 22 };
    await service.recordOutcome(dto);
    await service.recordOutcome(dto);
    await flush();

    expect(mockTx.bidOutcome.create).not.toHaveBeenCalled();
    expect(mockTx.bidOutcome.update).toHaveBeenCalledTimes(2);
    expect(mockTx.bidOutcome.update.mock.calls[0][0]).toEqual(mockTx.bidOutcome.update.mock.calls[1][0]);
  });
});

// ─── Concurrency: serializable transaction + bounded retry ───────────────────

describe('BidOutcomeService — concurrency', () => {
  it('runs the read-then-write inside a SERIALIZABLE transaction', async () => {
    await service.recordOutcome({ tripId: 'trip-4', wasAccepted: true });
    await flush();

    expect(mockPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });

  it('retries on serialization conflict (P2034) and lands on the update path', async () => {
    // Attempt 1: concurrent writer wins → P2034. Attempt 2: row now exists.
    mockPrisma.$transaction
      .mockRejectedValueOnce(serializationFailure())
      .mockImplementation(async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx));
    mockTx.bidOutcome.findFirst.mockResolvedValue({ id: 'row-5' });

    await service.recordOutcome({ tripId: 'trip-5', wasAccepted: true, finalFare: 19 });
    await flush();

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mockTx.bidOutcome.update).toHaveBeenCalledTimes(1);
    expect(mockTx.bidOutcome.create).not.toHaveBeenCalled();
  });

  it('gives up after bounded retries without throwing to the caller', async () => {
    mockPrisma.$transaction.mockRejectedValue(serializationFailure());

    await expect(
      service.recordOutcome({ tripId: 'trip-6', wasAccepted: false }),
    ).resolves.toBeUndefined();
    await flush();

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

// ─── Failure handling — outcome audit never breaks callers ───────────────────

describe('BidOutcomeService — failure handling', () => {
  it('a database outage never throws to the caller (fire-and-forget)', async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error('db down'));

    await expect(
      service.recordOutcome({ tripId: 'trip-7', wasAccepted: true }),
    ).resolves.toBeUndefined();
    await flush();

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1); // non-P2034 → no retry
  });

  it('an inference-log lookup failure still records the outcome', async () => {
    mockPrisma.aiInferenceLog.findFirst.mockRejectedValue(new Error('log table gone'));

    await service.recordOutcome({ tripId: 'trip-8', wasAccepted: true });
    await flush();

    expect(mockTx.bidOutcome.create).toHaveBeenCalledTimes(1);
    const { data } = mockTx.bidOutcome.create.mock.calls[0][0];
    expect(data.predictionProbability).toBeNull();
    expect(data.predictionCorrect).toBeNull();
  });
});

// ─── Prediction linkage ───────────────────────────────────────────────────────

describe('BidOutcomeService — prediction linkage', () => {
  it('links the latest bid-win-probability inference and scores its correctness', async () => {
    mockPrisma.aiInferenceLog.findFirst.mockResolvedValue({
      output: { probability: 0.8 },
      confidence: 0.7,
      modelVersion: 'rule-v1',
    });

    await service.recordOutcome({ tripId: 'trip-9', wasAccepted: true });
    await flush();

    const { data } = mockTx.bidOutcome.create.mock.calls[0][0];
    expect(data.predictionProbability).toEqual(new Prisma.Decimal(0.8));
    expect(data.predictionConfidence).toEqual(new Prisma.Decimal(0.7));
    expect(data.predictionCorrect).toBe(true); // 0.8 ≥ 0.5 and accepted
    expect(data.modelVersion).toBe('rule-v1');
  });

  it('scores the REAL shadow prediction, never the served neutral 0.5', async () => {
    mockPrisma.aiInferenceLog.findFirst.mockResolvedValue({
      output: { probability: 0.5, shadow: true, shadowRecommendation: 0.39 },
      confidence: 0.63,
      modelVersion: 'rule-v1',
    });

    await service.recordOutcome({ tripId: 'trip-14', wasAccepted: true });
    await flush();

    const { data } = mockTx.bidOutcome.create.mock.calls[0][0];
    expect(data.predictionProbability).toEqual(new Prisma.Decimal(0.39));
    expect(data.predictionCorrect).toBe(false); // model said <0.5, bid was accepted
  });
});

// ─── driversViewed / driversIgnored derivation (pre-existing behavior) ───────

describe('BidOutcomeService — driversViewed from driver_bid_exposures', () => {
  it('queries driver_bid_exposures count when bidId is provided', async () => {
    mockPrisma.driverBidExposure.count.mockResolvedValue(4);

    await service.recordOutcome({ tripId: 'trip-10', bidId: 'bid-10', wasAccepted: true });
    await flush();

    expect(mockPrisma.driverBidExposure.count).toHaveBeenCalledWith({ where: { bidId: 'bid-10' } });
    expect(mockTx.bidOutcome.create.mock.calls[0][0].data.driversViewed).toBe(4);
  });

  it('uses dto.driversViewed when no bidId is provided', async () => {
    await service.recordOutcome({ tripId: 'trip-11', wasAccepted: false, driversViewed: 5 });
    await flush();

    expect(mockPrisma.driverBidExposure.count).not.toHaveBeenCalled();
    expect(mockTx.bidOutcome.create.mock.calls[0][0].data.driversViewed).toBe(5);
  });

  it('computes driversIgnored as viewed minus declined minus countered minus accepted', async () => {
    mockPrisma.driverBidExposure.count.mockResolvedValue(6);

    await service.recordOutcome({
      tripId: 'trip-12', bidId: 'bid-12', wasAccepted: true,
      driversDeclined: 2, driversCountered: 1,
    });
    await flush();

    // driversIgnored = 6 - 2 - 1 - 1 (accepted) = 2
    const { data } = mockTx.bidOutcome.create.mock.calls[0][0];
    expect(data.driversViewed).toBe(6);
    expect(data.driversIgnored).toBe(2);
    expect(data.driversDeclined).toBe(2);
    expect(data.driversCountered).toBe(1);
  });

  it('clamps driversIgnored to 0 when counts exceed viewed', async () => {
    mockPrisma.driverBidExposure.count.mockResolvedValue(1);

    await service.recordOutcome({
      tripId: 'trip-13', bidId: 'bid-13', wasAccepted: false, driversDeclined: 3,
    });
    await flush();

    expect(mockTx.bidOutcome.create.mock.calls[0][0].data.driversIgnored).toBe(0);
  });
});
