import { BidWinProbabilityEngine, BID_ENGINE_VERSION } from './bid-win-probability.engine';

const engine = new BidWinProbabilityEngine();

const base = { bidAmount: 18, aiFare: 18 }; // bidRatio = 1.0 → no adjustment

describe('BidWinProbabilityEngine — envelope', () => {
  it('returns probability, confidence, explanation with correct shapes', () => {
    const result = engine.predict(base);
    expect(result.probability).toBeGreaterThanOrEqual(0.05);
    expect(result.probability).toBeLessThanOrEqual(0.95);
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
    expect(result.confidence).toBeLessThanOrEqual(0.88);
    expect(Array.isArray(result.explanation)).toBe(true);
  });

  it('exports correct model version', () => {
    expect(BID_ENGINE_VERSION).toBe('rule-v1');
  });
});

describe('BidWinProbabilityEngine — bid ratio', () => {
  it('adds +0.15 delta for bid above market (>= 1.05x)', () => {
    const above = engine.predict({ bidAmount: 19, aiFare: 18 }); // 1.055x
    const at = engine.predict(base);
    expect(above.probability).toBeGreaterThan(at.probability);
    expect(above.explanation).toContain('Bid above market rate');
  });

  it('subtracts for bid significantly below market (< 0.83x)', () => {
    const low = engine.predict({ bidAmount: 14, aiFare: 18 }); // 0.78x
    const at = engine.predict(base);
    expect(low.probability).toBeLessThan(at.probability);
    expect(low.explanation).toContain('Bid significantly below market');
  });

  it('subtracts for bid below market (0.83–0.90x)', () => {
    const below = engine.predict({ bidAmount: 15.5, aiFare: 18 }); // 0.86x
    expect(below.explanation).toContain('Bid below market');
  });
});

describe('BidWinProbabilityEngine — rider trust', () => {
  it('adds delta for high rider trust score (>= 800)', () => {
    const high = engine.predict({ ...base, riderTrustScore: 850 });
    const low = engine.predict({ ...base, riderTrustScore: 300 });
    expect(high.probability).toBeGreaterThan(low.probability);
    expect(high.explanation).toContain('High rider trust');
    expect(low.explanation).toContain('Low rider trust score');
  });

  it('adds delta for good rider trust score (650–799)', () => {
    const result = engine.predict({ ...base, riderTrustScore: 700 });
    expect(result.explanation).toContain('Good rider trust');
  });
});

describe('BidWinProbabilityEngine — driver availability', () => {
  it('adds large boost for 8+ drivers in zone', () => {
    const full = engine.predict({ ...base, availableDriversInZone: 10 });
    const none = engine.predict({ ...base, availableDriversInZone: 0 });
    expect(full.probability).toBeGreaterThan(none.probability);
    expect(full.explanation).toContain('Strong driver availability');
    expect(none.explanation).toContain('No drivers available in zone');
  });

  it('flags limited availability for 1–2 drivers', () => {
    const result = engine.predict({ ...base, availableDriversInZone: 1 });
    expect(result.explanation).toContain('Limited driver availability');
  });
});

describe('BidWinProbabilityEngine — airport flag', () => {
  it('adds delta for airport trips', () => {
    const airport = engine.predict({ ...base, isAirport: true });
    const nonAirport = engine.predict({ ...base, isAirport: false });
    expect(airport.probability).toBeGreaterThan(nonAirport.probability);
    expect(airport.explanation).toContain('Airport trip — high driver motivation');
  });
});

describe('BidWinProbabilityEngine — weather', () => {
  it('boosts probability for adverse weather >= 1.4', () => {
    const storm = engine.predict({ ...base, weatherFactor: 1.5 });
    const clear = engine.predict({ ...base, weatherFactor: 1.0 });
    expect(storm.probability).toBeGreaterThan(clear.probability);
    expect(storm.explanation).toContain('Adverse weather — drivers in high demand');
  });
});

describe('BidWinProbabilityEngine — time of day', () => {
  it('boosts for evening peak hours (17–20)', () => {
    const peak = engine.predict({ ...base, timeOfDay: 18 });
    const offPeak = engine.predict({ ...base, timeOfDay: 14 });
    expect(peak.probability).toBeGreaterThan(offPeak.probability);
    expect(peak.explanation).toContain('Evening peak hours');
  });

  it('boosts for morning peak hours (7–9)', () => {
    const result = engine.predict({ ...base, timeOfDay: 8 });
    expect(result.explanation).toContain('Morning peak hours');
  });
});

