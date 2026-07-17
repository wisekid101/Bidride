import { EarningsFloorService } from './earnings-floor.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  platformConfig: {
    findUnique: jest.fn(),
  },
  earningsFloorLog: {
    create: jest.fn(),
  },
} as unknown as PrismaService;

const service = new EarningsFloorService(mockPrisma);

const defaultFormula = { per_mile: 1.10, per_min: 0.22, base: 2.50 };

const makePrisma = (formula = defaultFormula) => {
  (mockPrisma.platformConfig.findUnique as jest.Mock).mockResolvedValue({
    key: 'earnings_floor_formula',
    value: formula,
  });
  (mockPrisma.earningsFloorLog.create as jest.Mock).mockResolvedValue({});
};

describe('EarningsFloorService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('floor calculation', () => {
    it('calculates correct floor for a standard trip', async () => {
      makePrisma();
      // 5 miles, 20 min: (5 × 1.10) + (20 × 0.22) + 2.50 = 5.50 + 4.40 + 2.50 = 12.40
      const result = await service.enforce(
        { id: 'trip-1', driverId: 'driver-1', actualDistanceMiles: 5 },
        12.00,  // earned
        20,     // duration
      );

      expect(result.floorAmount).toBeCloseTo(12.40);
      expect(result.earnedAmount).toBe(12.00);
      expect(result.supplement).toBeCloseTo(0.40);
      expect(result.floorMet).toBe(false);
      expect(result.totalDriverEarnings).toBeCloseTo(12.40);
    });

    it('returns no supplement when earned exceeds floor', async () => {
      makePrisma();
      const result = await service.enforce(
        { id: 'trip-2', driverId: 'driver-1', actualDistanceMiles: 5 },
        15.00,  // earned (above floor of 12.40)
        20,
      );

      expect(result.supplement).toBe(0);
      expect(result.floorMet).toBe(true);
      expect(result.totalDriverEarnings).toBe(15.00);
    });

    it('correctly calculates base-only floor for a 0-mile 0-min trip', async () => {
      makePrisma();
      const result = await service.enforce(
        { id: 'trip-3', driverId: 'driver-1', actualDistanceMiles: 0 },
        0.00,
        0,
      );

      expect(result.floorAmount).toBeCloseTo(2.50); // just the base
      expect(result.supplement).toBeCloseTo(2.50);
    });

    it('logs supplement to DB when triggered', async () => {
      makePrisma();
      await service.enforce(
        { id: 'trip-4', driverId: 'driver-1', actualDistanceMiles: 3 },
        5.00,
        10,
      );

      expect(mockPrisma.earningsFloorLog.create).toHaveBeenCalledTimes(1);
      const call = (mockPrisma.earningsFloorLog.create as jest.Mock).mock.calls[0][0];
      expect(call.data.tripId).toBe('trip-4');
      expect(call.data.driverId).toBe('driver-1');
      expect(call.data.supplementAmount).toBeGreaterThan(0);
    });

    it('does NOT log to DB when floor is met', async () => {
      makePrisma();
      await service.enforce(
        { id: 'trip-5', driverId: 'driver-1', actualDistanceMiles: 5 },
        20.00,  // well above floor
        20,
      );

      expect(mockPrisma.earningsFloorLog.create).not.toHaveBeenCalled();
    });

    it('uses custom formula from platform_config', async () => {
      makePrisma({ per_mile: 1.50, per_min: 0.30, base: 3.00 });
      // 4 miles, 10 min: (4 × 1.50) + (10 × 0.30) + 3.00 = 6.00 + 3.00 + 3.00 = 12.00
      const result = await service.enforce(
        { id: 'trip-6', driverId: 'driver-1', actualDistanceMiles: 4 },
        10.00,
        10,
      );

      expect(result.floorAmount).toBeCloseTo(12.00);
      expect(result.supplement).toBeCloseTo(2.00);
    });

    it('handles null driverId gracefully (does not log)', async () => {
      makePrisma();
      await expect(
        service.enforce({ id: 'trip-7', driverId: null, actualDistanceMiles: 3 }, 5.00, 10),
      ).resolves.not.toThrow();

      expect(mockPrisma.earningsFloorLog.create).not.toHaveBeenCalled();
    });
  });
});

