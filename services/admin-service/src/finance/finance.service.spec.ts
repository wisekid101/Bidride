import { Test, TestingModule } from '@nestjs/testing';
import { FinanceService } from './finance.service';
import { PrismaService } from '../prisma/prisma.service';

// ─── F3a: capture-failure retrieval ──────────────────────────────────────────
// The surface operations uses to find captures that did not land. It reads trip
// events, not payments: a failed capture writes no Payment row at all, so
// getFailedPayments is structurally blind to it.
//
// The load-bearing property is that `outcome` comes from the event TYPE. A
// definitive refusal (money did not move) must never be reported as an
// uncertain outcome (money may have moved and needs checking against Stripe),
// and metadata — which a caller could corrupt — must not be able to flip it.

const FAILED = 'payment_capture_failed';
const UNKNOWN = 'payment_capture_outcome_unknown';

const makeEvent = (eventType: string, over: Record<string, unknown> = {}) => ({
  id: `evt-${eventType}`,
  tripId: 'trip-1',
  eventType,
  metadata: {
    outcome: eventType === FAILED ? 'failed' : 'unknown',
    code: eventType === FAILED ? 'CAPTURE_FAILED' : 'CAPTURE_OUTCOME_UNKNOWN',
    paymentIntentId: 'pi_1',
    requestedAmountCents: 2364,
    source: 'payment-service',
  },
  createdAt: new Date('2026-07-27T10:00:00Z'),
  trip: {
    id: 'trip-1', status: 'completed', riderId: 'rider-1', driverId: 'driver-1',
    finalFare: 23.64, bidId: 'bid-1', completedAt: new Date('2026-07-27T09:55:00Z'),
  },
  ...over,
});

