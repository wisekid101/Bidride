import { api } from './client';

/**
 * Rider receipt contract — mirrors the payment-service response exactly.
 *
 * The BACKEND owns every financial value here (grossCharged, refundedTotal,
 * netPaid, paymentStatus, and the reconciliation decision). The app formats and
 * presents them; it must never compute a total, never fall back to
 * Trip.finalFare as the amount charged, and never invent a value when payment
 * evidence is missing.
 *
 * Fields the platform does not persist are intentionally ABSENT rather than
 * zero: tip, discount, credit, tax, tolls, airport fee, payment-method summary,
 * and driver information.
 */

export interface ReceiptRefund {
  amount: number;
  /** Coarse category only — the backend never returns notes or internal ids. */
  reason: string;
  createdAt: string;
}

export interface RiderReceipt {
  receiptId: string;
  tripId: string;
  tripStatus: string;
  completedAt: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  currency: string;
  fare: { finalFare: number; platformFee: number; waitFee: number };
  /** Amount actually charged (Payment.amount) — NOT the trip fare. */
  grossCharged: number;
  refundedTotal: number;
  netPaid: number;
  paymentStatus: string;
  refunds: ReceiptRefund[];
}

/** Why a receipt could not be shown. Never a fabricated amount. */
export type ReceiptUnavailableReason =
  | 'not_yet'
  | 'reconciling'
  | 'session_expired'
  | 'error';

export interface ReceiptUnavailable {
  reason: ReceiptUnavailableReason;
  message: string;
  canRetry: boolean;
}

export function fetchRiderReceipt(tripId: string): Promise<RiderReceipt> {
  return api.get<RiderReceipt>(`/payments/trips/${tripId}/receipt`);
}

/**
 * Map a failure to a truthful rider-facing state. A missing payment record and
 * a reconciliation conflict are distinct situations and must read differently —
 * neither may be presented as an amount.
 */
export function describeReceiptError(err: unknown): ReceiptUnavailable {
  const code = (err as { code?: string })?.code;
  const message = (err as { message?: string })?.message;

  if (code === 'RECEIPT_PAYMENT_NOT_FOUND') {
    return {
      reason: 'not_yet',
      message: 'Your receipt is not available yet.',
      canRetry: true,
    };
  }
  if (code === 'RECEIPT_RECONCILIATION_REQUIRED') {
    return {
      reason: 'reconciling',
      message:
        'This receipt is temporarily unavailable while a payment adjustment is reviewed.',
      canRetry: true,
    };
  }
  if (message === 'SESSION_EXPIRED') {
    return {
      reason: 'session_expired',
      message: 'Please sign in again to view this receipt.',
      canRetry: false,
    };
  }
  return {
    reason: 'error',
    message: "We couldn't load your receipt.",
    canRetry: true,
  };
}

/** Currency formatting driven by the receipt's own currency. */
export function formatReceiptMoney(amount: number, currency: string): string {
  const symbol = currency?.toLowerCase() === 'usd' ? '$' : '';
  const value = Math.abs(amount).toFixed(2);
  const sign = amount < 0 ? '-' : '';
  return symbol
    ? `${sign}${symbol}${value}`
    : `${sign}${value} ${String(currency ?? '').toUpperCase()}`.trim();
}

export type RefundState = 'none' | 'partial' | 'full';

/** Derived purely for LABELLING. Amounts always come from the backend. */
export function refundState(receipt: RiderReceipt): RefundState {
  if (!receipt.refundedTotal || receipt.refundedTotal <= 0) return 'none';
  if (receipt.netPaid <= 0) return 'full';
  return 'partial';
}

export function refundLabel(state: RefundState): string {
  if (state === 'full') return 'Fully refunded';
  if (state === 'partial') return 'Partially refunded';
  return '';
}

/**
 * The single amount to headline. After any refund the honest figure is what the
 * rider is currently out of pocket (netPaid), never the original charge.
 */
export function headlineAmount(receipt: RiderReceipt): {
  amount: number;
  label: string;
} {
  return refundState(receipt) === 'none'
    ? { amount: receipt.grossCharged, label: 'Total charged' }
    : { amount: receipt.netPaid, label: 'Net paid' };
}
