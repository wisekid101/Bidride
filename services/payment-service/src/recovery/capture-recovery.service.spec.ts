import { NotFoundException } from '@nestjs/common';
import {
  CaptureRecoveryService,
  RECOVERY_STATUS,
  RECOVERY_EVENT_RESOLVED,
  RECOVERY_EVENT_UNRESOLVED,
  MAX_ATTEMPTS,
  RecoveryRow,
} from './capture-recovery.service';

// ─── F3b-1: capture recovery, read-only against Stripe ───────────────────────
// The invariant this whole suite exists to protect: recovery NEVER calls
// paymentIntents.capture, never books a Payment row and never touches the
// ledger. Acting on the answer is F3b-2. It also never invents an outcome —
// resolved_captured requires Stripe to say `succeeded`, and every ambiguous
// branch lands in needs_admin.

const makePrisma = () => ({
  captureRecovery: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  tripEvent: {
    create: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
  },
  payment: { create: jest.fn(), updateMany: jest.fn() },
  financialLedger: { create: jest.fn() },
});

const makeStripe = () => ({
  paymentIntents: {
    retrieve: jest.fn(),
    capture: jest.fn(), // must never be called
    create: jest.fn(),
    cancel: jest.fn(),
  },
});

const row = (over: Partial<RecoveryRow> = {}): RecoveryRow => ({
  id: 'rec-1',
  tripId: 'trip-1',
  paymentIntentId: 'pi_1',
  bidId: 'bid-1',
  expectedAmountCents: 2364,
  status: RECOVERY_STATUS.unresolved,
  attemptNumber: 1,
  holdExpiresAt: new Date(Date.now() + 3600_000),
  ...over,
});

