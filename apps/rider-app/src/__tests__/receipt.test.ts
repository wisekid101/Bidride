/**
 * Enforces that the rider receipt screen never exposes driver take-home percentage,
 * driver earnings, or trust score numbers. Rider sees total fare only.
 *
 * TripCompleteScreen uses expo-router hooks (useLocalSearchParams) to get trip data,
 * so we render it with the hooks mocked to supply known values.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import TripCompleteScreen from '../screens/TripCompleteScreen';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useLocalSearchParams: () => ({
    tripId: 'trip-test-123',
    pickupAddress: '1 Airport Blvd, Newark, NJ',
    dropoffAddress: '350 5th Ave, New York, NY',
    finalFare: '38.50',
    distanceMiles: '16.4',
    durationMinutes: '22',
    driverName: 'Marcus',
    driverRating: '4.9',
  }),
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ reset: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('../api/client', () => ({
  // `get` is required because the screen now loads the authoritative receipt
  // from payment-service. grossCharged (41.00) deliberately DIFFERS from the
  // route's finalFare (38.50) so the financial display can be proven to come
  // from the receipt rather than from trip data.
  api: {
    post: jest.fn().mockResolvedValue({}),
    get: jest.fn().mockResolvedValue({
      receiptId: 'RCPT-test', tripId: 'trip-test-123', tripStatus: 'completed',
      completedAt: '2026-07-30T18:00:00.000Z',
      pickupAddress: '1 Airport Blvd, Newark, NJ', dropoffAddress: '350 5th Ave, New York, NY',
      currency: 'usd', fare: { finalFare: 38.5, platformFee: 7.7, waitFee: 0 },
      grossCharged: 41.0, refundedTotal: 0, netPaid: 41.0,
      paymentStatus: 'succeeded', refunds: [],
    }),
  },
}));

jest.mock('../store/trip.store', () => ({
  useTripStore: () => ({
    activeTrip: null,
    completedTrip: null,
    clearCompletedTrip: jest.fn(),
    setActiveTrip: jest.fn(),
  }),
}));

jest.mock('../store/auth.store', () => ({
  useAuthStore: () => ({ accessToken: 'mock-token' }),
}));

const renderScreen = () =>
  render(React.createElement(TripCompleteScreen, {
    navigation: { reset: jest.fn(), navigate: jest.fn(), replace: jest.fn() } as any,
    route: {
      params: {
        tripId: 'trip-test-123',
        finalFare: '38.50',
        driverName: 'Marcus',
        pickupAddress: '1 Airport Blvd, Newark, NJ',
        dropoffAddress: '350 5th Ave, New York, NY',
      }
    } as any,
  }));

describe('TripCompleteScreen (rider receipt) — no driver earnings exposure', () => {
  it('does not show driver take-home percentage on rider receipt', () => {
    const { queryByText } = renderScreen();
    expect(queryByText(/take.?home/i)).toBeNull();
    expect(queryByText(/driver.*earn/i)).toBeNull();
    expect(queryByText(/platform.*fee/i)).toBeNull();
  });

  it('does not expose driver trust score numerically', () => {
    const { queryByText } = renderScreen();
    expect(queryByText(/trust.*score/i)).toBeNull();
    expect(queryByText(/\b\d{2,3}\/100\b/)).toBeNull();
  });

  // CORRECTED: this previously asserted the route's finalFare ($38.50) appeared
  // as the financial display — the exact defect Receipts-B removes. The amount
  // shown must now be the receipt's grossCharged, which is authoritative.
  it('shows the receipt-derived charged amount, not the trip fare', async () => {
    const { queryByText } = renderScreen();
    await waitFor(() => expect(queryByText('$41.00')).toBeTruthy());
    expect(queryByText('$38.50')).toBeNull();
  });
});
