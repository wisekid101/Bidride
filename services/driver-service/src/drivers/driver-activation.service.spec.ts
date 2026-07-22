import { NotFoundException } from '@nestjs/common';
import { DriverActivationService } from './driver-activation.service';

// Mock PrismaClient + enums (same shape as checkr.service.spec.ts)
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

jest.mock('ioredis', () => ({ Redis: jest.fn().mockImplementation(() => mockRedis) }));

const mockPrisma = {
  driver: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
} as any;

const mockRedis = { publish: jest.fn().mockResolvedValue(1) } as any;

const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

// A fully-gated driver: every one of the four existing activation gates satisfied.
function makeDriver(overrides: Record<string, unknown> = {}) {
  return {
    id: 'driver-1',
    userId: 'user-1',
    status: 'pending',
    backgroundCheckStatus: 'clear',
    insuranceProvider: 'GEICO',
    insurancePolicyNumber: 'POL-123',
    insuranceExpiry: FUTURE,
    documents: [
      { documentType: 'drivers_license', status: 'approved' },
      { documentType: 'insurance', status: 'approved' },
      { documentType: 'registration', status: 'approved' },
    ],
    vehicles: [{ isActive: true }],
    ...overrides,
  };
}

describe('DriverActivationService.maybeActivate', () => {
  let service: DriverActivationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.driver.updateMany.mockResolvedValue({ count: 1 });
    service = new DriverActivationService();
  });

  it('throws NotFound when the driver does not exist', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue(null);
    await expect(service.maybeActivate('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('A1: does NOT approve when there is no active vehicle', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue(makeDriver({ vehicles: [] }));
    const res = await service.maybeActivate('driver-1');
    expect(res.outcome).toBe('blocked');
    expect((res as any).missing).toContain('no_active_vehicle');
    expect(mockPrisma.driver.updateMany).not.toHaveBeenCalled();
    expect(mockRedis.publish).not.toHaveBeenCalled();
  });

  it('A2: does NOT approve when a required document is unapproved', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue(
      makeDriver({
        documents: [
          { documentType: 'drivers_license', status: 'pending' },
          { documentType: 'insurance', status: 'approved' },
          { documentType: 'registration', status: 'approved' },
        ],
      }),
    );
    const res = await service.maybeActivate('driver-1');
    expect(res.outcome).toBe('blocked');
    expect((res as any).missing).toContain('document_not_approved:drivers_license');
    expect(mockRedis.publish).not.toHaveBeenCalled();
  });

  it('A3: does NOT approve when background check is not clear', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue(makeDriver({ backgroundCheckStatus: 'pending' }));
    const res = await service.maybeActivate('driver-1');
    expect(res.outcome).toBe('blocked');
    expect((res as any).missing).toContain('background_check:pending');
    expect(mockPrisma.driver.updateMany).not.toHaveBeenCalled();
  });

  it('A4: does NOT approve when insurance is expired', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue(
      makeDriver({ insuranceExpiry: new Date(Date.now() - 1000) }),
    );
    const res = await service.maybeActivate('driver-1');
    expect(res.outcome).toBe('blocked');
    expect((res as any).missing).toContain('insurance_expired');
  });

  it('A5: approves and publishes exactly once when all four gates are satisfied', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue(makeDriver());
    const res = await service.maybeActivate('driver-1', { notes: 'ok' });
    expect(res.outcome).toBe('activated');
    expect(mockPrisma.driver.updateMany).toHaveBeenCalledWith({
      where: { id: 'driver-1', status: { in: ['pending', 'under_review', 'action_required'] } },
      data: { status: 'approved', onboardingStep: 'complete' },
    });
    expect(mockRedis.publish).toHaveBeenCalledTimes(1);
    expect(mockRedis.publish).toHaveBeenCalledWith('driver:approved', expect.stringContaining('driver-1'));
  });

  it('A6: is a no-op when the driver is already approved (no write, no publish)', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue(makeDriver({ status: 'approved' }));
    const res = await service.maybeActivate('driver-1');
    expect(res.outcome).toBe('already_active');
    expect(mockPrisma.driver.updateMany).not.toHaveBeenCalled();
    expect(mockRedis.publish).not.toHaveBeenCalled();
  });

  it('A7: never approves a declined or suspended driver', async () => {
    for (const status of ['declined', 'suspended']) {
      jest.clearAllMocks();
      mockPrisma.driver.findUnique.mockResolvedValue(makeDriver({ status }));
      const res = await service.maybeActivate('driver-1');
      expect(res.outcome).toBe('blocked');
      expect(mockPrisma.driver.updateMany).not.toHaveBeenCalled();
      expect(mockRedis.publish).not.toHaveBeenCalled();
    }
  });

  it('A8: does not double-publish when a concurrent activation already won the race', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue(makeDriver());
    mockPrisma.driver.updateMany.mockResolvedValue({ count: 0 }); // someone else transitioned first
    const res = await service.maybeActivate('driver-1');
    expect(res.outcome).toBe('already_active');
    expect(mockRedis.publish).not.toHaveBeenCalled();
  });
});
