import { DispatchService } from './dispatch.service';

const mockRedis = {
  publish: jest.fn().mockResolvedValue(1),
} as any;

const mockPrisma = {
  driverBidExposure: {
    createMany: jest.fn().mockResolvedValue({ count: 2 }),
  },
} as any;

const service = new DispatchService(mockRedis, mockPrisma);

beforeEach(() => jest.clearAllMocks());

const baseTripArg = {
  id: 'trip-1',
  pickupLat: 40.7,
  pickupLng: -74.1,
  dropoffLat: 40.71,
  dropoffLng: -74.11,
  pickupAddress: '123 Main St',
  dropoffAddress: '456 Elm St',
  isAirportTrip: false,
};

const baseBidArg = { id: 'bid-1', riderOffer: 18 };

describe('DispatchService — broadcastBidRequest', () => {
  it('publishes bid:incoming to each target driver individually', async () => {
    await service.broadcastBidRequest(
      baseTripArg, baseBidArg, 20, 12, 3.5, 15, 'Verified', ['u-driver-1', 'u-driver-2'],
    );

    expect(mockRedis.publish).toHaveBeenCalledTimes(2);
    expect(mockRedis.publish).toHaveBeenCalledWith('user:u-driver-1:events', expect.stringContaining('"event":"bid:incoming"'));
    expect(mockRedis.publish).toHaveBeenCalledWith('user:u-driver-2:events', expect.stringContaining('"event":"bid:incoming"'));
  });

  it('logs a DriverBidExposure row for each driver that received the bid', async () => {
    await service.broadcastBidRequest(
      baseTripArg, baseBidArg, 20, 12, 3.5, 15, 'Verified', ['u-driver-1', 'u-driver-2'],
    );

    // Allow fire-and-forget to settle
    await new Promise(setImmediate);

    expect(mockPrisma.driverBidExposure.createMany).toHaveBeenCalledWith({
      data: [
        { bidId: 'bid-1', tripId: 'trip-1', driverUserId: 'u-driver-1' },
        { bidId: 'bid-1', tripId: 'trip-1', driverUserId: 'u-driver-2' },
      ],
    });
  });

  it('skips exposure logging when no drivers are targeted', async () => {
    await service.broadcastBidRequest(
      baseTripArg, baseBidArg, 20, 12, 3.5, 15, 'Verified', [],
    );

    await new Promise(setImmediate);

    expect(mockPrisma.driverBidExposure.createMany).not.toHaveBeenCalled();
  });
});

// ─── Authenticated push to notification-service ──────────────────────────────
// notification-service now guards /internal/notifications/* with InternalKeyGuard.
// Both FCM push callers must present x-internal-key in deployed posture, while
// staying keyless-compatible for dev/test. Payloads must be unchanged.
describe('DispatchService — authenticated FCM push callers', () => {
  let fetchSpy: jest.SpyInstance;
  const ORIGINAL_KEY = process.env.INTERNAL_SERVICE_KEY;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (ORIGINAL_KEY === undefined) delete process.env.INTERNAL_SERVICE_KEY;
    else process.env.INTERNAL_SERVICE_KEY = ORIGINAL_KEY;
  });

  describe('sendFcmPush (single-token push)', () => {
    it('sends x-internal-key and unchanged payload in deployed posture', async () => {
      process.env.INTERNAL_SERVICE_KEY = 'deployed-secret-key';

      await (service as any).sendFcmPush('tok-1', 'Title', 'Body', { type: 'X', tripId: 't1' });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('/internal/notifications/push');
      expect(init.method).toBe('POST');
      expect(init.headers['x-internal-key']).toBe('deployed-secret-key');
      expect(JSON.parse(init.body)).toEqual({
        token: 'tok-1', title: 'Title', body: 'Body', data: { type: 'X', tripId: 't1' },
      });
    });

    it('omits the header keyless (dev/test) but still delivers the push', async () => {
      delete process.env.INTERNAL_SERVICE_KEY;

      await (service as any).sendFcmPush('tok-1', 'Title', 'Body');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][1].headers['x-internal-key']).toBeUndefined();
    });
  });

  describe('sendFcmPushMultiple (multi-token push)', () => {
    it('sends x-internal-key and unchanged payload in deployed posture', async () => {
      process.env.INTERNAL_SERVICE_KEY = 'deployed-secret-key';

      await (service as any).sendFcmPushMultiple(['a', 'b'], 'Title', 'Body', { type: 'Y' });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('/internal/notifications/push-multiple');
      expect(init.method).toBe('POST');
      expect(init.headers['x-internal-key']).toBe('deployed-secret-key');
      expect(JSON.parse(init.body)).toEqual({
        tokens: ['a', 'b'], title: 'Title', body: 'Body', data: { type: 'Y' },
      });
    });

    it('omits the header keyless (dev/test) but still delivers the push', async () => {
      delete process.env.INTERNAL_SERVICE_KEY;

      await (service as any).sendFcmPushMultiple(['a', 'b'], 'Title', 'Body');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][1].headers['x-internal-key']).toBeUndefined();
    });
  });
});