describe('BidWinProbabilityEngine — driver history', () => {
  it('boosts for strong acceptance history (>= 0.85)', () => {
    const good = engine.predict({ ...base, driverAcceptanceHistory: 0.90 });
    const poor = engine.predict({ ...base, driverAcceptanceHistory: 0.40 });
    expect(good.probability).toBeGreaterThan(poor.probability);
    expect(good.explanation).toContain('Strong driver acceptance history');
    expect(poor.explanation).toContain('Driver has low acceptance rate');
  });

  it('subtracts for high cancellation rate', () => {
    const bad = engine.predict({ ...base, driverCancellationRate: 0.20 });
    const clean = engine.predict({ ...base, driverCancellationRate: 0.02 });
    expect(bad.probability).toBeLessThan(clean.probability);
    expect(bad.explanation).toContain('High driver cancellation risk');
  });
});

describe('BidWinProbabilityEngine — zone demand', () => {
  it('boosts for peak zone demand (> 0.8)', () => {
    const high = engine.predict({ ...base, currentZoneDemand: 0.9 });
    const low = engine.predict({ ...base, currentZoneDemand: 0.1 });
    expect(high.probability).toBeGreaterThan(low.probability);
    expect(high.explanation).toContain('Peak demand — drivers actively seeking');
  });
});

describe('BidWinProbabilityEngine — clamping', () => {
  it('clamps probability above 0.05 even with all-negative signals', () => {
    const worst = engine.predict({
      bidAmount: 5, aiFare: 18,      // 0.28x — large negative
      riderTrustScore: 200,
      driverTrustScore: 200,
      availableDriversInZone: 0,
      currentZoneDemand: 0.05,
      driverCancellationRate: 0.30,
      driverAcceptanceHistory: 0.30,
      historicalAcceptanceRate: 0.20,
      timeOfDay: 3,
    });
    expect(worst.probability).toBeGreaterThanOrEqual(0.05);
  });

  it('clamps probability below 0.95 even with all-positive signals', () => {
    const best = engine.predict({
      bidAmount: 25, aiFare: 18,     // 1.39x — large positive
      riderTrustScore: 950,
      driverTrustScore: 950,
      availableDriversInZone: 15,
      currentZoneDemand: 0.95,
      isAirport: true,
      weatherFactor: 1.5,
      timeOfDay: 18,
      driverAcceptanceHistory: 0.95,
      driverCancellationRate: 0.01,
      driverResponseTimeMs: 3000,
      historicalAcceptanceRate: 0.90,
      etaMinutes: 3,
    });
    expect(best.probability).toBeLessThanOrEqual(0.95);
  });
});

describe('BidWinProbabilityEngine — confidence', () => {
  it('has higher confidence when more signals provided', () => {
    const sparse = engine.predict(base);
    const rich = engine.predict({
      ...base,
      riderTrustScore: 700,
      driverTrustScore: 700,
      availableDriversInZone: 5,
      currentZoneDemand: 0.5,
      isAirport: false,
      weatherFactor: 1.1,
      timeOfDay: 14,
      driverAcceptanceHistory: 0.75,
      driverCancellationRate: 0.05,
      driverResponseTimeMs: 5000,
      historicalAcceptanceRate: 0.65,
      etaMinutes: 8,
      distanceMiles: 3,
    });
    expect(rich.confidence).toBeGreaterThan(sparse.confidence);
  });

  it('caps confidence at 0.88 (rule-based system)', () => {
    const result = engine.predict({
      ...base,
      riderTrustScore: 900,
      driverTrustScore: 900,
      availableDriversInZone: 10,
      currentZoneDemand: 0.9,
      isAirport: true,
      weatherFactor: 1.5,
      timeOfDay: 18,
      driverAcceptanceHistory: 0.95,
      driverCancellationRate: 0.01,
      driverResponseTimeMs: 2000,
      historicalAcceptanceRate: 0.90,
      etaMinutes: 4,
      distanceMiles: 5,
    });
    expect(result.confidence).toBeLessThanOrEqual(0.88);
  });

  it('explanation list never exceeds 5 items', () => {
    const result = engine.predict({
      bidAmount: 25, aiFare: 18,
      riderTrustScore: 900, driverTrustScore: 900,
      availableDriversInZone: 10, currentZoneDemand: 0.9,
      isAirport: true, weatherFactor: 1.5, timeOfDay: 18,
      driverAcceptanceHistory: 0.95, driverResponseTimeMs: 2000,
    });
    expect(result.explanation.length).toBeLessThanOrEqual(5);
  });
});