describe('CaptureRecoveryService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let stripe: ReturnType<typeof makeStripe>;
  let service: CaptureRecoveryService;

  const updateData = () => prisma.captureRecovery.update.mock.calls[0][0].data;
  const eventData = () => prisma.tripEvent.create.mock.calls[0][0].data;

  beforeEach(() => {
    prisma = makePrisma();
    stripe = makeStripe();
    service = new CaptureRecoveryService(prisma as never, stripe as never);
  });

  /** The guarantee that defines this checkpoint. */
  const expectNoMoneyMoved = () => {
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(prisma.financialLedger.create).not.toHaveBeenCalled();
  };

  afterEach(expectNoMoneyMoved);

  // ── Stripe state → recovery state ───────────────────────────────────────

  it('succeeded → resolved_captured, recorded but NOT booked', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', status: 'succeeded', amount_received: 2364 });

    const out = await service.resolveOne(row());

    expect(out.status).toBe(RECOVERY_STATUS.resolvedCaptured);
    expect(out.resolution).toBe('stripe_reports_succeeded');
    expect(updateData()).toMatchObject({ status: RECOVERY_STATUS.resolvedCaptured, nextAttemptAt: null });
    expect(eventData().eventType).toBe(RECOVERY_EVENT_RESOLVED);
  });

  it('requires_capture → needs_admin, because capture is deferred to F3b-2', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', status: 'requires_capture' });

    const out = await service.resolveOne(row());

    expect(out.status).toBe(RECOVERY_STATUS.needsAdmin);
    expect(out.resolution).toBe('awaiting_capture');
  });

  it('canceled → resolved_not_captured', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', status: 'canceled' });

    const out = await service.resolveOne(row());

    expect(out.status).toBe(RECOVERY_STATUS.resolvedNotCaptured);
    expect(eventData().eventType).toBe(RECOVERY_EVENT_UNRESOLVED);
  });

  it('processing → stays unresolved with a later attempt scheduled', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', status: 'processing' });

    const out = await service.resolveOne(row());

    expect(out.retryScheduled).toBe(true);
    expect(out.status).toBe(RECOVERY_STATUS.unresolved);
    expect(updateData().nextAttemptAt).toBeInstanceOf(Date);
    expect(prisma.tripEvent.create).not.toHaveBeenCalled(); // not terminal yet
  });

  it.each([
    ['requires_payment_method'],
    ['requires_action'],
    ['requires_confirmation'],
  ])('%s → needs_admin', async (status) => {
    stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', status });

    const out = await service.resolveOne(row());

    expect(out.status).toBe(RECOVERY_STATUS.needsAdmin);
    expect(out.resolution).toBe('not_capturable');
  });

  it('a captured amount that differs from the expected amount → needs_admin, never adjusted', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', status: 'succeeded', amount_received: 1900 });

    const out = await service.resolveOne(row());

    expect(out.status).toBe(RECOVERY_STATUS.needsAdmin);
    expect(out.resolution).toBe('amount_mismatch');
    expect(eventData().metadata).toMatchObject({ amountReceivedCents: 1900, expectedAmountCents: 2364 });
  });

  // ── Lookup failures ──────────────────────────────────────────────────────

  it.each([
    ['StripeInvalidRequestError'],
    ['StripePermissionError'],
    ['StripeAuthenticationError'],
  ])('%s is not retryable → needs_admin', async (type) => {
    stripe.paymentIntents.retrieve.mockRejectedValue(Object.assign(new Error('x'), { type }));

    const out = await service.resolveOne(row());

    expect(out.status).toBe(RECOVERY_STATUS.needsAdmin);
    expect(out.resolution).toBe('lookup_rejected');
  });

  it('a connection error defers rather than deciding', async () => {
    stripe.paymentIntents.retrieve.mockRejectedValue(
      Object.assign(new Error('x'), { type: 'StripeConnectionError' }),
    );

    const out = await service.resolveOne(row({ attemptNumber: 2 }));

    expect(out.retryScheduled).toBe(true);
    expect(updateData().lastError).toContain('StripeConnectionError');
  });

  it('exhausted attempts → needs_admin, never a guessed outcome', async () => {
    stripe.paymentIntents.retrieve.mockRejectedValue(
      Object.assign(new Error('x'), { type: 'StripeConnectionError' }),
    );

    const out = await service.resolveOne(row({ attemptNumber: MAX_ATTEMPTS }));

    expect(out.status).toBe(RECOVERY_STATUS.needsAdmin);
    expect(out.resolution).toBe('attempts_exhausted');
  });

  it('an expired hold → needs_admin and Stripe is not even asked', async () => {
    const out = await service.resolveOne(row({ holdExpiresAt: new Date(Date.now() - 1000) }));

    expect(out.resolution).toBe('hold_expired');
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  // ── Handle resolution ────────────────────────────────────────────────────

  it('recovers the payment-intent id from a durable trip event when the row has none', async () => {
    prisma.tripEvent.findMany.mockResolvedValue([
      { metadata: { paymentIntentId: null } },
      { metadata: { paymentIntentId: 'pi_from_bid_submitted' } },
    ]);
    stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_from_bid_submitted', status: 'canceled' });

    const out = await service.resolveOne(row({ paymentIntentId: null }));

    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_from_bid_submitted');
    expect(out.status).toBe(RECOVERY_STATUS.resolvedNotCaptured);
  });

  it('no id anywhere → needs_admin, never a guess', async () => {
    prisma.tripEvent.findMany.mockResolvedValue([]);

    const out = await service.resolveOne(row({ paymentIntentId: null }));

    expect(out.resolution).toBe('handle_unresolvable');
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  // ── Enqueue ──────────────────────────────────────────────────────────────

  it('enqueues a new work item with a first attempt scheduled', async () => {
    const tx = { captureRecovery: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() } };

    await service.enqueue(tx as never, {
      tripId: 'trip-9', paymentIntentId: 'pi_9', bidId: 'bid-9', expectedAmountCents: 1000,
    });

    expect(tx.captureRecovery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tripId: 'trip-9', status: RECOVERY_STATUS.unresolved, attemptNumber: 0,
        expectedAmountCents: 1000,
      }),
    });
  });

  it('a second failure on an open item reschedules instead of duplicating', async () => {
    const tx = {
      captureRecovery: {
        findUnique: jest.fn().mockResolvedValue({ status: RECOVERY_STATUS.unresolved }),
        create: jest.fn(), update: jest.fn(),
      },
    };

    await service.enqueue(tx as never, {
      tripId: 'trip-9', paymentIntentId: 'pi_9', bidId: null, expectedAmountCents: 1000,
    });

    expect(tx.captureRecovery.create).not.toHaveBeenCalled();
    expect(tx.captureRecovery.update).toHaveBeenCalled();
  });

  it('never revives a resolved item', async () => {
    const tx = {
      captureRecovery: {
        findUnique: jest.fn().mockResolvedValue({ status: RECOVERY_STATUS.resolvedCaptured }),
        create: jest.fn(), update: jest.fn(),
      },
    };

    await service.enqueue(tx as never, {
      tripId: 'trip-9', paymentIntentId: 'pi_9', bidId: null, expectedAmountCents: 1000,
    });

    expect(tx.captureRecovery.create).not.toHaveBeenCalled();
    expect(tx.captureRecovery.update).not.toHaveBeenCalled();
  });

  // ── Webhook fast path ────────────────────────────────────────────────────

  it('resolves an open item straight from a webhook, with no extra Stripe read', async () => {
    prisma.captureRecovery.findFirst.mockResolvedValue(row());

    await service.resolveFromWebhook('pi_1', 'succeeded');

    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(updateData()).toMatchObject({ status: RECOVERY_STATUS.resolvedCaptured });
  });

  it('a webhook for an intent with no open item does nothing', async () => {
    prisma.captureRecovery.findFirst.mockResolvedValue(null);

    await service.resolveFromWebhook('pi_unknown', 'succeeded');

    expect(prisma.captureRecovery.update).not.toHaveBeenCalled();
  });

  // ── Admin operations ─────────────────────────────────────────────────────

  it('recheck runs the same resolution path', async () => {
    prisma.captureRecovery.findUnique.mockResolvedValue(row());
    stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', status: 'canceled' });

    const out = await service.recheck('rec-1');

    expect(out.status).toBe(RECOVERY_STATUS.resolvedNotCaptured);
  });

  it('recheck on a missing item is a 404, not a silent no-op', async () => {
    prisma.captureRecovery.findUnique.mockResolvedValue(null);

    await expect(service.recheck('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('close records who and why, and can only reach `closed`', async () => {
    prisma.captureRecovery.findUnique.mockResolvedValue(row());

    const out = await service.close('rec-1', 'admin-7', 'refunded manually outside the platform');

    expect(out.status).toBe(RECOVERY_STATUS.closed);
    expect(updateData()).toMatchObject({
      status: RECOVERY_STATUS.closed, resolution: 'closed_by_admin', resolvedByAdminId: 'admin-7',
    });
    expect(eventData().metadata).toMatchObject({ adminId: 'admin-7', source: 'admin' });
  });

  it('an audit-write failure does not swallow the state change', async () => {
    prisma.captureRecovery.findUnique.mockResolvedValue(row());
    prisma.tripEvent.create.mockRejectedValue(new Error('db down'));

    await expect(service.close('rec-1', 'admin-7', 'note')).resolves.toMatchObject({
      status: RECOVERY_STATUS.closed,
    });
    expect(prisma.captureRecovery.update).toHaveBeenCalled();
  });
});
