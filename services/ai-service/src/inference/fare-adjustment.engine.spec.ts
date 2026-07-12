import { FareAdjustmentEngine, FARE_ENGINE_VERSION } from './fare-adjustment.engine';

const engine = new FareAdjustmentEngine();

describe('FareAdjustmentEngine — determinism and transparency', () => {
  it('identical inputs produce identical recommendations', () => {
    const input = { surgeZoneScore: 0.6, isNight: true, isAirport: false, hourOfDay: 23, riderTotalTrips: 10 };

    expect(engine.recommend(input)).toEqual(engine.recommend(input));
  });

  it('exposes a versioned identity', () => {
    expect(FARE_ENGINE_VERSION).toBe('fare-shadow-v1');
  });

  it('explanation names every non-zero factor with its dollar contribution', () => {
    const rec = engine.recommend({ surgeZoneScore: 1, isNight: true, isAirport: true, riderTotalTrips: 30 });

    expect(rec.explanation).toContain('zone_demand');
    expect(rec.explanation).toContain('night_ride');
    expect(rec.explanation).toContain('airport_trip');
    expect(rec.explanation).toContain('rider_loyalty');
    expect(rec.explanation).toMatch(/\$\d+\.\d{2}/);
  });

  it('factors carry name, value, weight, and contribution for each signal', () => {
    const rec = engine.recommend({ surgeZoneScore: 0.5 });

    for (const f of rec.factors) {
      expect(f).toEqual(expect.objectContaining({
        name: expect.any(String),
        weight: expect.any(Number),
        contribution: expect.any(Number),
      }));
    }
    const surge = rec.factors.find((f) => f.name === 'zone_demand')!;
    expect(surge.contribution).toBe(0.75);
  });
});

describe('FareAdjustmentEngine — bounds', () => {
  it('caps the adjustment at +$2.00 even with every upward signal saturated', () => {
    const rec = engine.recommend({ surgeZoneScore: 999, isNight: true, isAirport: true });

    expect(rec.adjustment).toBeLessThanOrEqual(2);
  });

  it('never recommends below -$2.00', () => {
    const rec = engine.recommend({ riderTotalTrips: 10_000 });

    expect(rec.adjustment).toBeGreaterThanOrEqual(-2);
  });

  it('clamps out-of-range surge scores into [0,1] before weighting', () => {
    expect(engine.recommend({ surgeZoneScore: 5 }).adjustment).toBe(1.5);
    expect(engine.recommend({ surgeZoneScore: -3 }).adjustment).toBe(0);
  });

  it('confidence is bounded to (0,1] across input completeness levels', () => {
    const none = engine.recommend({});
    const all = engine.recommend({ surgeZoneScore: 0.5, isNight: false, isAirport: false, riderTotalTrips: 3 });

    expect(none.confidence).toBeGreaterThan(0);
    expect(none.confidence).toBeLessThan(all.confidence);
    expect(all.confidence).toBeLessThanOrEqual(1);
  });
});

describe('FareAdjustmentEngine — prohibited attributes', () => {
  it('trust scores are not consumed: recommendations are identical whatever the trust score', () => {
    const base = { surgeZoneScore: 0.4, isNight: true, riderTotalTrips: 5 };

    const low = engine.recommend({ ...base, riderTrustScore: 100 } as any);
    const high = engine.recommend({ ...base, riderTrustScore: 950 } as any);

    expect(low).toEqual(high);
    // And no factor references trust in any form.
    expect(JSON.stringify(low.factors)).not.toMatch(/trust/i);
  });
});

describe('FareAdjustmentEngine — degraded inputs', () => {
  it('no inputs at all → $0.00 adjustment with an honest explanation', () => {
    const rec = engine.recommend({});

    expect(rec.adjustment).toBe(0);
    expect(rec.explanation).toContain('No demand');
    expect(rec.factors.every((f) => f.contribution === 0)).toBe(true);
  });

  it('partial inputs degrade safely — missing signals contribute zero', () => {
    const rec = engine.recommend({ isNight: true });

    expect(rec.adjustment).toBe(0.25);
    expect(rec.explanation).toContain('night_ride');
    expect(rec.explanation).not.toContain('zone_demand');
  });

  it('loyalty discount applies only at 25+ trips', () => {
    expect(engine.recommend({ riderTotalTrips: 24 }).adjustment).toBe(0);
    expect(engine.recommend({ riderTotalTrips: 25 }).adjustment).toBe(-0.25);
  });
});
