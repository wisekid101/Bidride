import { isAlreadyAdvancedError, TRIP_ALREADY_ADVANCED_CODE } from '../utils/tripErrors';

describe('trip transition error handling', () => {
  it('recognizes the real server error code that means the trip already advanced', () => {
    // Regression guard: the server emits TRIP_INVALID_STATE, NOT
    // TRIP_INVALID_TRANSITION. The recovery path (advance the UI) must fire on
    // the real code so a retried Arrived/Start after a reload recovers cleanly.
    expect(TRIP_ALREADY_ADVANCED_CODE).toBe('TRIP_INVALID_STATE');
    expect(isAlreadyAdvancedError({ code: 'TRIP_INVALID_STATE' })).toBe(true);
  });

  it('does NOT treat the old (never-emitted) code as recoverable', () => {
    expect(isAlreadyAdvancedError({ code: 'TRIP_INVALID_TRANSITION' })).toBe(false);
  });

  it('does not misclassify unrelated errors or missing codes', () => {
    expect(isAlreadyAdvancedError({ code: 'TRIP_TOO_FAR_FROM_DROPOFF' })).toBe(false);
    expect(isAlreadyAdvancedError({})).toBe(false);
    expect(isAlreadyAdvancedError(null)).toBe(false);
    expect(isAlreadyAdvancedError(undefined)).toBe(false);
  });
});
