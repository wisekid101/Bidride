import { MarketplaceController } from './marketplace.controller';

// Only the driver-ranking shadow gate is under test — the other injected
// services are inert stubs.
const mockRanking = { rankDrivers: jest.fn() } as any;
const stub = {} as any;
const mockShadowMode = { isShadow: jest.fn(), isLive: jest.fn() } as any;

const controller = new MarketplaceController(
  mockRanking,
  stub, // dispatch simulator
  stub, // repositioning
  stub, // heatmap
  stub, // demand forecast
  stub, // earnings optimizer
  mockShadowMode,
);

const candidates = [
  { driverUserId: 'driver-far', distanceMiles: 4.0, etaMinutes: 12 },
  { driverUserId: 'driver-near', distanceMiles: 0.5, etaMinutes: 2 },
];

// The real engine would reorder: near driver first with a high score.
const realRanking = [
  { driverUserId: 'driver-near', score: 82.5 },
  { driverUserId: 'driver-far', score: 41.0 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockRanking.rankDrivers.mockResolvedValue(realRanking);
  mockShadowMode.isShadow.mockResolvedValue(true);
});

describe('MarketplaceController — driver-ranking shadow gate', () => {
  it('while shadowed, serves the caller fallback exactly: INPUT order, every score 50', async () => {
    const result = await controller.rankDrivers({ tripId: 't-1', candidates } as any);

    // Identical to bids.service rankDriversWithFallback's own fallback:
    // driverUserIds.map(id => ({driverUserId: id, score: 50})) in input order.
    expect(result.map((r: any) => r.driverUserId)).toEqual(['driver-far', 'driver-near']);
    expect(result.every((r: any) => r.score === 50)).toBe(true);
  });

  it('while shadowed, the REAL ranking is computed and rides along as shadowScore only', async () => {
    const result = await controller.rankDrivers({ tripId: 't-1', candidates } as any);

    expect(mockRanking.rankDrivers).toHaveBeenCalledTimes(1); // real ranking always runs (and logs)
    const near = result.find((r: any) => r.driverUserId === 'driver-near') as any;
    const far = result.find((r: any) => r.driverUserId === 'driver-far') as any;
    expect(near.shadowScore).toBe(82.5);
    expect(far.shadowScore).toBe(41.0);
    expect(near.shadow).toBe(true);
  });

  it('serves the real ranking only when the ranking family is live', async () => {
    mockShadowMode.isShadow.mockResolvedValue(false);

    const result = await controller.rankDrivers({ tripId: 't-1', candidates } as any);

    expect(result).toBe(realRanking);
    expect((result as any)[0].driverUserId).toBe('driver-near');
  });

  it('handles missing candidates defensively while shadowed', async () => {
    mockRanking.rankDrivers.mockResolvedValue([]);

    const result = await controller.rankDrivers({ tripId: 't-1' } as any);

    expect(result).toEqual([]);
  });
});