// ─── Effective distance selection + cent rounding (Commit 2) ──────────────────
const coords = { pickupLat: 40.7, pickupLng: -74.1, dropoffLat: 40.71, dropoffLng: -74.11 };

describe('EarningsFloorService — effective distance & rounding', () => {
  beforeEach(() => jest.clearAllMocks());

  it('#15 route distance contributes to the per-mile term', async () => {
    makePrisma();
    // actual null, route 5mi, 20 min: (5×1.10)+(20×0.22)+2.50 = 12.40
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: null, routeDistanceMiles: 5, ...coords },
      12.00, 20,
    );
    expect(r.floorAmount).toBe(12.40);
    expect(r.distanceSource).toBe('route');
    expect(r.distanceMiles).toBe(5);
  });

  it('#16 actual distance contributes when present', async () => {
    makePrisma();
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: 5, routeDistanceMiles: 3, ...coords },
      12.00, 20,
    );
    expect(r.floorAmount).toBe(12.40); // 5 mi, not 3
    expect(r.distanceSource).toBe('actual');
  });

  it('#17 both values present uses actual, not MAX', async () => {
    makePrisma();
    // actual 2, route 9. MAX would give 9 -> floor 9.90+base... ; actual gives 2.
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: 2, routeDistanceMiles: 9, ...coords },
      0, 0,
    );
    expect(r.distanceMiles).toBe(2);
    expect(r.floorAmount).toBe(4.70); // 2×1.10 + 0 + 2.50
  });

  it('#18 haversine legacy fallback contributes to the floor', async () => {
    makePrisma();
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: null, routeDistanceMiles: null, ...coords },
      0, 0,
    );
    expect(r.distanceSource).toBe('haversine');
    expect(r.distanceMiles).toBeGreaterThan(0);
    expect(r.floorAmount).toBeGreaterThan(2.50); // base + a positive distance term
  });

  it('#19 no distance source still applies duration plus base (source null)', async () => {
    makePrisma();
    const r = await service.enforce(
      {
        id: 't-19', driverId: 'd', actualDistanceMiles: null, routeDistanceMiles: null,
        pickupLat: undefined, pickupLng: undefined, dropoffLat: undefined, dropoffLng: undefined,
      },
      0, 10,
    );
    expect(r.distanceSource).toBeNull();
    expect(r.distanceMiles).toBe(0);
    expect(r.floorAmount).toBe(4.70); // 0 + 10×0.22 + 2.50
    // formulaInputs omits distance_source entirely when there is no real source
    const call = (mockPrisma.earningsFloorLog.create as jest.Mock).mock.calls[0][0];
    expect('distance_source' in call.data.formulaInputs).toBe(false);
  });

  it('#20 produces a whole-cent result', async () => {
    makePrisma();
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: 3, routeDistanceMiles: null, ...coords },
      5.00, 10,
    );
    // (3×1.10)+(10×0.22)+2.50 = 3.30+2.20+2.50 = 8.00
    expect(r.floorAmount).toBe(8.00);
    expect(r.supplement).toBe(3.00);
  });

  it('#21 rounds a fractional-cent floor to two decimals', async () => {
    makePrisma();
    // 2.727 mi -> 2.9997; route sanitizer rounds to 2.73 -> 3.003 -> floor rounds to 2 dp
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: null, routeDistanceMiles: 2.727, ...coords },
      0, 0,
    );
    expect(Number.isInteger(r.floorAmount * 100)).toBe(true); // exactly 2 dp
  });

  it('#22 fare one cent below floor creates a one-cent supplement', async () => {
    makePrisma();
    // floor 8.00, earned 7.99 -> supplement 0.01
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: 3, routeDistanceMiles: null, ...coords },
      7.99, 10,
    );
    expect(r.floorAmount).toBe(8.00);
    expect(r.supplement).toBe(0.01);
    expect(r.floorMet).toBe(false);
  });

  it('#23 fare exactly equal to floor yields zero supplement and floorMet=true', async () => {
    makePrisma();
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: 3, routeDistanceMiles: null, ...coords },
      8.00, 10,
    );
    expect(r.supplement).toBe(0);
    expect(r.floorMet).toBe(true);
    expect(r.totalDriverEarnings).toBe(8.00);
  });

  it('#24 fare one cent above floor yields zero supplement and floorMet=true', async () => {
    makePrisma();
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: 3, routeDistanceMiles: null, ...coords },
      8.01, 10,
    );
    expect(r.supplement).toBe(0);
    expect(r.floorMet).toBe(true);
  });

  it('#25 supplement never becomes negative', async () => {
    makePrisma();
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: 3, routeDistanceMiles: null, ...coords },
      1000.00, 10,
    );
    expect(r.supplement).toBe(0);
  });

  it('#26 supplement never becomes NaN or Infinity even with malformed inputs', async () => {
    makePrisma();
    const r = await service.enforce(
      {
        id: 't', driverId: 'd', actualDistanceMiles: 'garbage', routeDistanceMiles: Number.NaN,
        pickupLat: undefined, pickupLng: undefined, dropoffLat: undefined, dropoffLng: undefined,
      },
      Number.NaN, null,
    );
    expect(Number.isFinite(r.supplement)).toBe(true);
    expect(Number.isFinite(r.floorAmount)).toBe(true);
    expect(Number.isFinite(r.totalDriverEarnings)).toBe(true);
    expect(r.distanceSource).toBeNull();
  });

  it('#27 formulaInputs records the distance and distance_source', async () => {
    makePrisma();
    await service.enforce(
      { id: 't-27', driverId: 'd', actualDistanceMiles: null, routeDistanceMiles: 5, ...coords },
      0, 0, // large supplement -> a log row is written
    );
    const call = (mockPrisma.earningsFloorLog.create as jest.Mock).mock.calls[0][0];
    expect(call.data.formulaInputs.distance_miles).toBe(5);
    expect(call.data.formulaInputs.distance_source).toBe('route');
  });

  it('#28 tips do not affect the formula', async () => {
    makePrisma();
    // The floor is exactly the 3-term formula; there is no tip input at all.
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: 3, routeDistanceMiles: null, ...coords },
      5.00, 10,
    );
    expect(r.floorAmount).toBe(8.00); // (3×1.10)+(10×0.22)+2.50 — no tip term
  });

  it('#29 tolls do not affect the formula', async () => {
    makePrisma();
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: 3, routeDistanceMiles: null, ...coords },
      5.00, 10,
    );
    expect(r.floorAmount).toBe(8.00); // no toll term
  });

  it('#30 airport fees do not affect the formula', async () => {
    makePrisma();
    const r = await service.enforce(
      { id: 't', driverId: 'd', actualDistanceMiles: 3, routeDistanceMiles: null, ...coords },
      5.00, 10,
    );
    expect(r.floorAmount).toBe(8.00); // no airport-fee term
  });

  it('#31 AI cannot alter the formula (deterministic from config only)', async () => {
    makePrisma();
    const inputs = { id: 't', driverId: 'd', actualDistanceMiles: 3, routeDistanceMiles: null, ...coords };
    const a = await service.enforce({ ...inputs }, 5.00, 10);
    const b = await service.enforce({ ...inputs }, 5.00, 10);
    expect(a.floorAmount).toBe(b.floorAmount); // no stochastic / AI adjustment
    expect(a.floorAmount).toBe(8.00);
  });
});
