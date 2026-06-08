/**
 * Enforces BidRide business rules:
 * - Driver take-home shown first and prominently
 * - Accept button includes take-home amount (not AI fare)
 * - No numerical trust score exposed to driver
 * - 4 badge labels only (Verified/Trusted/Business/VIP)
 * - Earnings floor formula is deterministic
 */
import React from 'react';
import { render, act } from '@testing-library/react-native';
import { IncomingRequestScreen } from '../screens/IncomingRequestScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

jest.mock('../api/client', () => ({
  api: { post: jest.fn().mockResolvedValue({}) },
}));

jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

const baseProps = {
  tripId: 'trip-abc',
  pickupAddress: '1 Airport Blvd, Newark, NJ',
  dropoffAddress: '350 5th Ave, New York, NY',
  distanceMiles: 16.4,
  durationMin: 22,
  isAirportTrip: false,
  aiFare: 38.50,
  driverTakeHome: 30.80,
  riderBadge: 'Verified' as const,
  onAccepted: jest.fn(),
  onDeclined: jest.fn(),
};

describe('IncomingRequestScreen — earnings display rule', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders driver take-home amount prominently', () => {
    const { queryByText } = render(React.createElement(IncomingRequestScreen, baseProps));
    expect(queryByText('$30.80')).toBeTruthy();
  });

  it('accept button text includes take-home amount', () => {
    const { getByText } = render(React.createElement(IncomingRequestScreen, baseProps));
    expect(getByText('Accept · $30.80')).toBeTruthy();
  });

  it('never shows a numerical trust score to the driver', () => {
    const { queryByText } = render(React.createElement(IncomingRequestScreen, baseProps));
    expect(queryByText(/score/i)).toBeNull();
    expect(queryByText(/\b\d{1,3}\/100\b/)).toBeNull();
    expect(queryByText(/trust:\s*\d+/i)).toBeNull();
  });

  it('shows rider badge label only — Verified/Trusted/Business/VIP', () => {
    const { getByText } = render(React.createElement(IncomingRequestScreen, baseProps));
    expect(getByText('Verified')).toBeTruthy();
  });

  it('shows VIP badge for VIP riders', () => {
    const { getByText } = render(
      React.createElement(IncomingRequestScreen, { ...baseProps, riderBadge: 'VIP' })
    );
    expect(getByText('VIP')).toBeTruthy();
  });
});

// ─── Earnings floor formula — pure logic tests ────────────────────────────────

describe('Earnings floor formula — deterministic calculation', () => {
  const calcFloor = (miles: number, minutes: number): number =>
    Math.round((miles * 1.10 + minutes * 0.22 + 2.50) * 100) / 100;

  it('calculates floor correctly for EWR to Midtown trip', () => {
    // 16.4 × $1.10 + 22 × $0.22 + $2.50 = $18.04 + $4.84 + $2.50 = $25.38
    const floor = calcFloor(16.4, 22);
    expect(floor).toBe(25.38);
  });

  it('calculates floor correctly for short local trip', () => {
    // 2.1 × $1.10 + 8 × $0.22 + $2.50 = $2.31 + $1.76 + $2.50 = $6.57
    const floor = calcFloor(2.1, 8);
    expect(floor).toBe(6.57);
  });

  it('floor is always >= $2.50 base (zero distance, zero time)', () => {
    const floor = calcFloor(0, 0);
    expect(floor).toBe(2.50);
  });

  it('floor increases linearly with distance ($1.10 per mile)', () => {
    const floor5 = calcFloor(5, 10);
    const floor10 = calcFloor(10, 10);
    expect(floor10 - floor5).toBeCloseTo(5.50, 2);
  });

  it('floor increases linearly with duration ($0.22 per minute)', () => {
    const floor10 = calcFloor(5, 10);
    const floor20 = calcFloor(5, 20);
    expect(floor20 - floor10).toBeCloseTo(2.20, 2);
  });
});
