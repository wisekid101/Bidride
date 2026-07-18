import { ServiceUnavailableException } from '@nestjs/common';
import { PayoutSubmissionService } from './payout-submission.service';

const makeSvc = (flag = 'false') => {
  const prisma = { $transaction: jest.fn(), payoutRequest: { findUnique: jest.fn() }, payoutSubmissionAttempt: { create: jest.fn() } } as any;
  const ledger = {} as any;
  const stripe = { transfers: { create: jest.fn(), list: jest.fn() } } as any;
  const config = { get: jest.fn().mockReturnValue(flag) } as any;
  return { svc: new PayoutSubmissionService(prisma, ledger, stripe, config), prisma, stripe, config };
};

describe('PayoutSubmissionService — feature flag (Bidiride payouts)', () => {
  it('submit throws and makes NO claim/Stripe call when PAYOUTS_ENABLED !== "true"', async () => {
    const { svc, prisma, stripe } = makeSvc('false');
    await expect(svc.submitPayoutRequest('r1')).rejects.toThrow(ServiceUnavailableException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
  it('reconcile throws and lists nothing when disabled', async () => {
    const { svc, stripe } = makeSvc('false');
    await expect(svc.reconcilePayoutRequest('r1')).rejects.toThrow(ServiceUnavailableException);
    expect(stripe.transfers.list).not.toHaveBeenCalled();
  });
});

describe('PayoutSubmissionService — error classification (proves-no-transfer rule)', () => {
  const { svc } = makeSvc('true');
  const cls = (e: unknown) => (svc as any).classifyError(e).cls;
  it('connection error -> AMBIGUOUS_OUTCOME', () => expect(cls({ type: 'StripeConnectionError' })).toBe('AMBIGUOUS_OUTCOME'));
  it('timeout message -> AMBIGUOUS_OUTCOME', () => expect(cls({ message: 'network timeout' })).toBe('AMBIGUOUS_OUTCOME'));
  it('authentication -> CONFIGURATION_FAILURE', () => expect(cls({ type: 'StripeAuthenticationError' })).toBe('CONFIGURATION_FAILURE'));
  it('rate limit -> RETRYABLE_FAILURE', () => expect(cls({ type: 'StripeRateLimitError' })).toBe('RETRYABLE_FAILURE'));
  it('5xx -> RETRYABLE_FAILURE', () => expect(cls({ statusCode: 503 })).toBe('RETRYABLE_FAILURE'));
  it('invalid request -> DEFINITIVE_FAILURE', () => expect(cls({ type: 'StripeInvalidRequestError', code: 'account_invalid' })).toBe('DEFINITIVE_FAILURE'));
  it('idempotency conflict -> AMBIGUOUS_OUTCOME', () => expect(cls({ type: 'StripeIdempotencyError' })).toBe('AMBIGUOUS_OUTCOME'));
  it('unknown error -> AMBIGUOUS_OUTCOME (never assume no transfer)', () => expect(cls({})).toBe('AMBIGUOUS_OUTCOME'));
  it('error message is length-capped (redaction)', () => expect((svc as any).classifyError({ message: 'x'.repeat(1000) }).message.length).toBeLessThanOrEqual(480));
});

describe('PayoutSubmissionService — deterministic identities', () => {
  const { svc } = makeSvc('true');
  it('transfer key, group, ledger correlation are deterministic', () => {
    expect((svc as any).transferKey('R')).toBe('payout:R:transfer');
    expect((svc as any).transferGroup('R')).toBe('bidiride:payout:R');
    expect((svc as any).ledgerCorrelation('R')).toBe('payout:R:ledger');
  });
});

describe('PayoutSubmissionService — internal-only surface', () => {
  it('exposes submit + reconcile; no controller/execution helper leaks', () => {
    const methods = Object.getOwnPropertyNames(PayoutSubmissionService.prototype).filter((m) => m !== 'constructor');
    expect(methods).toEqual(expect.arrayContaining(['submitPayoutRequest', 'reconcilePayoutRequest']));
    expect(methods.some((m) => /controller|endpoint|cron|schedule/i.test(m))).toBe(false);
  });
});
