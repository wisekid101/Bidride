import { BadRequestException, ConflictException } from '@nestjs/common';
import { PayoutAllocationService } from './payout-allocation.service';

const makeService = (txImpl?: unknown) => {
  const prisma = { $transaction: jest.fn().mockImplementation((cb: any) => cb(txImpl)) } as any;
  return new PayoutAllocationService(prisma);
};

const baseInput = {
  driverId: 'driver-1', amount: 10, currency: 'usd',
  idempotencyKey: 'payout:driver-1:req-1', initiatorType: 'system', reason: 'test',
};

describe('PayoutAllocationService — input validation (rejected before any DB work)', () => {
  it('rejects zero amount', async () => {
    await expect(makeService().allocate({ ...baseInput, amount: 0 })).rejects.toThrow(BadRequestException);
  });
  it('rejects negative amount', async () => {
    await expect(makeService().allocate({ ...baseInput, amount: -5 })).rejects.toThrow(BadRequestException);
  });
  it('rejects a sub-cent (malformed) amount — whole cents only', async () => {
    await expect(makeService().allocate({ ...baseInput, amount: 10.005 })).rejects.toThrow(BadRequestException);
  });
  it('rejects a non-finite amount', async () => {
    await expect(makeService().allocate({ ...baseInput, amount: Number.NaN })).rejects.toThrow(BadRequestException);
  });
  it('rejects an unsupported currency', async () => {
    await expect(makeService().allocate({ ...baseInput, currency: 'eur' })).rejects.toThrow(BadRequestException);
  });
});

describe('PayoutAllocationService — idempotency (mocked transaction)', () => {
  const existing = {
    id: 'req-1', driverId: 'driver-1', amount: 10, currency: 'usd', status: 'ALLOCATED',
    allocations: [{ id: 'a1' }],
  };
  const txWith = (found: unknown) => ({
    $executeRaw: jest.fn().mockResolvedValue(1),
    payoutRequest: { findUnique: jest.fn().mockResolvedValue(found) },
  });

  it('a duplicate idempotency key with identical params returns the existing request', async () => {
    const r = await makeService(txWith(existing)).allocate(baseInput);
    expect(r).toBe(existing);
  });
  it('a reused idempotency key with a conflicting amount throws ConflictException', async () => {
    await expect(makeService(txWith({ ...existing, amount: 999 })).allocate(baseInput))
      .rejects.toThrow(ConflictException);
  });
  it('a reused idempotency key with a conflicting driver throws ConflictException', async () => {
    await expect(makeService(txWith({ ...existing, driverId: 'other' })).allocate(baseInput))
      .rejects.toThrow(ConflictException);
  });
});

describe('PayoutAllocationService — surface is internal-only', () => {
  it('exposes no execution / Stripe / transfer method', () => {
    const methods = Object.getOwnPropertyNames(PayoutAllocationService.prototype).filter((m) => m !== 'constructor');
    // allowed: allocate, release, and read-only balance helpers only
    expect(methods).toEqual(expect.arrayContaining(['allocate', 'releasePayoutRequest', 'getAvailableBalance']));
    expect(methods.some((m) => /transfer|stripe|submit|payout.*create|execute|pay\b/i.test(m))).toBe(false);
  });
});
