import { FareEngineService, pickAllowedPricingFeatures } from './fare-engine.service';

// Mock PrismaService and AWS SageMaker
const mockPrisma = {
  platformConfig: { findUnique: jest.fn().mockResolvedValue(null) },
  aiPricingLog: { create: jest.fn().mockResolvedValue({}) },
} as any;

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
} as any;

// AI_SERVICE_URL not set in tests — getAiAdjustment returns {adjustment:0} immediately
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

  // ── Pricing audit (AI Core Phase 2) ────────────────────────────────────────

  describe('pricing audit log', () => {
    beforeEach(() => {
      mockPrisma.aiPricingLog.create.mockClear();
      mockPrisma.aiPricingLog.create.mockResolvedValue({});
      mockRedis.get.mockResolvedValue(null);
    });

    it('writes exactly one audit row per estimate, consistent with the quote', async () => {
      const result = await service.estimateFare(baseInput);
      // Fire-and-forget write — allow the microtask to run.
      await new Promise((r) => setImmediate(r));

      expect(mockPrisma.aiPricingLog.create).toHaveBeenCalledTimes(1);
      const { data } = mockPrisma.aiPricingLog.create.mock.calls[0][0];
      // rawFare + aiAdjustment == finalFare (no minimum-fare clamp for this route)
      expect(Math.abs(data.rawFare + data.aiAdjustment - data.finalFare)).toBeLessThan(0.01);
      expect(data.finalFare).toBe(result.fare);
      expect(data.modelVersion).toBe('fallback-v1'); // AI_SERVICE_URL unset in tests
      expect(data.confidenceScore).toBe(0);
    });

    it('audit row carries requestId, quote linkage, zones, and schemaVersion', async () => {
      await service.estimateFare(baseInput);
      await new Promise((r) => setImmediate(r));

      const { data } = mockPrisma.aiPricingLog.create.mock.calls[0][0];
      const f = data.inputFeatures;
      expect(f.requestId).toBeTruthy();
      // The synthetic quoteId doubles as the (required) tripId column value.
      expect(f.quoteId).toBe(data.tripId);
      expect(f.pickupZone).toBe(
        `${Math.floor(baseInput.pickupLat / 0.018)}:${Math.floor(baseInput.pickupLng / 0.022)}`,
      );
      expect(f.dropoffZone).toBe(
        `${Math.floor(baseInput.dropoffLat / 0.018)}:${Math.floor(baseInput.dropoffLng / 0.022)}`,
      );
      expect(f.vehicleClass).toBe('standard');
      expect(f.schemaVersion).toBe(2); // v2: trust scores removed, allowlist enforced
      expect(f.audit.fallbackUsed).toBe(true);
    });

    it('audit inputFeatures never contain trust scores or identity attributes', async () => {
      await service.estimateFare({ ...baseInput, riderTrustScore: 780, riderId: 'r-1' } as any);
      await new Promise((r) => setImmediate(r));

      const f = mockPrisma.aiPricingLog.create.mock.calls[0][0].data.inputFeatures;
      expect(f).not.toHaveProperty('riderTrustScore');
      expect(f).not.toHaveProperty('driverTrustScore');
      expect(f).not.toHaveProperty('riderId');
      expect(f).not.toHaveProperty('userId');
    });

    it('audit failure never blocks the quote (async rejection)', async () => {
      mockPrisma.aiPricingLog.create.mockRejectedValue(new Error('db down'));
      const result = await service.estimateFare(baseInput);
      expect(result.fare).toBeGreaterThanOrEqual(5.0);
    });

    it('audit failure never blocks the quote (synchronous throw)', async () => {
      mockPrisma.aiPricingLog.create.mockImplementation(() => {
        throw new Error('delegate unavailable');
      });
      const result = await service.estimateFare(baseInput);
      expect(result.fare).toBeGreaterThanOrEqual(5.0);
    });
  });

  // ── Prohibited pricing features (AI Core Phase 2 — Founder rule) ──────────

  describe('pricing feature allowlist', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
      delete process.env.AI_SERVICE_URL;
      mockPrisma.aiPricingLog.create.mockClear();
    });

    it('pickAllowedPricingFeatures drops every attribute not explicitly allowlisted', () => {
      const out = pickAllowedPricingFeatures({
        distanceMiles: 3,
        riderTotalTrips: 8,
        riderTrustScore: 900,   // prohibited
        driverTrustScore: 700,  // prohibited
        riderId: 'r-1',         // prohibited (identity)
        phone: '555-0100',      // prohibited (contact)
        anythingNew: 'sneaky',  // unknown → dropped, never silently admitted
      });

      expect(out).toEqual({ distanceMiles: 3, riderTotalTrips: 8 });
    });

    it('the AI fare hook request never carries trust scores', async () => {
      process.env.AI_SERVICE_URL = 'http://localhost:3012';
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { adjustment: 1 }, modelVersion: 'fare-shadow-v1', fallbackUsed: false }),
      });
      global.fetch = mockFetch as any;

      await service.estimateFare({ ...baseInput, riderTrustScore: 900 } as any);

      const sent = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(sent).not.toHaveProperty('riderTrustScore');
      expect(sent).not.toHaveProperty('driverTrustScore');
      expect(sent.distanceMiles).toBeGreaterThan(0);
    });

    it('while shadowed, AI explainability NEVER reaches the estimate payload (rider-facing leak guard)', async () => {
      process.env.AI_SERVICE_URL = 'http://localhost:3012';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            adjustment: 0, shadow: true,
            confidence: 0.85, explanation: 'Adjustment of $2.00 from: zone_demand (+$1.50)…',
          },
          modelVersion: 'fare-shadow-v1', fallbackUsed: false,
        }),
      }) as any;

      const result = await service.estimateFare(baseInput);

      // Byte-identical to the fallback payload: no aiExplanation, no aiConfidence.
      expect(result).not.toHaveProperty('aiExplanation');
      expect(result).not.toHaveProperty('aiConfidence');
      expect(result.breakdown.aiAdjustment).toBe(0);
    });

    it('explainability passes through only when the AI explicitly served live (shadow: false)', async () => {
      process.env.AI_SERVICE_URL = 'http://localhost:3012';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { adjustment: 1.5, shadow: false, confidence: 0.85, explanation: 'live adjustment' },
          modelVersion: 'fare-live-v1', fallbackUsed: false,
        }),
      }) as any;

      const result = await service.estimateFare(baseInput);

      expect(result.aiExplanation).toBe('live adjustment');
      expect(result.aiConfidence).toBe(0.85);
      expect(result.breakdown.aiAdjustment).toBe(1.5);
    });

    it('a non-numeric AI adjustment degrades to 0 — NaN can never reach a fare', async () => {
      process.env.AI_SERVICE_URL = 'http://localhost:3012';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { adjustment: 'NaN-bait' }, modelVersion: 'x', fallbackUsed: false,
        }),
      }) as any;

      const result = await service.estimateFare(baseInput);

      expect(result.breakdown.aiAdjustment).toBe(0);
      expect(Number.isFinite(result.fare)).toBe(true);
    });

    it('REGRESSION: changing the trust score cannot change the fare', async () => {
      process.env.AI_SERVICE_URL = 'http://localhost:3012';
      // The mocked AI echoes an adjustment derived from what it receives —
      // if a trust score leaked into the payload, the fares would differ.
      global.fetch = jest.fn().mockImplementation(async (_url: string, init: any) => {
        const body = JSON.parse(init.body as string);
        const leaked = Number(body.riderTrustScore ?? 0);
        return {
          ok: true,
          json: async () => ({
            data: { adjustment: Math.min(2, leaked / 1000) },
            modelVersion: 'fare-shadow-v1',
            fallbackUsed: false,
          }),
        };
      }) as any;

      const lowTrust = await service.estimateFare({ ...baseInput, riderTrustScore: 100 } as any);
      const highTrust = await service.estimateFare({ ...baseInput, riderTrustScore: 950 } as any);

      expect(lowTrust.fare).toBe(highTrust.fare);
      expect(lowTrust.breakdown.aiAdjustment).toBe(0);
      expect(highTrust.breakdown.aiAdjustment).toBe(0);
    });
  });

  // ── getDemandZones ─────────────────────────────────────────────────────────

  describe('getDemandZones', () => {
    beforeEach(() => {
      mockRedis.mget = jest.fn().mockResolvedValue([]);
    });

    afterEach(() => {
      mockRedis.mget = jest.fn().mockResolvedValue([]);
    });

    it('returns empty points when Redis is undefined', async () => {
      const noRedisService = new FareEngineService(mockPrisma, undefined);
      const result = await noRedisService.getDemandZones(40.6895, -74.1745, 5);
      expect(result.points).toEqual([]);
      expect(result.generatedAt).toBeDefined();
    });

    it('returns empty points when all zone keys have no demand', async () => {
      mockRedis.mget = jest.fn().mockResolvedValue(Array(100).fill(null));
      const result = await service.getDemandZones(40.6895, -74.1745, 5);
      expect(result.points).toEqual([]);
    });

    it('decodes the EWR zone key into a point with correct coordinates and weight', async () => {
      const ewrLatZone = Math.floor(40.6895 / 0.018); // 2260
      const ewrLngZone = Math.floor(-74.1745 / 0.022); // -3371
      const ewrKey = `surge:requests:${ewrLatZone}:${ewrLngZone}`;

      mockRedis.mget = jest.fn().mockImplementation((...keys: string[]) =>
        Promise.resolve(keys.map((k) => (k === ewrKey ? '12' : null))),
      );

      const result = await service.getDemandZones(40.6895, -74.1745, 5);

      const hit = result.points.find(
        (p) => Math.abs(p.latitude - (ewrLatZone + 0.5) * 0.018) < 0.001,
      );
      expect(hit).toBeDefined();
      expect(hit!.weight).toBe(12);
      expect(hit!.latitude).toBeCloseTo((ewrLatZone + 0.5) * 0.018, 3);
      expect(hit!.longitude).toBeCloseTo((ewrLngZone + 0.5) * 0.022, 3);
    });

    it('includes generatedAt as a valid ISO timestamp', async () => {
      const result = await service.getDemandZones(40.6895, -74.1745, 5);
      expect(new Date(result.generatedAt).getTime()).not.toBeNaN();
    });

    it('returns empty points for invalid coordinates (NaN guard)', async () => {
      const result = await service.getDemandZones(NaN, NaN, 5);
      expect(result.points).toEqual([]);
      expect(mockRedis.mget).not.toHaveBeenCalled();
    });
  });
});
