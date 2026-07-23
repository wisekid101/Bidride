import { ConflictException } from '@nestjs/common';
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
  // SB2A Batch 2: getProfile reads the active Zero Tolerance policy. Default =
  // no active policy (gate inert), so Batch 1 derivation tests are unaffected.
  zeroTolerancePolicy: { findFirst: jest.fn().mockResolvedValue(null) },
} as any;

const mockRedis = {
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  geoadd: jest.fn().mockResolvedValue(1),
  zrem: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
  get: jest.fn().mockResolvedValue(null),
} as any;

// The shared activation authority — mocked; DriversService only delegates to it.
const mockActivation = {
  maybeActivate: jest.fn(),
  computeMissingRequirements: jest.fn().mockReturnValue([]),
} as any;

describe('DriversService — Redis location key format', () => {
  let service: DriversService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.driver.findUnique.mockResolvedValue(mockApprovedDriver);
    mockPrisma.driver.update.mockResolvedValue({});
    const { CheckrService } = jest.requireMock('./checkr.service');
    service = new DriversService(new CheckrService(), mockActivation);
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
        // Unified with the gateway's LOCATION_TTL_SECONDS (default 180) —
        // one env-driven retention bound for the shared location key.
        180,
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

describe('DriversService.approveDriver — delegates to the shared activation evaluator', () => {
  let service: DriversService;

  beforeEach(() => {
    jest.clearAllMocks();
    const { CheckrService } = jest.requireMock('./checkr.service');
    service = new DriversService(new CheckrService(), mockActivation);
  });

  it('C1: throws APPROVAL_REQUIREMENTS_NOT_MET when the evaluator blocks (same gate as the webhook)', async () => {
    mockActivation.maybeActivate.mockResolvedValue({ outcome: 'blocked', missing: ['no_active_vehicle'] });
    await expect(service.approveDriver('d1', { notes: 'x' } as any, 'admin-1')).rejects.toMatchObject({
      response: { code: 'APPROVAL_REQUIREMENTS_NOT_MET', missing: ['no_active_vehicle'] },
    });
  });

  it('C2: approves via the shared evaluator and forwards admin notes', async () => {
    mockActivation.maybeActivate.mockResolvedValue({ outcome: 'activated' });
    await expect(service.approveDriver('d1', { notes: 'ok' } as any, 'admin-1')).resolves.toEqual({
      success: true,
    });
    expect(mockActivation.maybeActivate).toHaveBeenCalledWith('d1', { notes: 'ok' });
  });

  it('C3: throws Conflict when the driver is already approved', async () => {
    mockActivation.maybeActivate.mockResolvedValue({ outcome: 'already_active' });
    await expect(service.approveDriver('d1', {} as any, 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('DriversService.getProfile — Batch 1 derives the resume step from facts', () => {
  let service: DriversService;

  const baseProfileDriver = {
    id: DRIVER_DB_ID,
    userId: DRIVER_USER_ID,
    status: 'pending',
    onboardingStep: 'personal_info',
    legalFirstName: null,
    legalLastName: null,
    dateOfBirth: null,
    licenseNumber: null,
    stripeAccountId: null,
    backgroundCheckStatus: 'not_started',
    currentBadge: 'verified',
    totalTrips: 0,
    avgRating: null,
    isAvailable: false,
    payoutBankVerified: false,
    zeroToleranceAcceptedVersion: null,
    vehicles: [],
    documents: [],
    user: { phone: '+1', email: 'd@x.com', profilePhotoUrl: null, createdAt: new Date() },
  };

  // A driver who has finished every step EXCEPT Zero Tolerance.
  const fullyOnboardedExceptZt = {
    ...baseProfileDriver,
    status: 'under_review',
    legalFirstName: 'Jane',
    dateOfBirth: new Date('1990-01-01'),
    licenseNumber: 'D123456',
    stripeAccountId: 'acct_1',
    backgroundCheckStatus: 'pending',
    vehicles: [{ isActive: true }],
    documents: [
      { documentType: 'drivers_license', status: 'approved' },
      { documentType: 'insurance', status: 'approved' },
      { documentType: 'registration', status: 'approved' },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const { CheckrService } = jest.requireMock('./checkr.service');
    service = new DriversService(new CheckrService(), mockActivation);
  });

  it('returns the DERIVED step, not the stored cursor, for a legacy obsolete value', async () => {
    // Legacy driver: vehicle + all docs + background done, no bank, stored cursor
    // is the retired `vehicle_inspection`. Canonical resume = bank_account.
    mockPrisma.driver.findUnique.mockResolvedValue({
      ...baseProfileDriver,
      onboardingStep: 'vehicle_inspection',
      legalFirstName: 'Jane',
      dateOfBirth: new Date('1990-01-01'),
      licenseNumber: 'D123456',
      backgroundCheckStatus: 'clear',
      vehicles: [{ isActive: true }],
      documents: [
        { documentType: 'drivers_license', status: 'approved' },
        { documentType: 'insurance', status: 'approved' },
        { documentType: 'registration', status: 'approved' },
      ],
    });

    const res = await service.getProfile(DRIVER_USER_ID);
    expect(res.onboardingStep).toBe('bank_account');
  });

  it('derives personal_info for a brand-new driver regardless of stored cursor', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ ...baseProfileDriver });
    const res = await service.getProfile(DRIVER_USER_ID);
    expect(res.onboardingStep).toBe('personal_info');
  });

  it('derives complete for an approved driver', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({
      ...baseProfileDriver,
      status: 'approved',
      onboardingStep: 'background_check',
    });
    const res = await service.getProfile(DRIVER_USER_ID);
    expect(res.onboardingStep).toBe('complete');
  });

  it('exposes the active vehicle from the included vehicles', async () => {
    const active = { isActive: true, make: 'Toyota' };
    mockPrisma.driver.findUnique.mockResolvedValue({
      ...baseProfileDriver,
      vehicles: [{ isActive: false }, active],
    });
    const res = await service.getProfile(DRIVER_USER_ID);
    expect(res.activeVehicle).toBe(active);
  });

  // ── Batch 2: Zero Tolerance gate ──
  it('derives zero_tolerance when a policy is active and the driver has not accepted it', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ ...fullyOnboardedExceptZt });
    mockPrisma.zeroTolerancePolicy.findFirst.mockResolvedValue({ version: 'zt-v1' });
    const res = await service.getProfile(DRIVER_USER_ID);
    expect(res.onboardingStep).toBe('zero_tolerance');
  });

  it('derives complete once the driver has accepted the CURRENT policy version', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({
      ...fullyOnboardedExceptZt,
      zeroToleranceAcceptedVersion: 'zt-v1',
    });
    mockPrisma.zeroTolerancePolicy.findFirst.mockResolvedValue({ version: 'zt-v1' });
    const res = await service.getProfile(DRIVER_USER_ID);
    expect(res.onboardingStep).toBe('complete');
  });

  it('re-derives zero_tolerance when the policy version has advanced past the accepted one', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({
      ...fullyOnboardedExceptZt,
      zeroToleranceAcceptedVersion: 'zt-v1',
    });
    mockPrisma.zeroTolerancePolicy.findFirst.mockResolvedValue({ version: 'zt-v2' });
    const res = await service.getProfile(DRIVER_USER_ID);
    expect(res.onboardingStep).toBe('zero_tolerance');
  });

  it('gate is INERT when no policy is published (fully-onboarded driver → complete)', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ ...fullyOnboardedExceptZt });
    mockPrisma.zeroTolerancePolicy.findFirst.mockResolvedValue(null);
    const res = await service.getProfile(DRIVER_USER_ID);
    expect(res.onboardingStep).toBe('complete');
  });

  it('getProfile issues NO driver write (derive-without-rewrite invariant, Batch 2)', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ ...fullyOnboardedExceptZt });
    mockPrisma.zeroTolerancePolicy.findFirst.mockResolvedValue({ version: 'zt-v1' });
    await service.getProfile(DRIVER_USER_ID);
    expect(mockPrisma.driver.update).not.toHaveBeenCalled();
  });
});