// ─── Counter-notification identity boundary (F1) ─────────────────────────────
//
// The driver-facing channel `user:{id}:events` and the push-token lookup are
// both keyed by User.id. These previously received Driver.id, so every
// counter notification was published to a channel nobody subscribes to.
// Driver.id and User.id are distinct values and must never be interchanged.

const DRIVER = { id: 'driver-profile-id', userId: 'driver-user-id' };
const OTHER_DRIVER = { id: 'other-driver-profile-id', userId: 'other-driver-user-id' };

/** Channels published to during the current test. */
const channels = () => mockRedis.publish.mock.calls.map((c: unknown[]) => c[0] as string);
/** Parsed payload for a given channel. */
const payloadOn = (channel: string) => {
  const call = mockRedis.publish.mock.calls.find((c: unknown[]) => c[0] === channel);
  return call ? (JSON.parse(call[1] as string) as Record<string, unknown>) : undefined;
};

describe('DispatchService — counter notifications address the driver by User.id', () => {
  it('counter accepted publishes to the driver user channel', async () => {
    await service.notifyDriverCounterAccepted('trip-1', 'bid-1', DRIVER, 24.5);

    expect(channels()).toContain(`user:${DRIVER.userId}:events`);
    expect(payloadOn(`user:${DRIVER.userId}:events`)).toMatchObject({
      event: 'bid:counterAccepted',
      bidId: 'bid-1',
      tripId: 'trip-1',
      finalFare: 24.5,
    });
  });

  it('counter declined publishes to the driver user channel', async () => {
    await service.notifyDriverCounterDeclined('trip-1', 'bid-1', DRIVER.userId);

    expect(channels()).toContain(`user:${DRIVER.userId}:events`);
    expect(payloadOn(`user:${DRIVER.userId}:events`)).toMatchObject({
      event: 'bid:counterDeclined',
      bidId: 'bid-1',
      tripId: 'trip-1',
    });
  });

  it('counter expired publishes to the driver user channel', async () => {
    await service.notifyCounterExpired('trip-1', 'bid-1', DRIVER.userId);

    expect(channels()).toContain(`user:${DRIVER.userId}:events`);
    expect(payloadOn(`user:${DRIVER.userId}:events`)).toMatchObject({
      event: 'bid:counterExpired',
      bidId: 'bid-1',
      tripId: 'trip-1',
    });
  });

  it('never uses Driver.id as the user-channel identifier', async () => {
    await service.notifyDriverCounterAccepted('trip-1', 'bid-1', DRIVER, 24.5);
    await service.notifyDriverCounterDeclined('trip-1', 'bid-1', DRIVER.userId);
    await service.notifyCounterExpired('trip-1', 'bid-1', DRIVER.userId);

    // The regression itself: `user:{Driver.id}:events` must never be published.
    expect(channels()).not.toContain(`user:${DRIVER.id}:events`);
    expect(channels().some((c) => c.includes(DRIVER.id))).toBe(false);
  });

  it('does not notify a different driver', async () => {
    await service.notifyDriverCounterAccepted('trip-1', 'bid-1', DRIVER, 24.5);
    await service.notifyDriverCounterDeclined('trip-1', 'bid-1', DRIVER.userId);
    await service.notifyCounterExpired('trip-1', 'bid-1', DRIVER.userId);

    expect(channels()).not.toContain(`user:${OTHER_DRIVER.userId}:events`);
    expect(channels()).not.toContain(`user:${OTHER_DRIVER.id}:events`);
  });

  it('resolves the push token by User.id, not Driver.id', async () => {
    mockPrisma.driver = { findUnique: jest.fn().mockResolvedValue({ pushToken: null }) };

    await service.notifyDriverCounterAccepted('trip-1', 'bid-1', DRIVER, 24.5);
    // pushToDriverByUserId is fire-and-forget; let its microtask run.
    await new Promise((r) => setImmediate(r));

    expect(mockPrisma.driver.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: DRIVER.userId } }),
    );
  });

  it('preserves the rider-facing payload, which still carries Driver.id', async () => {
    await service.notifyDriverCounterAccepted('trip-1', 'bid-1', DRIVER, 24.5);

    // Unchanged contract: the rider payload's driverId has always been a
    // Driver.id and must not silently become a User.id.
    expect(payloadOn('rider:trip:trip-1')).toMatchObject({
      event: 'trip:accepted',
      bidId: 'bid-1',
      tripId: 'trip-1',
      finalFare: 24.5,
      driverId: DRIVER.id,
    });
  });

  it('is a no-op when no driver is attached', async () => {
    await service.notifyDriverCounterAccepted('trip-1', 'bid-1', null, 24.5);
    await service.notifyCounterExpired('trip-1', 'bid-1', null);

    // Only the rider-facing counter-expired message is published.
    expect(channels()).toEqual(['rider:trip:trip-1']);
  });
});
