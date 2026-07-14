import { shouldAnimateCamera, metersBetween, DEFAULT_FOLLOW_OPTIONS } from '../hooks/useFollowCamera';

const NEWARK = { lat: 40.7357, lng: -74.1724 };

describe('follow-camera decision (jitter + throttle)', () => {
  it('centers immediately on the first fix', () => {
    expect(shouldAnimateCamera(null, NEWARK, 0, 1000)).toBe(true);
  });

  it('never moves when there is no valid fix (no reset on GPS loss)', () => {
    expect(shouldAnimateCamera(NEWARK, null, 0, 10_000)).toBe(false);
  });

  it('ignores sub-threshold jitter even after the throttle window', () => {
    // ~3m north — below the 12m jitter floor.
    const jitter = { lat: NEWARK.lat + 0.00003, lng: NEWARK.lng };
    expect(metersBetween(NEWARK, jitter)).toBeLessThan(DEFAULT_FOLLOW_OPTIONS.minMoveMeters);
    expect(shouldAnimateCamera(NEWARK, jitter, 0, 5000)).toBe(false);
  });

  it('throttles rapid updates even when movement is significant', () => {
    const moved = { lat: NEWARK.lat + 0.01, lng: NEWARK.lng }; // ~1.1km
    // 200ms after the last animate — inside the 900ms throttle window.
    expect(shouldAnimateCamera(NEWARK, moved, 1000, 1200)).toBe(false);
  });

  it('animates on significant movement once the throttle window passes', () => {
    const moved = { lat: NEWARK.lat + 0.01, lng: NEWARK.lng };
    expect(shouldAnimateCamera(NEWARK, moved, 1000, 2500)).toBe(true);
  });
});
