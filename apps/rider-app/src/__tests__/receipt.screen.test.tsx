/**
 * Rendering tests for the receipt on TripCompleteScreen.
 *
 * The defect these guard: the screen previously showed Trip.finalFare as though
 * it were the amount charged, which is wrong after any refund or whenever the
 * charge and the fare differ. The screen must now present only backend-derived
 * amounts, and must never substitute an estimate when the receipt is missing.
 */
import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({
    tripId: 'trip-1',
    finalFare: '24.50', // the fare — must NOT be shown as the charged amount
    driverName: 'Sam',
    pickupAddress: '744 Broad St',
    dropoffAddress: 'EWR Terminal B',
  }),
}));

jest.mock('../api/client', () => ({ api: { get: jest.fn(), post: jest.fn().mockResolvedValue({}) } }));

const mockFetch = jest.fn();
jest.mock('../api/receipt', () => ({
  ...jest.requireActual('../api/receipt'),
  fetchRiderReceipt: (...args: unknown[]) => mockFetch(...args),
}));

import TripCompleteScreen from '../screens/TripCompleteScreen';

const receipt = (over: Record<string, unknown> = {}) => ({
  receiptId: 'RCPT-pay-1',
  tripId: 'trip-1',
  tripStatus: 'completed',
  completedAt: '2026-07-30T18:00:00.000Z',
  pickupAddress: '744 Broad St',
  dropoffAddress: 'EWR Terminal B',
  currency: 'usd',
  fare: { finalFare: 24.5, platformFee: 4.9, waitFee: 1.5 },
  grossCharged: 24.5,
  refundedTotal: 0,
  netPaid: 24.5,
  paymentStatus: 'succeeded',
  refunds: [],
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('TripCompleteScreen — receipt is the source of the charged amount', () => {
  it('requests the receipt for the completed trip', async () => {
    mockFetch.mockResolvedValue(receipt());
    render(<TripCompleteScreen />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('trip-1'));
  });

  it('shows the charged amount from the receipt, NOT Trip.finalFare, when they differ', async () => {
    mockFetch.mockResolvedValue(receipt({ grossCharged: 30, netPaid: 30 }));
    const { getByTestId, queryByText } = render(<TripCompleteScreen />);
    await waitFor(() => expect(getByTestId('receipt-ready')).toBeTruthy());
    expect(queryByText('$30.00')).toBeTruthy();
    expect(queryByText('Total charged')).toBeTruthy();
    expect(queryByText('$24.50')).toBeNull(); // the fare must not appear as the charge
  });

  it('headlines net paid and labels a partial refund', async () => {
    mockFetch.mockResolvedValue(receipt({
      refundedTotal: 10, netPaid: 14.5, paymentStatus: 'partially_refunded',
      refunds: [{ amount: 10, reason: 'service_issue', createdAt: '2026-07-30T19:00:00.000Z' }],
    }));
    const { getByTestId, queryByText } = render(<TripCompleteScreen />);
    await waitFor(() => expect(getByTestId('receipt-refund')).toBeTruthy());
    expect(queryByText('Net paid')).toBeTruthy();
    expect(queryByText('$14.50')).toBeTruthy();
    expect(queryByText(/Partially refunded/)).toBeTruthy();
  });

  it('labels a full refund and shows zero net paid', async () => {
    mockFetch.mockResolvedValue(receipt({ refundedTotal: 24.5, netPaid: 0, paymentStatus: 'refunded' }));
    const { getByTestId, queryByText } = render(<TripCompleteScreen />);
    await waitFor(() => expect(getByTestId('receipt-refund')).toBeTruthy());
    expect(queryByText(/Fully refunded/)).toBeTruthy();
    expect(queryByText('$0.00')).toBeTruthy();
  });

  it('shows the receipt identifier', async () => {
    mockFetch.mockResolvedValue(receipt());
    const { queryByText } = render(<TripCompleteScreen />);
    await waitFor(() => expect(queryByText(/RCPT-pay-1/)).toBeTruthy());
  });
});

describe('TripCompleteScreen — failure states never fabricate an amount', () => {
  it('RECEIPT_PAYMENT_NOT_FOUND shows an explicit not-yet state with retry and no amount', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('x'), { code: 'RECEIPT_PAYMENT_NOT_FOUND' }));
    const { getByTestId, queryByTestId, queryByText } = render(<TripCompleteScreen />);
    await waitFor(() => expect(getByTestId('receipt-unavailable')).toBeTruthy());
    expect(queryByText('Your receipt is not available yet.')).toBeTruthy();
    expect(queryByTestId('receipt-ready')).toBeNull();
    expect(queryByText('$24.50')).toBeNull(); // no fabricated amount
    expect(queryByText('$30.00')).toBeNull();
    expect(getByTestId('receipt-retry')).toBeTruthy();
  });

  it('RECEIPT_RECONCILIATION_REQUIRED shows a distinct state', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('x'), { code: 'RECEIPT_RECONCILIATION_REQUIRED' }));
    const { getByTestId, queryByText } = render(<TripCompleteScreen />);
    await waitFor(() => expect(getByTestId('receipt-unavailable')).toBeTruthy());
    expect(queryByText(/payment adjustment/)).toBeTruthy();
  });

  it('retry re-requests the receipt and recovers', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(receipt());
    const { getByTestId } = render(<TripCompleteScreen />);
    await waitFor(() => expect(getByTestId('receipt-retry')).toBeTruthy());
    fireEvent.press(getByTestId('receipt-retry'));
    await waitFor(() => expect(getByTestId('receipt-ready')).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('TripCompleteScreen — nothing unsupported or sensitive is rendered', () => {
  it('renders no tip, discount, credit, tax, toll, airport-fee or card details', async () => {
    mockFetch.mockResolvedValue(receipt({
      refundedTotal: 10, netPaid: 14.5, paymentStatus: 'partially_refunded',
      refunds: [{ amount: 10, reason: 'service_issue', createdAt: '2026-07-30T19:00:00.000Z' }],
    }));
    const { getByTestId, queryByText } = render(<TripCompleteScreen />);
    await waitFor(() => expect(getByTestId('receipt-ready')).toBeTruthy());
    for (const forbidden of [/Tip/i, /Discount/i, /Credit/i, /\bTax\b/i, /Toll/i, /Airport fee/i, /card ending/i, /pi_/, /driverEarnings/]) {
      expect(queryByText(forbidden)).toBeNull();
    }
  });
});
