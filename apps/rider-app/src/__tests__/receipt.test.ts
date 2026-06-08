/**
 * Enforces that the rider receipt screen never exposes driver take-home percentage,
 * driver earnings, or trust score numbers. Rider sees total fare only.
 *
 * TripCompleteScreen uses expo-router hooks (useLocalSearchParams) to get trip data,
 * so we render it with the hooks mocked to supply known values.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import TripCompleteScreen from '../screens/TripCompleteScreen';

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

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ reset: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('../api/client', () => ({
  api: { post: jest.fn().mockResolvedValue({}) },
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

  it('shows total fare amount in financial display', () => {
    const { queryByText } = renderScreen();
    expect(queryByText('$38.50')).toBeTruthy();
  });
});