describe('FinanceService — capture failures (F3a)', () => {
  let service: FinanceService;
  let prisma: { tripEvent: { findMany: jest.Mock } };

  const argsOf = () => prisma.tripEvent.findMany.mock.calls[0][0];

  beforeEach(async () => {
    prisma = { tripEvent: { findMany: jest.fn().mockResolvedValue([]) } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [FinanceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(FinanceService);
  });

  it('returns both event types when no outcome filter is given', async () => {
    await service.getCaptureFailures();

    expect(argsOf().where.eventType.in).toEqual([FAILED, UNKNOWN]);
  });

  it.each([
    ['failed', FAILED],
    ['unknown', UNKNOWN],
  ])('outcome=%s narrows to a single event type', async (outcome, eventType) => {
    await service.getCaptureFailures(50, outcome as 'failed' | 'unknown');

    expect(argsOf().where.eventType.in).toEqual([eventType]);
  });

  it('derives outcome from the event type, not from metadata', async () => {
    // Metadata deliberately disagrees with the type — the type must win.
    prisma.tripEvent.findMany.mockResolvedValue([
      makeEvent(FAILED, { metadata: { outcome: 'unknown' } }),
      makeEvent(UNKNOWN, { metadata: { outcome: 'failed' } }),
    ]);

    const [first, second] = await service.getCaptureFailures();

    expect(first.outcome).toBe('failed');
    expect(second.outcome).toBe('unknown');
  });

  it('exposes what operations needs to identify the affected trip', async () => {
    prisma.tripEvent.findMany.mockResolvedValue([makeEvent(FAILED)]);

    const [row] = await service.getCaptureFailures();

    expect(row).toMatchObject({
      tripId: 'trip-1',
      outcome: 'failed',
      eventType: FAILED,
    });
    expect(row.trip).toMatchObject({ id: 'trip-1', status: 'completed', riderId: 'rider-1' });
    expect(row.detail).toMatchObject({ paymentIntentId: 'pi_1', requestedAmountCents: 2364 });
    expect(row.occurredAt).toBeInstanceOf(Date);
  });

  it('returns the newest first and honours the limit', async () => {
    await service.getCaptureFailures(25);

    expect(argsOf().orderBy).toEqual({ createdAt: 'desc' });
    expect(argsOf().take).toBe(25);
  });

  it('returns an empty list when nothing has failed', async () => {
    await expect(service.getCaptureFailures()).resolves.toEqual([]);
  });
});

// ─── F3b-1: capture recovery worklist ───────────────────────────────────────
// The operational surface over the mutable work items. The rule this suite
// exists to hold: Operations can inspect, re-check and close — but nothing here
// can force a payment outcome. Only Stripe's reported state produces one.

const makeItem = (over: Record<string, unknown> = {}) => ({
  id: 'rec-1',
  tripId: 'trip-1',
  paymentIntentId: 'pi_1',
  bidId: 'bid-1',
  expectedAmountCents: 2364,
  status: 'unresolved',
  resolution: null,
  attemptNumber: 1,
  nextAttemptAt: new Date('2026-07-28T10:00:00Z'),
  lastError: null,
  holdExpiresAt: new Date('2026-08-03T10:00:00Z'),
  resolvedAt: null,
  resolvedByAdminId: null,
  createdAt: new Date('2026-07-28T09:00:00Z'),
  updatedAt: new Date('2026-07-28T09:00:00Z'),
  ...over,
});

describe('FinanceService — capture recovery (F3b-1)', () => {
  let service: FinanceService;
  let prisma: {
    captureRecovery: {
      findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock;
      groupBy: jest.Mock; findFirst: jest.Mock;
    };
    tripEvent: { findMany: jest.Mock; create: jest.Mock };
    trip: { findUnique: jest.Mock };
  };

  const listArgs = () => prisma.captureRecovery.findMany.mock.calls[0][0];

  beforeEach(async () => {
    prisma = {
      captureRecovery: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(makeItem()),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(makeItem(data))),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      tripEvent: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
      trip: { findUnique: jest.fn().mockResolvedValue({ id: 'trip-1', status: 'completed' }) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [FinanceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(FinanceService);
  });

  // ── Listing and filtering ────────────────────────────────────────────────

  it('lists newest first with a bounded limit', async () => {
    await service.getCaptureRecovery({ limit: 25 });

    expect(listArgs().orderBy).toEqual({ createdAt: 'desc' });
    expect(listArgs().take).toBe(25);
  });

  it.each([
    ['status', 'needs_admin'],
    ['resolution', 'awaiting_capture'],
    ['tripId', 'trip-9'],
    ['paymentIntentId', 'pi_9'],
  ])('filters by %s', async (field, value) => {
    await service.getCaptureRecovery({ [field]: value } as never);

    expect(listArgs().where[field]).toBe(value);
  });

  it('filters by date range', async () => {
    const from = new Date('2026-07-01');
    const to = new Date('2026-07-28');

    await service.getCaptureRecovery({ from, to });

    expect(listArgs().where.createdAt).toEqual({ gte: from, lte: to });
  });

  it('no filters means no where clause', async () => {
    await service.getCaptureRecovery();

    expect(listArgs().where).toEqual({});
  });

  // ── Detail ───────────────────────────────────────────────────────────────

  it('returns the item, its trip and the full capture/recovery history', async () => {
    prisma.tripEvent.findMany.mockResolvedValue([
      { id: 'e1', eventType: 'payment_capture_outcome_unknown', metadata: {}, createdAt: new Date() },
      { id: 'e2', eventType: 'payment_capture_recovered', metadata: {}, createdAt: new Date() },
    ]);

    const out = await service.getCaptureRecoveryItem('rec-1');

    expect(out!.item.id).toBe('rec-1');
    expect(out!.trip).toMatchObject({ id: 'trip-1' });
    expect(out!.history).toHaveLength(2);
    const types = prisma.tripEvent.findMany.mock.calls[0][0].where.eventType.in;
    expect(types).toEqual(expect.arrayContaining([
      'payment_capture_failed', 'payment_capture_outcome_unknown',
      'payment_capture_recovered', 'payment_capture_recovery_failed',
    ]));
  });

  it('a missing item returns null rather than throwing', async () => {
    prisma.captureRecovery.findUnique.mockResolvedValue(null);

    await expect(service.getCaptureRecoveryItem('nope')).resolves.toBeNull();
  });

  // ── Close ────────────────────────────────────────────────────────────────

  it('close records the admin, the reason and an audit event', async () => {
    await service.closeCaptureRecovery('rec-1', 'admin-7', 'settled out of band');

    expect(prisma.captureRecovery.update.mock.calls[0][0].data).toMatchObject({
      status: 'closed', resolution: 'closed_by_admin', resolvedByAdminId: 'admin-7',
    });
    expect(prisma.tripEvent.create.mock.calls[0][0].data.metadata).toMatchObject({
      adminId: 'admin-7', source: 'admin', previousStatus: 'unresolved',
    });
  });

  it('close can only ever reach `closed` — never a payment outcome', async () => {
    await service.closeCaptureRecovery('rec-1', 'admin-7', 'note');

    const written = prisma.captureRecovery.update.mock.calls[0][0].data.status;
    expect(written).toBe('closed');
    expect(['resolved_captured', 'resolved_not_captured']).not.toContain(written);
  });

  it('a reason is required', async () => {
    await expect(service.closeCaptureRecovery('rec-1', 'admin-7', '  ')).rejects.toThrow();
    expect(prisma.captureRecovery.update).not.toHaveBeenCalled();
  });

  it('closing a missing item is a 404', async () => {
    prisma.captureRecovery.findUnique.mockResolvedValue(null);

    await expect(service.closeCaptureRecovery('nope', 'admin-7', 'note')).rejects.toThrow();
  });

  // ── Metrics ──────────────────────────────────────────────────────────────

  it('reports worklist health', async () => {
    prisma.captureRecovery.groupBy.mockResolvedValue([
      { status: 'unresolved', _count: 3 },
      { status: 'resolved_captured', _count: 7 },
      { status: 'needs_admin', _count: 2 },
    ]);
    prisma.captureRecovery.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 3600_000) });
    prisma.captureRecovery.findMany.mockResolvedValue([
      { createdAt: new Date('2026-07-28T09:00:00Z'), resolvedAt: new Date('2026-07-28T09:01:00Z') },
      { createdAt: new Date('2026-07-28T09:00:00Z'), resolvedAt: new Date('2026-07-28T09:03:00Z') },
    ]);

    const m = await service.getCaptureRecoveryMetrics();

    expect(m.unresolvedCount).toBe(3);
    expect(m.needsAdminCount).toBe(2);
    expect(m.oldestUnresolvedAgeSeconds).toBeGreaterThanOrEqual(3590);
    expect(m.averageResolutionSeconds).toBe(120); // (60 + 180) / 2
    expect(m.terminalOutcomeCounts).toMatchObject({ resolved_captured: 7, needs_admin: 2 });
  });

  it('an empty worklist reports zeroes and nulls, not NaN', async () => {
    const m = await service.getCaptureRecoveryMetrics();

    expect(m.unresolvedCount).toBe(0);
    expect(m.oldestUnresolvedAgeSeconds).toBeNull();
    expect(m.averageResolutionSeconds).toBeNull();
  });
});
