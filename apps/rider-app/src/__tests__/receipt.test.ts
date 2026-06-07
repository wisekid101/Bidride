/**
 * Enforces that the rider receipt screen never exposes driver take-home percentage,
 * driver earnings, or trust score numbers. Rider sees total fare only.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { TripCompleteScreen } from '../screens/TripCompleteScreen';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useLocalSearchParams: () => ({
    tripId: 'trip-test-123',
    pickupAddress: '1 Airport Blvd, Newark, NJ',
    dropoffAddress: '350 5th Ave, New York, NY',
    fareAmount: '38.50',
    distanceMiles: '16.4',
    durationMinutes: '22',
    driverName: 'Marcus',
    driverRating: '4.9',
  }),
}));

jest.mock('../api/client', () => ({
  api: { post: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../store/trip.store', () => ({
  useTripStore: () => ({ completedTrip: null, setActiveTrip: jest.fn() }),
}));

describe('TripCompleteScreen (rider receipt) — no driver earnings exposure', () => {
  it('does not show driver take-home percentage on rider receipt', () => {
    const { queryByText } = render(React.createElement(TripCompleteScreen));
    expect(queryByText(/take.?home/i)).toBeNull();
    expect(queryByText(/driver.*earn/i)).toBeNull();
    expect(queryByText(/platform.*fee/i)).toBeNull();
  });

  it('does not expose driver trust score numerically', () => {
    const { queryByText } = render(React.createElement(TripCompleteScreen));
    expect(queryByText(/trust.*score/i)).toBeNull();
    expect(queryByText(/\b\d{2,3}\/100\b/)).toBeNull();
  });

  it('shows total fare amount', () => {
    const { queryByText } = render(React.createElement(TripCompleteScreen));
    expect(queryByText('$38.50')).toBeTruthy();
  });
});
