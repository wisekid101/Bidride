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
