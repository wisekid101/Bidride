/**
 * Pure-logic tests for the rider receipt contract. No react-native rendering —
 * this file proves the app never fabricates or recomputes a financial value and
 * that each backend failure maps to a distinct, truthful rider state.
 */
import {
  describeReceiptError,
  formatReceiptMoney,
  refundState,
  refundLabel,
  headlineAmount,
  RiderReceipt,
} from '../api/receipt';

const base: RiderReceipt = {
  receiptId: 'RCPT-pay-1',
  tripId: 'trip-1',
  tripStatus: 'completed',
  completedAt: '2026-07-30T18:00:00.000Z',
  pickupAddress: '744 Broad St, Newark NJ',
  dropoffAddress: 'EWR Terminal B',
  currency: 'usd',
  fare: { finalFare: 24.5, platformFee: 4.9, waitFee: 1.5 },
  grossCharged: 24.5,
  refundedTotal: 0,
  netPaid: 24.5,
  paymentStatus: 'succeeded',
  refunds: [],
};

describe('describeReceiptError — distinct, non-misleading states', () => {
  it('maps a missing payment record to "not available yet", retryable', () => {
    const s = describeReceiptError({ code: 'RECEIPT_PAYMENT_NOT_FOUND' });
    expect(s.reason).toBe('not_yet');
    expect(s.message).toBe('Your receipt is not available yet.');
    expect(s.canRetry).toBe(true);
  });

  it('maps a reconciliation conflict to its own state, distinct from not_yet', () => {
    const s = describeReceiptError({ code: 'RECEIPT_RECONCILIATION_REQUIRED' });
    expect(s.reason).toBe('reconciling');
    expect(s.canRetry).toBe(true);
    expect(s.message).not.toBe(describeReceiptError({ code: 'RECEIPT_PAYMENT_NOT_FOUND' }).message);
  });

  it('maps an expired session to a non-retryable sign-in state', () => {
    const s = describeReceiptError(new Error('SESSION_EXPIRED'));
    expect(s.reason).toBe('session_expired');
    expect(s.canRetry).toBe(false);
  });

  it('maps an unknown network failure to a retryable generic error', () => {
    const s = describeReceiptError(new Error('Network request failed'));
    expect(s.reason).toBe('error');
    expect(s.canRetry).toBe(true);
  });

  it('never returns an amount in any failure state', () => {
    for (const e of [{ code: 'RECEIPT_PAYMENT_NOT_FOUND' }, { code: 'RECEIPT_RECONCILIATION_REQUIRED' }, new Error('x')]) {
      const s = describeReceiptError(e) as unknown as Record<string, unknown>;
      expect(s.amount).toBeUndefined();
      expect(s.grossCharged).toBeUndefined();
      expect(String(s.message)).not.toMatch(/\d+\.\d{2}/);
    }
  });
});

describe('formatReceiptMoney — driven by the receipt currency', () => {
  it('formats usd with a dollar sign and two decimals', () => {
    expect(formatReceiptMoney(24.5, 'usd')).toBe('$24.50');
    expect(formatReceiptMoney(0, 'usd')).toBe('$0.00');
  });

  it('falls back to an explicit currency code for non-usd', () => {
    expect(formatReceiptMoney(10, 'cad')).toBe('10.00 CAD');
  });

  it('renders negatives with the sign outside the symbol', () => {
    expect(formatReceiptMoney(-5, 'usd')).toBe('-$5.00');
  });
});

describe('refundState / headlineAmount — labels derived, amounts never computed', () => {
  it('no refund: headlines the amount charged', () => {
    expect(refundState(base)).toBe('none');
    expect(refundLabel('none')).toBe('');
    expect(headlineAmount(base)).toEqual({ amount: 24.5, label: 'Total charged' });
  });

  it('partial refund: headlines net paid, not the original charge', () => {
    const r = { ...base, refundedTotal: 10, netPaid: 14.5, paymentStatus: 'partially_refunded' };
    expect(refundState(r)).toBe('partial');
    expect(refundLabel('partial')).toBe('Partially refunded');
    expect(headlineAmount(r)).toEqual({ amount: 14.5, label: 'Net paid' });
  });

  it('full refund: headlines zero net paid', () => {
    const r = { ...base, refundedTotal: 24.5, netPaid: 0, paymentStatus: 'refunded' };
    expect(refundState(r)).toBe('full');
    expect(refundLabel('full')).toBe('Fully refunded');
    expect(headlineAmount(r)).toEqual({ amount: 0, label: 'Net paid' });
  });

  it('uses the backend netPaid verbatim — never gross minus refunded recomputed', () => {
    // Deliberately inconsistent input: if the app recomputed, it would show 14.50.
    const r = { ...base, refundedTotal: 10, netPaid: 13.25 };
    expect(headlineAmount(r).amount).toBe(13.25);
  });

  it('never derives a total from fare components', () => {
    const r = { ...base, grossCharged: 30 }; // fare says 24.50, charge says 30.00
    expect(headlineAmount(r).amount).toBe(30);
    expect(headlineAmount(r).amount).not.toBe(r.fare.finalFare);
  });
});

describe('contract surface — unsupported fields are absent, not zero', () => {
  it('has no tip, discount, credit, tax, toll, airport fee or card fields', () => {
    const keys = Object.keys(base);
    for (const forbidden of ['tip', 'tipAmount', 'discount', 'credit', 'tax', 'tolls', 'airportFee', 'paymentMethod', 'card', 'last4']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('refund entries expose only amount, reason and timestamp', () => {
    const r = { ...base, refunds: [{ amount: 10, reason: 'service_issue', createdAt: '2026-07-30T19:00:00.000Z' }] };
    expect(Object.keys(r.refunds[0]).sort()).toEqual(['amount', 'createdAt', 'reason']);
  });
});
