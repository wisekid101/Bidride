/**
 * Driver overlay precedence.
 *
 * BidiRide Constitution: the standard ride booking path is primary and optional
 * bidding is a secondary competitive feature — "bidding must never replace,
 * delay, confuse, or weaken normal ride booking", and driver workflows must
 * treat standard ride requests as the default.
 *
 * Precedence is therefore, strictly: standard request > bid > nothing.
 *
 * This lives in its own module (rather than inline JSX guards) so the rule is
 * named, testable without mounting the map/socket/store stack, and cannot be
 * silently inverted again.
 */

export type DriverOverlay = 'standard' | 'bid' | 'none';

export function resolveDriverOverlay({
  isOnline,
  incomingRequest,
  incomingBid,
}: {
  isOnline: boolean;
  incomingRequest: unknown;
  incomingBid: unknown;
}): DriverOverlay {
  // Offline drivers are offered no work at all.
  if (!isOnline) return 'none';
  // A standard ride request always outranks a pending bid.
  if (incomingRequest) return 'standard';
  if (incomingBid) return 'bid';
  return 'none';
}
