import {
  PaymentBookingService,
  PaymentIntentMismatchError,
  captureCorrelationId,
} from './payment-booking.service';

// ─── F3b-2a: the one shared booking path ────────────────────────────────────
// Three properties this suite pins down, because getting any of them wrong
// means real money is wrong:
//
//   1. the correlation id is capture:${tripId} for EVERY source — vary it and
//      the ledger's uniqueness constraint stops deduplicating;
//   2. Payment and both ledger entries commit in one transaction;
//   3. a P2002 is an expected concurrency result, never a failure.

const makeLedger = () => ({ createEntriesTx: jest.fn().mockResolvedValue(undefined) });

const makePrisma = () => {
  const client = {
    payment: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    financialLedger: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  };
  client.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(client));
  return client;
};

const input = (over: Record<string, unknown> = {}) => ({
  tripId: 'trip-1',
  riderId: 'rider-1',
  paymentIntentId: 'pi_1',
  amountCents: 2364,
  source: 'capture' as const,
  ...over,
});

const existingPayment = (over: Record<string, unknown> = {}) => ({
  id: 'pay-1', tripId: 'trip-1', riderId: 'rider-1',
  stripePaymentIntentId: 'pi_1', amount: 23.64, status: 'succeeded', ...over,
});

const uniqueViolation = () => Object.assign(new Error('unique'), { code: 'P2002' });

describe('PaymentBookingService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let ledger: ReturnType<typeof makeLedger>;
  let service: PaymentBookingService;

  const entriesWritten = () => ledger.createEntriesTx.mock.calls[0][1];

  beforeEach(() => {
    prisma = makePrisma();
    ledger = makeLedger();
    service = new PaymentBookingService(prisma as never, ledger as never);
  });

  // ── created ───────────────────────────────────────────────────────────────

  it('no Payment and no ledger → created, with one payment and one balanced pair', async () => {
    const { outcome } = await service.bookCapturedPayment(null, input());

    expect(outcome).toBe('created');
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({
      tripId: 'trip-1', riderId: 'rider-1',
      stripePaymentIntentId: 'pi_1', amount: 23.64, status: 'succeeded',
    });
    expect(entriesWritten()).toHaveLength(2);
  });

  it('the payment and the ledger commit in ONE transaction', async () => {
    await service.bookCapturedPayment(null, input());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Both writes used the transaction client handed to the callback.
    expect(ledger.createEntriesTx.mock.calls[0][0]).toBe(prisma);
  });

  it.each([
    ['capture'], ['webhook'], ['recovery'],
  ])('uses correlation capture:${tripId} from source %s — never a per-source id', async (source) => {
    await service.bookCapturedPayment(null, input({ source, recoveryId: 'rec-1' }));

    for (const entry of entriesWritten()) {
      expect(entry.correlationId).toBe('capture:trip-1');
      expect(entry.correlationId).not.toContain('recovery:');
    }
  });

  it('records source and recoveryId in metadata, not in the correlation', async () => {
    await service.bookCapturedPayment(null, input({ source: 'recovery', recoveryId: 'rec-9' }));

    expect(entriesWritten()[0].metadata).toMatchObject({ source: 'recovery', recoveryId: 'rec-9' });
  });

  it('writes a rider debit and a platform credit for the same amount', async () => {
    await service.bookCapturedPayment(null, input());

    const [debit, credit] = entriesWritten();
    expect(debit).toMatchObject({ direction: 'debit', accountId: 'rider-1', accountType: 'rider', amount: 23.64 });
    expect(credit).toMatchObject({ direction: 'credit', accountId: 'platform', accountType: 'platform', amount: 23.64 });
  });

  // ── already_booked ────────────────────────────────────────────────────────

  it('Payment and both entries present → already_booked, nothing written', async () => {
    prisma.payment.findUnique.mockResolvedValue(existingPayment());
    prisma.financialLedger.findMany.mockResolvedValue([
      { accountId: 'rider-1', direction: 'debit' },
      { accountId: 'platform', direction: 'credit' },
    ]);

    const { outcome } = await service.bookCapturedPayment(null, input());

    expect(outcome).toBe('already_booked');
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(ledger.createEntriesTx).not.toHaveBeenCalled();
    expect(prisma.financialLedger.create).not.toHaveBeenCalled();
  });

  // ── healed_ledger ─────────────────────────────────────────────────────────

  it('Payment present with no entries → healed_ledger, pair written, payment untouched', async () => {
    prisma.payment.findUnique.mockResolvedValue(existingPayment());

    const { outcome } = await service.bookCapturedPayment(null, input());

    expect(outcome).toBe('healed_ledger');
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(entriesWritten()).toHaveLength(2);
  });

  it('a half-written pair is completed, not duplicated', async () => {
    prisma.payment.findUnique.mockResolvedValue(existingPayment());
    prisma.financialLedger.findMany.mockResolvedValue([{ accountId: 'rider-1', direction: 'debit' }]);

    const { outcome } = await service.bookCapturedPayment(null, input());

    expect(outcome).toBe('healed_ledger');
    // Only the missing credit, written directly — the pair balances against the
    // debit already in the database, so the balance assertion cannot apply.
    expect(ledger.createEntriesTx).not.toHaveBeenCalled();
    expect(prisma.financialLedger.create).toHaveBeenCalledTimes(1);
    expect(prisma.financialLedger.create.mock.calls[0][0].data).toMatchObject({ direction: 'credit' });
  });

  // ── fail closed ───────────────────────────────────────────────────────────

  it('a different PaymentIntent for the same trip fails closed and writes nothing', async () => {
    prisma.payment.findUnique.mockResolvedValue(existingPayment({ stripePaymentIntentId: 'pi_other' }));

    await expect(service.bookCapturedPayment(null, input()))
      .rejects.toBeInstanceOf(PaymentIntentMismatchError);

    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(ledger.createEntriesTx).not.toHaveBeenCalled();
    expect(prisma.financialLedger.create).not.toHaveBeenCalled();
  });

  // ── concurrency ───────────────────────────────────────────────────────────

  it('P2002 is an expected concurrency result: re-read and report the truth', async () => {
    prisma.payment.create.mockRejectedValueOnce(uniqueViolation());
    // On the retry the other writer's row is visible, complete.
    prisma.payment.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingPayment());
    prisma.financialLedger.findMany.mockResolvedValue([
      { accountId: 'rider-1', direction: 'debit' },
      { accountId: 'platform', direction: 'credit' },
    ]);

    const { outcome } = await service.bookCapturedPayment(null, input());

    expect(outcome).toBe('already_booked');
  });

  it('a non-P2002 error is NOT swallowed', async () => {
    prisma.payment.create.mockRejectedValue(new Error('connection lost'));

    await expect(service.bookCapturedPayment(null, input())).rejects.toThrow('connection lost');
  });

  it('a ledger failure propagates — financial writes are never fire-and-forget', async () => {
    ledger.createEntriesTx.mockRejectedValue(new Error('ledger down'));

    await expect(service.bookCapturedPayment(null, input())).rejects.toThrow('ledger down');
  });

  // ── composition ───────────────────────────────────────────────────────────

  it('joins a caller-supplied transaction instead of opening its own', async () => {
    const tx = {
      payment: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      financialLedger: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    };

    const { outcome } = await service.bookCapturedPayment(tx, input());

    expect(outcome).toBe('created');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.payment.create).toHaveBeenCalled();
  });

  it('exports the correlation helper both sides agree on', () => {
    expect(captureCorrelationId('trip-9')).toBe('capture:trip-9');
  });
});
