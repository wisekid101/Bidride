import { grandfatherApprovedDrivers, GrandfatherPrisma } from './grandfather-zero-tolerance';

const POLICY = { version: 'zt-2026-07', contentHash: 'hash-xyz' };

function makePrisma(overrides: Partial<any> = {}): GrandfatherPrisma & any {
  return {
    driver: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    zeroToleranceAcceptance: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

describe('grandfatherApprovedDrivers (D2)', () => {
  it('only targets APPROVED drivers with no accepted version', async () => {
    const prisma = makePrisma();
    await grandfatherApprovedDrivers(prisma, POLICY);
    expect(prisma.driver.findMany).toHaveBeenCalledWith({
      where: { status: 'approved', zeroToleranceAcceptedVersion: null },
      select: { id: true },
    });
  });

  it('backfills an immutable grandfather row + denormalized cache for each driver', async () => {
    const prisma = makePrisma({
      driver: {
        findMany: jest.fn().mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    const result = await grandfatherApprovedDrivers(prisma, POLICY);

    expect(prisma.zeroToleranceAcceptance.create).toHaveBeenCalledTimes(2);
    expect(prisma.zeroToleranceAcceptance.create).toHaveBeenCalledWith({
      data: {
        driverId: 'd1',
        policyVersion: 'zt-2026-07',
        policyContentHash: 'hash-xyz',
        source: 'grandfather',
      },
    });
    expect(prisma.driver.update).toHaveBeenCalledWith({
      where: { id: 'd2' },
      data: { zeroToleranceAcceptedVersion: 'zt-2026-07' },
    });
    expect(result).toEqual({ scanned: 2, created: 2 });
  });

  it('is idempotent — never creates a duplicate acceptance if one already exists', async () => {
    const prisma = makePrisma({
      driver: {
        findMany: jest.fn().mockResolvedValue([{ id: 'd1' }]),
        update: jest.fn().mockResolvedValue({}),
      },
      zeroToleranceAcceptance: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing' }),
        create: jest.fn().mockResolvedValue({}),
      },
    });

    const result = await grandfatherApprovedDrivers(prisma, POLICY);

    expect(prisma.zeroToleranceAcceptance.create).not.toHaveBeenCalled();
    // Still reconciles the denormalized cache.
    expect(prisma.driver.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { zeroToleranceAcceptedVersion: 'zt-2026-07' },
    });
    expect(result).toEqual({ scanned: 1, created: 0 });
  });

  it('is a no-op when there are no approved drivers to grandfather', async () => {
    const prisma = makePrisma();
    const result = await grandfatherApprovedDrivers(prisma, POLICY);
    expect(prisma.zeroToleranceAcceptance.create).not.toHaveBeenCalled();
    expect(prisma.driver.update).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 0, created: 0 });
  });
});
