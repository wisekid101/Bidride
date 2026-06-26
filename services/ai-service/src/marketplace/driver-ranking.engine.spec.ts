import { DriverRankingEngine, DriverRankingCandidate } from './driver-ranking.engine';

const BASE: DriverRankingCandidate = {
  driverUserId: 'driver-1',
  distanceMiles: 1.0,
  etaMinutes: 5,
  trustScore: 750,
  acceptanceRate: 0.85,
  cancellationRate: 0.05,
  avgResponseTimeMs: 15000,
  avgRating: 4.8,
  hasAirportExperience: false,
  hoursOnline: 2,
};

describe('DriverRankingEngine', () => {
  let engine: DriverRankingEngine;

  beforeEach(() => {
    engine = new DriverRankingEngine();
  });

  describe('scoreCandidate', () => {
    it('scores a perfect candidate close to 100', () => {
      const perfect: DriverRankingCandidate = {
        driverUserId: 'p',
        distanceMiles: 0,
        etaMinutes: 0,
        trustScore: 1000,
        acceptanceRate: 1.0,
        cancellationRate: 0,
        avgResponseTimeMs: 0,
        avgRating: 5.0,
        hasAirportExperience: true,
        isPreferredByRider: true,
        currentSessionEarningsUsd: 50,
        expectedSessionEarningsUsd: 50,
        hoursOnline: 1,
      };
      const { score } = engine.scoreCandidate(perfect, true);
      expect(score).toBeGreaterThanOrEqual(98);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('scores a terrible candidate close to 0', () => {
      const bad: DriverRankingCandidate = {
        driverUserId: 'b',
        distanceMiles: 15,
        etaMinutes: 60,
        trustScore: 0,
        acceptanceRate: 0,
        cancellationRate: 1.0,
        avgResponseTimeMs: 120000,
        avgRating: 1.0,
        hasAirportExperience: false,
        isPreferredByRider: false,
        hoursOnline: 10,
      };
      const { score } = engine.scoreCandidate(bad, false);
      expect(score).toBeLessThan(10);
    });

    it('clamps eta signal at 0 when etaMinutes >= 30', () => {
      const { signals } = engine.scoreCandidate({ ...BASE, etaMinutes: 30 }, false);
      expect(signals.eta).toBe(0);

      const { signals: s2 } = engine.scoreCandidate({ ...BASE, etaMinutes: 60 }, false);
      expect(s2.eta).toBe(0);
    });

    it('awards full eta signal at etaMinutes = 0', () => {
      const { signals } = engine.scoreCandidate({ ...BASE, etaMinutes: 0 }, false);
      expect(signals.eta).toBe(25);
    });

    it('awards full distance signal at 0 miles', () => {
      const { signals } = engine.scoreCandidate({ ...BASE, distanceMiles: 0 }, false);
      expect(signals.distance).toBe(15);
    });

    it('clamps distance signal at 0 when >= 10 miles', () => {
      const { signals } = engine.scoreCandidate({ ...BASE, distanceMiles: 10 }, false);
      expect(signals.distance).toBe(0);
    });

    it('awards trust proportionally (750/1000 = 9)', () => {
      const { signals } = engine.scoreCandidate({ ...BASE, trustScore: 750 }, false);
      expect(signals.trust).toBeCloseTo(9, 0);
    });

    it('does NOT award airport bonus for non-airport trip', () => {
      const { signals } = engine.scoreCandidate({ ...BASE, hasAirportExperience: true }, false);
      expect(signals.airportExperience).toBe(0);
    });

    it('awards airport bonus only for airport trip with experience', () => {
      const { signals } = engine.scoreCandidate({ ...BASE, hasAirportExperience: true }, true);
      expect(signals.airportExperience).toBe(5);
    });

    it('awards preferred-by-rider bonus correctly', () => {
      const { signals: yes } = engine.scoreCandidate({ ...BASE, isPreferredByRider: true }, false);
      const { signals: no } = engine.scoreCandidate({ ...BASE, isPreferredByRider: false }, false);
      expect(yes.preferredByRider).toBe(5);
      expect(no.preferredByRider).toBe(0);
    });

    it('awards fresh driver bonus for hoursOnline < 4', () => {
      const { signals: fresh } = engine.scoreCandidate({ ...BASE, hoursOnline: 3.9 }, false);
      const { signals: tired } = engine.scoreCandidate({ ...BASE, hoursOnline: 4 }, false);
      expect(fresh.freshDriver).toBe(2);
      expect(tired.freshDriver).toBe(0);
    });

    it('computes earnings fairness at neutral when no data', () => {
      const { signals } = engine.scoreCandidate({ ...BASE }, false);
      expect(signals.earningsFairness).toBeCloseTo(1.5, 1);
    });

    it('awards full earnings fairness when at 100% of expected', () => {
      const { signals } = engine.scoreCandidate(
        { ...BASE, currentSessionEarningsUsd: 50, expectedSessionEarningsUsd: 50 },
        false,
      );
      expect(signals.earningsFairness).toBe(3);
    });

    it('reduces earnings fairness when 2× over expected', () => {
      const { signals } = engine.scoreCandidate(
        { ...BASE, currentSessionEarningsUsd: 100, expectedSessionEarningsUsd: 50 },
        false,
      );
      expect(signals.earningsFairness).toBe(0);
    });

    it('score is always in [0, 100]', () => {
      for (let i = 0; i < 20; i++) {
        const c: DriverRankingCandidate = {
          driverUserId: `d${i}`,
          distanceMiles: Math.random() * 20,
          etaMinutes: Math.random() * 60,
          trustScore: Math.random() * 1000,
          acceptanceRate: Math.random(),
          cancellationRate: Math.random(),
          avgResponseTimeMs: Math.random() * 120000,
          avgRating: 1 + Math.random() * 4,
          hoursOnline: Math.random() * 12,
        };
        const { score } = engine.scoreCandidate(c, false);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('rank', () => {
    it('returns candidates sorted by score descending', () => {
      const candidates: DriverRankingCandidate[] = [
        { ...BASE, driverUserId: 'far', distanceMiles: 8, etaMinutes: 20 },
        { ...BASE, driverUserId: 'close', distanceMiles: 0.5, etaMinutes: 2 },
        { ...BASE, driverUserId: 'mid', distanceMiles: 3, etaMinutes: 8 },
      ];
      const ranked = engine.rank(candidates, false);
      expect(ranked[0].driverUserId).toBe('close');
      expect(ranked[1].driverUserId).toBe('mid');
      expect(ranked[2].driverUserId).toBe('far');
    });

    it('assigns rank numbers starting at 1', () => {
      const ranked = engine.rank([BASE, { ...BASE, driverUserId: 'x' }], false);
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].rank).toBe(2);
    });

    it('returns empty array for empty input', () => {
      expect(engine.rank([], false)).toEqual([]);
    });

    it('includes signals in each result', () => {
      const ranked = engine.rank([BASE], false);
      expect(ranked[0].signals).toBeDefined();
      expect(Object.keys(ranked[0].signals).length).toBeGreaterThan(5);
    });
  });
});
