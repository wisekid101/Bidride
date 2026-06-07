import { assertValidTransition, isTerminal, isNightRide } from './trip-state-machine';
import { TripStatus } from '@bidride/database/generated/client';

describe('TripStateMachine', () => {
  describe('assertValidTransition', () => {
    it('allows searching → accepted', () => {
      expect(() => assertValidTransition(TripStatus.searching, TripStatus.accepted)).not.toThrow();
    });

    it('allows accepted → driver_en_route', () => {
      expect(() => assertValidTransition(TripStatus.accepted, TripStatus.driver_en_route)).not.toThrow();
    });

    it('allows driver_arrived → in_progress', () => {
      expect(() => assertValidTransition(TripStatus.driver_arrived, TripStatus.in_progress)).not.toThrow();
    });

    it('allows in_progress → completed', () => {
      expect(() => assertValidTransition(TripStatus.in_progress, TripStatus.completed)).not.toThrow();
    });

    it('allows searching → cancelled', () => {
      expect(() => assertValidTransition(TripStatus.searching, TripStatus.cancelled)).not.toThrow();
    });

    it('blocks completed → in_progress (no back-transition)', () => {
      expect(() => assertValidTransition(TripStatus.completed, TripStatus.in_progress)).toThrow();
    });

    it('blocks searching → completed (skip states)', () => {
      expect(() => assertValidTransition(TripStatus.searching, TripStatus.completed)).toThrow();
    });

    it('blocks completed → cancelled (terminal state)', () => {
      expect(() => assertValidTransition(TripStatus.completed, TripStatus.cancelled)).toThrow();
    });

    it('returns TRIP_INVALID_STATE error code', () => {
      try {
        assertValidTransition(TripStatus.completed, TripStatus.in_progress);
      } catch (err: any) {
        expect(err.response.code).toBe('TRIP_INVALID_STATE');
      }
    });
  });

  describe('isTerminal', () => {
    it('returns true for completed', () => {
      expect(isTerminal(TripStatus.completed)).toBe(true);
    });

    it('returns true for cancelled', () => {
      expect(isTerminal(TripStatus.cancelled)).toBe(true);
    });

    it('returns true for no_show', () => {
      expect(isTerminal(TripStatus.no_show)).toBe(true);
    });

    it('returns false for in_progress', () => {
      expect(isTerminal(TripStatus.in_progress)).toBe(false);
    });

    it('returns false for searching', () => {
      expect(isTerminal(TripStatus.searching)).toBe(false);
    });
  });

  describe('isNightRide', () => {
    it('returns true for 11pm', () => {
      const date = new Date();
      date.setHours(23, 0, 0, 0);
      expect(isNightRide(date)).toBe(true);
    });

    it('returns true for 2am', () => {
      const date = new Date();
      date.setHours(2, 0, 0, 0);
      expect(isNightRide(date)).toBe(true);
    });

    it('returns true for exactly 10pm', () => {
      const date = new Date();
      date.setHours(22, 0, 0, 0);
      expect(isNightRide(date)).toBe(true);
    });

    it('returns false for 6am', () => {
      const date = new Date();
      date.setHours(6, 0, 0, 0);
      expect(isNightRide(date)).toBe(false);
    });

    it('returns false for noon', () => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      expect(isNightRide(date)).toBe(false);
    });

    it('returns false for 9:59pm', () => {
      const date = new Date();
      date.setHours(21, 59, 0, 0);
      expect(isNightRide(date)).toBe(false);
    });
  });
});
