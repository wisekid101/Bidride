import { FareEngineService } from './fare-engine.service';

// Mock PrismaService and AWS SageMaker
const mockPrisma = {
  platformConfig: { findUnique: jest.fn().mockResolvedValue(null) },
} as any;

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
} as any;

// Stub SageMaker — return 0 adjustment by default
jest.mock('aws-sdk', () => ({
  SageMakerRuntime: jest.fn().mockImplementation(() => ({
    invokeEndpoint: jest.fn().mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Body: JSON.stringify({ adjustment: 0 }) }),
    }),
  })),
}));

const service = new FareEngineService(mockPrisma, mockRedis);

describe('FareEngineService', () => {
  const baseInput = {
    pickupLat: 40.7128,
    pickupLng: -74.0060,
    dropoffLat: 40.7580,
    dropoffLng: -73.9855,
    rideType: 'standard',
    requestedAt: new Date('2026-06-06T14:00:00'), // 2pm — no night premium
  };

  it('returns a fare above the $5.00 minimum', async () => {
    const result = await service.estimateFare(baseInput);
    expect(result.fare).toBeGreaterThanOrEqual(5.00);
  });

  it('includes base fare in breakdown', async () => {
    const result = await service.estimateFare(baseInput);
    expect(result.breakdown.base).toBe(2.50);
  });

  it('charges no night premium at 2pm', async () => {
    const result = await service.estimateFare(baseInput);
    expect(result.breakdown.night).toBe(0);
  });

  it('charges night premium at 11pm', async () => {
    const nightInput = {
      ...baseInput,
      requestedAt: new Date('2026-06-06T23:00:00'),
    };
    const result = await service.estimateFare(nightInput);
    expect(result.breakdown.night).toBe(1.00);
  });

  it('charges airport premium when isAirportTrip is true', async () => {
    const result = await service.estimateFare({ ...baseInput, isAirportTrip: true });
    expect(result.breakdown.airport).toBe(3.50);
  });

  it('charges no airport premium for standard trips', async () => {
    const result = await service.estimateFare({ ...baseInput, isAirportTrip: false });
    expect(result.breakdown.airport).toBe(0);
  });

  it('AI adjustment is bounded to ±$2.00', async () => {
    const result = await service.estimateFare(baseInput);
    expect(Math.abs(result.breakdown.aiAdjustment)).toBeLessThanOrEqual(2.00);
  });

  it('returns distance and duration in result', async () => {
    const result = await service.estimateFare(baseInput);
    expect(result.distanceMiles).toBeGreaterThan(0);
    expect(result.durationMin).toBeGreaterThan(0);
  });

  it('surge multiplier defaults to 1.0 when no surge', async () => {
    mockRedis.get.mockResolvedValue(null);
    const result = await service.estimateFare(baseInput);
    expect(result.surgeMultiplier).toBe(1.0);
  });

  it('reads surge:requests:{zone} from Redis and applies multiplier', async () => {
    // 150 requests = 100% of threshold → surge score = 1.0 → multiplier = 1 + (1.0 × 0.4) = 1.4
    mockRedis.get.mockResolvedValue('150');
    mockPrisma.platformConfig.findUnique.mockResolvedValue({
      key: 'ai_surge_config',
      value: { requests_per_zone_threshold: 150 },
    });

    const result = await service.estimateFare(baseInput);

    expect(mockRedis.get).toHaveBeenCalledWith(expect.stringContaining('surge:requests:'));
    expect(result.surgeMultiplier).toBe(1.4);

    // Restore defaults
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.platformConfig.findUnique.mockResolvedValue(null);
  });

  it('fare calculation is deterministic with same inputs (no AI)', async () => {
    // SageMaker returns 0 in both calls
    const r1 = await service.estimateFare(baseInput);
    const r2 = await service.estimateFare(baseInput);
    expect(r1.fare).toBe(r2.fare);
  });
});
