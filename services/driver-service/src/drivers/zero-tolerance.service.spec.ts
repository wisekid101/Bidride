jest.mock('@bidride/database', () => ({ PrismaClient: jest.fn().mockImplementation(() => mockPrisma) }));

const mockPrisma = {
  zeroTolerancePolicy: { findFirst: jest.fn() },
  zeroToleranceAcceptance: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
  driver: { findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
} as any;

import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { ZeroToleranceService } from './zero-tolerance.service';

const ACTIVE_POLICY = {
  version: 'zt-2026-01',
  contentHash: 'hash-abc',
  body: 'Zero Tolerance policy text',
  minAppVersion: '1.4.0',
  effectiveAt: new Date('2026-07-01'),
  isActive: true,
};

const USER_ID = 'user-1';
const DRIVER = { id: 'driver-1', userId: USER_ID };

describe('ZeroToleranceService', () => {
  let service: ZeroToleranceService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.driver.findUnique.mockResolvedValue(DRIVER);
    mockPrisma.driver.update.mockResolvedValue({});
    mockPrisma.zeroToleranceAcceptance.findUnique.mockResolvedValue(null);
    mockPrisma.zeroToleranceAcceptance.create.mockResolvedValue({});
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);
    service = new ZeroToleranceService();
  });

  describe('getCurrentPolicy', () => {
    it('returns the active policy fields (incl. minAppVersion for the force-update gate)', async () => {
      mockPrisma.zeroTolerancePolicy.findFirst.mockResolvedValue(ACTIVE_POLICY);
      const p = await service.getCurrentPolicy();
      expect(p).toEqual({
        version: 'zt-2026-01',
        contentHash: 'hash-abc',
        body: 'Zero Tolerance policy text',
        minAppVersion: '1.4.0',
        effectiveAt: ACTIVE_POLICY.effectiveAt,
      });
    });

    it('throws when no policy is published', async () => {
      mockPrisma.zeroTolerancePolicy.findFirst.mockResolvedValue(null);
      await expect(service.getCurrentPolicy()).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('accept', () => {
    beforeEach(() => {
      mockPrisma.zeroTolerancePolicy.findFirst.mockResolvedValue(ACTIVE_POLICY);
    });

    it('rejects when the policy is not acknowledged', async () => {
      await expect(
        service.accept(USER_ID, { policyVersion: 'zt-2026-01', acknowledged: false }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a stale policy version (client must accept the current version)', async () => {
      await expect(
        service.accept(USER_ID, { policyVersion: 'zt-OLD', acknowledged: true }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws when no policy is active', async () => {
      mockPrisma.zeroTolerancePolicy.findFirst.mockResolvedValue(null);
      await expect(
        service.accept(USER_ID, { policyVersion: 'zt-2026-01', acknowledged: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('records a first acceptance: immutable row + denormalized cache in one transaction', async () => {
      const res = await service.accept(
        USER_ID,
        { policyVersion: 'zt-2026-01', acknowledged: true },
        { appVersion: '1.5.0', ipAddress: '203.0.113.7' },
      );

      expect(mockPrisma.zeroToleranceAcceptance.create).toHaveBeenCalledWith({
        data: {
          driverId: 'driver-1',
          policyVersion: 'zt-2026-01',
          policyContentHash: 'hash-abc',
          source: 'mobile',
          appVersion: '1.5.0',
          ipAddress: '203.0.113.7',
        },
      });
      expect(mockPrisma.driver.update).toHaveBeenCalledWith({
        where: { id: 'driver-1' },
        data: { zeroToleranceAcceptedVersion: 'zt-2026-01' },
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ success: true, nextStep: 'complete', alreadyAccepted: false });
    });

    it('is idempotent when the driver already accepted this version (no second row)', async () => {
      mockPrisma.zeroToleranceAcceptance.findUnique.mockResolvedValue({ id: 'acc-1' });
      const res = await service.accept(USER_ID, { policyVersion: 'zt-2026-01', acknowledged: true });
      expect(mockPrisma.zeroToleranceAcceptance.create).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(res).toEqual({ success: true, nextStep: 'complete', alreadyAccepted: true });
    });

    it('treats a concurrent unique-constraint race (P2002) as idempotent success', async () => {
      mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });
      const res = await service.accept(USER_ID, { policyVersion: 'zt-2026-01', acknowledged: true });
      // Reconciles the denormalized cache after losing the race.
      expect(mockPrisma.driver.update).toHaveBeenCalledWith({
        where: { id: 'driver-1' },
        data: { zeroToleranceAcceptedVersion: 'zt-2026-01' },
      });
      expect(res).toEqual({ success: true, nextStep: 'complete', alreadyAccepted: true });
    });

    it('does not swallow non-unique DB errors', async () => {
      mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P1001', message: 'db down' });
      await expect(
        service.accept(USER_ID, { policyVersion: 'zt-2026-01', acknowledged: true }),
      ).rejects.toMatchObject({ code: 'P1001' });
    });

    it('throws when the driver does not exist', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue(null);
      await expect(
        service.accept(USER_ID, { policyVersion: 'zt-2026-01', acknowledged: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listAcceptances', () => {
    it('returns the immutable history newest-first without exposing internal ids', async () => {
      mockPrisma.zeroToleranceAcceptance.findMany.mockResolvedValue([
        { policyVersion: 'zt-2026-01', policyContentHash: 'h', source: 'mobile', appVersion: '1.5.0', acceptedAt: new Date() },
      ]);
      const rows = await service.listAcceptances('driver-1');
      expect(mockPrisma.zeroToleranceAcceptance.findMany).toHaveBeenCalledWith({
        where: { driverId: 'driver-1' },
        orderBy: { acceptedAt: 'desc' },
        select: {
          policyVersion: true,
          policyContentHash: true,
          source: true,
          appVersion: true,
          acceptedAt: true,
        },
      });
      expect(rows).toHaveLength(1);
    });
  });
});
