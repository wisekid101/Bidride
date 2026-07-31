// Self-contained unit tests for driver overlay precedence. NO react-native /
// expo imports — the module under test is pure policy logic, so this suite runs
// in a plain context.
//
// BidiRide Constitution: standard ride booking is the primary customer journey.
// "Bidding must never replace, delay, confuse, or weaken normal ride booking"
// and "driver workflows also treat standard ride requests as the default."
// This suite is the regression guard for that rule on the driver side.
import { resolveDriverOverlay } from '../driverOverlay';

const request = { tripId: 't1' };
const bid = { bidId: 'b1', tripId: 't1' };

describe('resolveDriverOverlay', () => {
  it('shows nothing while the driver is offline', () => {
    expect(resolveDriverOverlay({ isOnline: false, incomingRequest: null, incomingBid: null })).toBe('none');
    expect(resolveDriverOverlay({ isOnline: false, incomingRequest: request, incomingBid: bid })).toBe('none');
  });

  it('shows nothing when there is no work to offer', () => {
    expect(resolveDriverOverlay({ isOnline: true, incomingRequest: null, incomingBid: null })).toBe('none');
  });

  it('shows the standard request when only a standard request is pending', () => {
    expect(resolveDriverOverlay({ isOnline: true, incomingRequest: request, incomingBid: null })).toBe('standard');
  });

  // The defect this module exists to prevent: the standard overlay used to be
  // guarded by `incomingRequest && !incomingBid`, so a pending bid HID the
  // standard ride request from the driver — bidding outranking normal booking.
  it('a pending bid never suppresses a standard ride request', () => {
    expect(resolveDriverOverlay({ isOnline: true, incomingRequest: request, incomingBid: bid })).toBe('standard');
  });

  it('standard requests remain the default driver workflow whenever one exists', () => {
    // Whatever the bid state, a standard request always wins.
    for (const b of [null, undefined, bid]) {
      expect(resolveDriverOverlay({ isOnline: true, incomingRequest: request, incomingBid: b })).toBe('standard');
    }
  });

  it('still shows a bid when no standard request exists (bidding keeps working)', () => {
    expect(resolveDriverOverlay({ isOnline: true, incomingRequest: null, incomingBid: bid })).toBe('bid');
    expect(resolveDriverOverlay({ isOnline: true, incomingRequest: undefined, incomingBid: bid })).toBe('bid');
  });
});