describe('DriversService.submitPersonalInfo — Batch 1 lands on vehicle_info', () => {
  let service: DriversService;

  const validPersonalInfo = {
    legalFirstName: 'Jane',
    legalLastName: 'Doe',
    dateOfBirth: '1990-01-01',
    streetAddress: '1 Main St',
    city: 'Newark',
    state: 'NJ',
    zipCode: '07102',
    ssn: '123456789',
    licenseNumber: 'D1234567',
    licenseState: 'NJ',
    licenseExpiry: '2030-01-01',
    insuranceProvider: 'Acme',
    insurancePolicyNumber: 'P123',
    insuranceExpiry: '2030-01-01',
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.driver.update.mockResolvedValue({});
    mockPrisma.driver.findFirst.mockResolvedValue(null);
    const { CheckrService } = jest.requireMock('./checkr.service');
    service = new DriversService(new CheckrService(), mockActivation);
  });

  it('advances the cursor to vehicle_info (vehicle precedes documents) and reports it as nextStep', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({
      id: DRIVER_DB_ID,
      userId: DRIVER_USER_ID,
      status: 'pending',
      onboardingStep: 'personal_info',
    });

    const res = await service.submitPersonalInfo(DRIVER_USER_ID, validPersonalInfo);

    expect(mockPrisma.driver.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ onboardingStep: 'vehicle_info' }),
      }),
    );
    expect(res).toEqual({ success: true, nextStep: 'vehicle_info' });
  });
});

describe('DriversService.requestBackgroundCheck — Batch 1 must NOT regress the cursor', () => {
  let service: DriversService;
  const checkr = {
    createCandidate: jest.fn().mockResolvedValue('cand_1'),
    createReport: jest.fn().mockResolvedValue('rpt_1'),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.driver.update.mockResolvedValue({});
    mockRedis.setex.mockResolvedValue('OK');
    service = new DriversService(checkr, mockActivation);
  });

  it('orders the check without writing onboardingStep, and reports nextStep=complete', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({
      id: DRIVER_DB_ID,
      userId: DRIVER_USER_ID,
      status: 'under_review',
      onboardingStep: 'background_check',
      backgroundCheckStatus: 'not_started',
      legalFirstName: 'Jane',
      legalLastName: 'Doe',
      dateOfBirth: new Date('1990-01-01'),
      homeZip: '07102',
      user: { email: 'd@x.com', phone: '+1' },
    });

    const res = await service.requestBackgroundCheck(DRIVER_USER_ID, { fcraConsentGiven: true });

    // The cursor is a derived value now — this write must not touch onboardingStep.
    const updateArg = mockPrisma.driver.update.mock.calls[0][0];
    expect(updateArg.data).not.toHaveProperty('onboardingStep');
    expect(updateArg.data.backgroundCheckStatus).toBe('pending');
    // Batch 2: the next canonical step after background is Zero Tolerance.
    expect(res).toEqual({ success: true, nextStep: 'zero_tolerance' });
  });
});
