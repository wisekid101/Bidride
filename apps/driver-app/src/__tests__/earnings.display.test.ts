/**
 * Enforces BidRide business rule: driver take-home must always be shown first and largest.
 * Gross fare is secondary. Per CLAUDE.md: "Driver Take-Home: Always show driver take-home first
 * and largest. Gross fare is secondary."
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { IncomingRequestScreen } from '../screens/IncomingRequestScreen';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('../api/client', () => ({
  api: { post: jest.fn().mockResolvedValue({}) },
}));

const baseProps = {
  tripId: 'trip-abc',
  pickupAddress: '1 Airport Blvd, Newark, NJ',
  dropoffAddress: '350 5th Ave, New York, NY',
  distanceMiles: 16.4,
  estimatedMinutes: 22,
  aiFare: 38.50,
  driverTakeHome: 30.80,
  riderBadge: 'Verified' as const,
};

describe('IncomingRequestScreen — earnings display rule', () => {
  it('renders driver take-home before gross fare in document order', () => {
    const { getAllByText, queryByText } = render(
      React.createElement(IncomingRequestScreen, baseProps)
    );

    const takeHomeEl = queryByText('$30.80');
    const grossFareEl = queryByText('$38.50');

    expect(takeHomeEl).toBeTruthy();
    expect(grossFareEl).toBeTruthy();

    const allText = getAllByText(/.+/);
    const takeHomeIdx = allText.findIndex((el) => el.props.children === '$30.80');
    const grossFareIdx = allText.findIndex((el) => el.props.children === '$38.50');

    expect(takeHomeIdx).toBeLessThan(grossFareIdx);
  });

  it('accept button label includes take-home amount not gross fare', () => {
    const { getByText } = render(
      React.createElement(IncomingRequestScreen, baseProps)
    );
    expect(getByText('Accept · $30.80')).toBeTruthy();
  });

  it('never exposes numerical trust score to driver', () => {
    const { queryByText } = render(
      React.createElement(IncomingRequestScreen, baseProps)
    );
    expect(queryByText(/score/i)).toBeNull();
    expect(queryByText(/\b\d{1,3}\/100\b/)).toBeNull();
    expect(queryByText(/trust:\s*\d+/i)).toBeNull();
  });

  it('shows rider badge label only (Verified/Trusted/Business/VIP)', () => {
    const { getByText } = render(
      React.createElement(IncomingRequestScreen, baseProps)
    );
    expect(getByText('Verified')).toBeTruthy();
  });
});

describe('Earnings floor formula — deterministic calculation', () => {
  const calcFloor = (miles: number, minutes: number): number =>
    Math.round((miles * 1.10 + minutes * 0.22 + 2.50) * 100) / 100;

  it('calculates floor correctly for EWR to Midtown trip', () => {
    const floor = calcFloor(16.4, 22);
    expect(floor).toBe(25.29);
  });

  it('calculates floor correctly for short local trip', () => {
    const floor = calcFloor(2.1, 8);
    expect(floor).toBe(6.27);
  });

  it('floor is always >= $2.50 base (zero distance zero time)', () => {
    const floor = calcFloor(0, 0);
    expect(floor).toBe(2.50);
  });

  it('floor increases linearly with distance', () => {
    const floor5 = calcFloor(5, 10);
    const floor10 = calcFloor(10, 10);
    expect(floor10 - floor5).toBeCloseTo(5.50, 2);
  });
});
