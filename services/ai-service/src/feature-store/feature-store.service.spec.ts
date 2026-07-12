import { FeatureStoreService } from './feature-store.service';
import { FEATURE_TTL_SEC, FEATURE_REGISTRY } from './feature-registry';

const mockRedis = {
  keys: jest.fn(),
  get: jest.fn(),
  scard: jest.fn(),
  setex: jest.fn(),
} as any;

const mockPrisma = {
  tripEvent: { findMany: jest.fn() },
  bidOutcome: { count: jest.fn() },
  trip: { count: jest.fn(), findMany: jest.fn() },
  driver: { count: jest.fn() },
} as any;

let service: FeatureStoreService;

// setex calls keyed by feature name for readable assertions.
const written = (): Record<string, { ttl: number; value: unknown }> => {
  const out: Record<string, { ttl: number; value: unknown }> = {};
  for (const [key, ttl, payload] of mockRedis.setex.mock.calls) {
    out[key.replace('ai:feature:', '')] = { ttl, value: JSON.parse(payload).value };
  }
  return out;
};

beforeEach(() => {
  jest.clearAllMocks();
  service = new FeatureStoreService(mockPrisma, mockRedis);
  mockRedis.keys.mockResolvedValue([]);
  mockRedis.get.mockResolvedValue(null);
  mockRedis.scard.mockResolvedValue(0);
  mockRedis.setex.mockResolvedValue('OK');
  mockPrisma.tripEvent.findMany.mockResolvedValue([]);
  mockPrisma.bidOutcome.count.mockResolvedValue(0);
  mockPrisma.trip.count.mockResolvedValue(0);
  mockPrisma.trip.findMany.mockResolvedValue([]);
  mockPrisma.driver.count.mockResolvedValue(0);
});

// ─── Individual projections ───────────────────────────────────────────────────

describe('FeatureStoreService — projections', () => {
  it('demand: projects each surge:requests zone counter into a zoned feature', async () => {
    mockRedis.keys.mockImplementation(async (pattern: string) =>
      pattern === 'surge:requests:*' ? ['surge:requests:2261:-3374'] : [],
    );
    mockRedis.get.mockImplementation(async (key: string) =>
      key === 'surge:requests:2261:-3374' ? '7' : null,
    );

    await service.projectAll();

    expect(written()['demand:2261:-3374'].value).toBe(7);
  });

  it('supply: projects surge:drivers set cardinality per zone', async () => {
    mockRedis.keys.mockImplementation(async (pattern: string) =>
      pattern === 'surge:drivers:*' ? ['surge:drivers:2261:-3374'] : [],
    );
    mockRedis.scard.mockResolvedValue(4);

    await service.projectAll();

    expect(written()['supply:2261:-3374'].value).toBe(4);
  });

  it('acceptance_rate: accepted / total over the window', async () => {
    mockPrisma.bidOutcome.count.mockImplementation(async (args: any) =>
      args?.where?.wasAccepted === true ? 7 : 10,
    );

    await service.projectAll();

    expect(written()['acceptance_rate'].value).toBe(0.7);
  });

  it('acceptance_rate: null below the minimum sample of 5', async () => {
    mockPrisma.bidOutcome.count.mockResolvedValue(4);

    await service.projectAll();

    expect(written()['acceptance_rate'].value).toBeNull();
  });

  it('cancellation_rate: cancelled / terminal trips', async () => {
    mockPrisma.trip.count.mockImplementation(async (args: any) => {
      if (args?.where?.status === 'cancelled') return 2;
      if (args?.where?.status === 'completed') return 8;
      return 0;
    });

    await service.projectAll();

    expect(written()['cancellation_rate'].value).toBe(0.2);
  });

  it('driver_utilization: in-progress trips over online drivers, clamped to 1', async () => {
    mockPrisma.trip.count.mockImplementation(async (args: any) =>
      args?.where?.status === 'in_progress' ? 3 : 0,
    );
    mockPrisma.driver.count.mockResolvedValue(10);

    await service.projectAll();

    expect(written()['driver_utilization'].value).toBe(0.3);
  });

  it('driver_utilization: null when no drivers are online (never divides by zero)', async () => {
    mockPrisma.driver.count.mockResolvedValue(0);

    await service.projectAll();

    expect(written()['driver_utilization'].value).toBeNull();
  });

  it('airport_demand: reads the EWR zone counter, 0 when absent', async () => {
    const ewrZone = `${Math.floor(40.6895 / 0.018)}:${Math.floor(-74.1745 / 0.022)}`;
    mockRedis.get.mockImplementation(async (key: string) =>
      key === `surge:requests:${ewrZone}` ? '12' : null,
    );

    await service.projectAll();
    expect(written()['airport_demand'].value).toBe(12);

    mockRedis.setex.mockClear();
    mockRedis.get.mockResolvedValue(null);
    await service.projectAll();
    expect(written()['airport_demand'].value).toBe(0);
  });
});

