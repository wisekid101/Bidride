import { FallbackService } from './fallback.service';

const service = new FallbackService();

describe('FallbackService — fare-adjustment', () => {
  it('returns zero adjustment', () => {
    expect(service.executeForFareAdjustment({})).toEqual({ adjustment: 0 });
  });
});

describe('FallbackService — fraud-score', () => {
  it('returns 0 probability for clean account', () => {
    const result = service.executeForFraudScore({
      linkedAccounts: 0, deviceFingerprints: 1, fraudFlagCount: 0,
      disputeCount: 0, accountAgeDays: 365, totalTrips: 50,
    });
    expect(result.fraudProbability).toBe(0);
  });

  it('returns elevated probability for high-risk signals', () => {
    const result = service.executeForFraudScore({
      linkedAccounts: 3, deviceFingerprints: 6, fraudFlagCount: 1,
      disputeCount: 4, accountAgeDays: 3, totalTrips: 0,
    });
    // 30 (linkedAccounts>2) + 20 (fingerprints>5) + 40 (fraudFlag>0) + 20 (disputes>3) + 10 (new+no trips) = 120 → capped 100
    expect(result.fraudProbability).toBe(100);
  });

  it('caps probability at 100', () => {
    const result = service.executeForFraudScore({
      linkedAccounts: 5, deviceFingerprints: 10, fraudFlagCount: 3,
      disputeCount: 10, accountAgeDays: 1, totalTrips: 0,
    });
    expect(result.fraudProbability).toBe(100);
  });
});

describe('FallbackService — bid-win-probability', () => {
  it('returns 0.5 when aiFare is zero', () => {
    const result = service.executeForBidWinProbability({ bidAmount: 10, aiFare: 0 });
    expect(result.probability).toBe(0.5);
  });

  it('returns higher probability when bid equals AI fare', () => {
    const atFare = service.executeForBidWinProbability({ bidAmount: 20, aiFare: 20 });
    const belowFare = service.executeForBidWinProbability({ bidAmount: 10, aiFare: 20 });
    expect(atFare.probability).toBeGreaterThan(belowFare.probability);
  });

  it('clamps probability to [0, 1]', () => {
    const high = service.executeForBidWinProbability({ bidAmount: 1000, aiFare: 10 });
    const low = service.executeForBidWinProbability({ bidAmount: 0, aiFare: 10 });
    expect(high.probability).toBeLessThanOrEqual(1);
    expect(low.probability).toBeGreaterThanOrEqual(0);
  });
});

describe('FallbackService — surge-forecast', () => {
  it('returns 1.0x when no current requests', () => {
    const result = service.executeForSurgeForecast({ currentRequests: 0 });
    expect(result.forecastedMultiplier).toBe(1.0);
  });

  it('returns 1.4x at full threshold (150 requests)', () => {
    const result = service.executeForSurgeForecast({ currentRequests: 150 });
    expect(result.forecastedMultiplier).toBe(1.4);
  });
});

describe('FallbackService — driver-earnings', () => {
  it('returns floor estimate for typical Newark trip', () => {
    const result = service.executeForDriverEarnings({});
    // (3mi × $1.10) + (12min × $0.22) + $2.50 = $8.44
    expect(result.estimatedEarnings).toBe(8.44);
  });
});

describe('FallbackService — execute dispatch', () => {
  it('routes to correct fallback by model name', () => {
    expect(service.execute('fare-adjustment', {})).toHaveProperty('adjustment');
    expect(service.execute('fraud-score', { linkedAccounts: 0, deviceFingerprints: 0, fraudFlagCount: 0, disputeCount: 0, accountAgeDays: 100, totalTrips: 0 })).toHaveProperty('fraudProbability');
    expect(service.execute('bid-win-probability', { bidAmount: 10, aiFare: 10 })).toHaveProperty('probability');
    expect(service.execute('surge-forecast', { currentRequests: 0 })).toHaveProperty('forecastedMultiplier');
    expect(service.execute('driver-earnings', {})).toHaveProperty('estimatedEarnings');
  });

  it('returns empty object for unknown model', () => {
    expect(service.execute('unknown-model', {})).toEqual({});
  });
});
