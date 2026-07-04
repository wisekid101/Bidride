import { DriversService } from './drivers.service';

// Mock PrismaClient
jest.mock('@bidride/database', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
  DriverStatus: {
    pending: 'pending',
    under_review: 'under_review',
    action_required: 'action_required',
    approved: 'approved',
    declined: 'declined',
    suspended: 'suspended',
  },
  BackgroundCheckStatus: {
    not_started: 'not_started',
    pending: 'pending',
    clear: 'clear',
    consider: 'consider',
    adverse_action: 'adverse_action',
    disputed: 'disputed',
  },
}));

// Mock ioredis
jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => mockRedis),
}));

// Mock CheckrService (not under test here)
jest.mock('./checkr.service', () => ({
  CheckrService: jest.fn().mockImplementation(() => ({})),
}));

const DRIVER_DB_ID = 'driver-db-uuid-1';
const DRIVER_USER_ID = 'user-auth-uuid-1';

const mockApprovedDriver = {
  id: DRIVER_DB_ID,
  userId: DRIVER_USER_ID,
  status: 'approved',
  isAvailable: false,
};

const mockPrisma = {
  driver: {
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  driverEarnings: { findMany: jest.fn().mockResolvedValue([]) },
  earningsFloorLog: { findMany: jest.fn().mockResolvedValue([]) },
} as any;

const mockRedis = {
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  geoadd: jest.fn().mockResolvedValue(1),
  zrem: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
  get: jest.fn().mockResolvedValue(null),
} as any;

describe('DriversService — Redis location key format', () => {
  let service: DriversService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.driver.findUnique.mockResolvedValue(mockApprovedDriver);
    mockPrisma.driver.update.mockResolvedValue({});
    const { CheckrService } = jest.requireMock('./checkr.service');
    service = new DriversService(new CheckrService());
  });

  // ── updateAvailability — go online ───────────────────────────────────────

  describe('updateAvailability — go online', () => {
    it('writes driver:{userId}:location (not driver:location:{driver.id})', async () => {
      await service.updateAvailability(DRIVER_USER_ID, {
        isAvailable: true,
        currentLat: '40.6950',
        currentLng: '-74.1750',
      });

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `driver:${DRIVER_USER_ID}:location`,
        300,
        JSON.stringify({ lat: 40.695, lng: -74.175 }),
      );
    });

    it('does NOT write the old driver:location:{driver.id} format', async () => {
      await service.updateAvailability(DRIVER_USER_ID, {
        isAvailable: true,
        currentLat: '40.6950',
        currentLng: '-74.1750',
      });

      const calls: string[] = mockRedis.setex.mock.calls.map((c: string[]) => c[0]);
      expect(calls.every((k) => !k.startsWith('driver:location:'))).toBe(true);
    });

    it('adds userId (not driver.id) to drivers:geo sorted set', async () => {
      await service.updateAvailability(DRIVER_USER_ID, {
        isAvailable: true,
        currentLat: '40.6950',
        currentLng: '-74.1750',
      });

      expect(mockRedis.geoadd).toHaveBeenCalledWith(
        'drivers:geo',
        -74.175,
        40.695,
        DRIVER_USER_ID,
      );
    });
  });

  // ── updateAvailability — go offline ──────────────────────────────────────

  describe('updateAvailability — go offline', () => {
    it('deletes driver:{userId}:location on go-offline', async () => {
      await service.updateAvailability(DRIVER_USER_ID, { isAvailable: false });

      expect(mockRedis.del).toHaveBeenCalledWith(`driver:${DRIVER_USER_ID}:location`);
    });

    it('removes userId (not driver.id) from drivers:geo on go-offline', async () => {
      await service.updateAvailability(DRIVER_USER_ID, { isAvailable: false });

      expect(mockRedis.zrem).toHaveBeenCalledWith('drivers:geo', DRIVER_USER_ID);
    });
  });

  // ── suspendDriver ────────────────────────────────────────────────────────

  describe('suspendDriver', () => {
    it('deletes driver:{driver.userId}:location using userId (not the driverId arg)', async () => {
      await service.suspendDriver(DRIVER_DB_ID, { reason: 'policy_violation' }, 'admin-1');

      expect(mockRedis.del).toHaveBeenCalledWith(`driver:${DRIVER_USER_ID}:location`);
    });

    it('removes userId (not driverId) from drivers:geo on suspend', async () => {
      await service.suspendDriver(DRIVER_DB_ID, { reason: 'policy_violation' }, 'admin-1');

      expect(mockRedis.zrem).toHaveBeenCalledWith('drivers:geo', DRIVER_USER_ID);
    });

    it('publishes driver:suspended event with both driverId and userId', async () => {
      await service.suspendDriver(DRIVER_DB_ID, { reason: 'policy_violation' }, 'admin-1');

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'driver:suspended',
        expect.stringContaining(DRIVER_USER_ID),
      );
    });
  });
});