// ─── Quality gate: only Trusted trips feed monetary features ─────────────────

describe('FeatureStoreService — monetary quality gate', () => {
  const trusted = (tripIds: string[]) =>
    mockPrisma.tripEvent.findMany.mockResolvedValue(
      tripIds.map((id) => ({ tripId: id, metadata: { class: 'trusted' } })),
    );

  it('customer_savings sums aiFare − finalFare over TRUSTED bid trips only', async () => {
    trusted(['t-good']);
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args?.where?.bidId
        ? [
            { id: 't-good', aiFare: 20, finalFare: 16 },       // trusted → counts (+4)
            { id: 't-excluded', aiFare: 50, finalFare: 10 },   // not trusted → ignored
          ]
        : [],
    );

    await service.projectAll();

    expect(written()['customer_savings'].value).toBe(4);
  });

  it('a trip whose latest classification downgraded from trusted no longer contributes', async () => {
    mockPrisma.tripEvent.findMany.mockResolvedValue([
      { tripId: 't-1', metadata: { class: 'trusted' } },
      { tripId: 't-1', metadata: { class: 'excluded' } }, // later verdict wins
    ]);
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args?.where?.bidId ? [{ id: 't-1', aiFare: 20, finalFare: 10 }] : [],
    );

    await service.projectAll();

    expect(written()['customer_savings'].value).toBe(0);
  });

  it('average_fare and driver_earnings_avg use trusted trips only, null below sample', async () => {
    trusted(['t1', 't2', 't3', 't4', 't5']);
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args?.where?.bidId
        ? []
        : [
            ...['t1', 't2', 't3', 't4', 't5'].map((id) => ({ id, finalFare: 20, driverEarnings: 15 })),
            { id: 't-untrusted', finalFare: 900, driverEarnings: 800 }, // must not skew
          ],
    );

    await service.projectAll();

    expect(written()['average_fare'].value).toBe(20);
    expect(written()['driver_earnings_avg'].value).toBe(15);
  });

  it('monetary averages are null when trusted samples are too few', async () => {
    trusted(['t1']);
    mockPrisma.trip.findMany.mockImplementation(async (args: any) =>
      args?.where?.bidId ? [] : [{ id: 't1', finalFare: 20, driverEarnings: 15 }],
    );

    await service.projectAll();

    expect(written()['average_fare'].value).toBeNull();
    expect(written()['driver_earnings_avg'].value).toBeNull();
  });
});

// ─── Redis TTL and failure isolation ──────────────────────────────────────────

describe('FeatureStoreService — Redis behavior', () => {
  it(`every feature write carries the ${FEATURE_TTL_SEC}s TTL — bounded retention by construction`, async () => {
    await service.projectAll();

    expect(mockRedis.setex.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockRedis.setex.mock.calls) {
      expect(call[1]).toBe(FEATURE_TTL_SEC);
    }
  });

  it('a failing setex never breaks the projection run', async () => {
    mockRedis.setex.mockRejectedValue(new Error('redis down'));

    await expect(service.projectAll()).resolves.toBeUndefined();
  });

  it('a failing keys scan never breaks the projection run', async () => {
    mockRedis.keys.mockRejectedValue(new Error('redis down'));

    await expect(service.projectAll()).resolves.toBeUndefined();
  });

  it('without a Redis client the projection job is disabled, not crashing', async () => {
    const noRedis = new FeatureStoreService(mockPrisma, undefined);

    noRedis.onModuleInit(); // logs a warning, starts no timer
    await expect(noRedis.projectAll()).resolves.toBeUndefined();
    noRedis.onModuleDestroy();

    expect(mockRedis.setex).not.toHaveBeenCalled();
  });
});

// ─── Snapshot endpoint ────────────────────────────────────────────────────────

describe('FeatureStoreService — snapshot', () => {
  it('returns the documented registry plus current values', async () => {
    mockRedis.keys.mockImplementation(async (pattern: string) =>
      pattern === 'ai:feature:*' ? ['ai:feature:demand:2261:-3374'] : [],
    );
    mockRedis.get.mockResolvedValue(JSON.stringify({ value: 7, computedAt: 'now' }));

    const snap = await service.snapshot();

    expect(snap.registry).toBe(FEATURE_REGISTRY);
    expect(snap.registry.length).toBeGreaterThanOrEqual(9);
    expect(snap.values['demand:2261:-3374']).toEqual({ value: 7, computedAt: 'now' });
  });

  it('every registry entry documents owner, definition, source, validation, freshness, and usage', () => {
    for (const spec of FEATURE_REGISTRY) {
      expect(spec.name).toBeTruthy();
      expect(spec.owner).toBeTruthy();
      expect(spec.definition).toBeTruthy();
      expect(spec.source).toBeTruthy();
      expect(spec.validation).toBeTruthy();
      expect(spec.freshnessSlaSec).toBeGreaterThan(0);
      expect(spec.usage).toBeTruthy();
    }
  });
});
