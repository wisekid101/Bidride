/**
 * Real-PostgreSQL integration tests for BidiRide durable payout allocation.
 * REQUIRES TEST_DATABASE_URL; skipped otherwise. Unit mocks cannot prove the
 * advisory-lock serialization or the partial-unique active-allocation index, so
 * these run against real inserts and real concurrency.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutAllocationService, CONSUMED_ALLOCATION_STATUSES, RESERVED_ALLOCATION_STATUSES } from './payout-allocation.service';

const dbUrl = process.env.TEST_DATABASE_URL;
const describeDb = dbUrl ? describe : describe.skip;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl ?? 'postgresql://localhost/none' } } });
const DRIVER_PHONE = '+19995558001';

describeDb('PayoutAllocationService — DB idempotency, concurrency & release', () => {
  let svc: PayoutAllocationService;
  let driverId: string;
  let keyN = 0;
  const key = () => `payout:${driverId}:req-${Date.now()}-${keyN++}`;

  // Seed an eligible driver-earning ledger credit, backdated past the 2h hold.
  const seedEarning = async (amount: number, ageHours = 3) => {
    const row = await prisma.financialLedger.create({
      data: {
        correlationId: `itest-alloc:${driverId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        entryType: 'driver_earning', accountType: 'driver', accountId: driverId,
        direction: 'credit', amount, currency: 'usd', sourceEvent: 'trip:completed',
        createdAt: new Date(Date.now() - ageHours * 3600 * 1000),
      },
    });
    return { id: row.id, amount };
  };

  // Seed a canonical DRIVER debit (payout/adjustment/reversal/chargeback).
  const seedDriverDebit = async (amount: number, entryType = 'adjustment') => {
    await prisma.financialLedger.create({
      data: {
        correlationId: `itest-alloc-debit:${driverId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        entryType, accountType: 'driver', accountId: driverId,
        direction: 'debit', amount, currency: 'usd', sourceEvent: 'itest:debit',
      },
    });
  };

  const cleanupResidue = async () => {
    const u = await prisma.user.findUnique({
      where: { phone: DRIVER_PHONE },
      include: { driver: { include: { wallet: true } } },
    });
    if (!u?.driver) { if (u) await prisma.user.delete({ where: { id: u.id } }); return; }
    const dId = u.driver.id;
    await prisma.payoutAllocationTransition.deleteMany({ where: { driverId: dId } });
    await prisma.payoutAllocation.deleteMany({ where: { driverId: dId } });
    await prisma.payoutRequest.deleteMany({ where: { driverId: dId } });
    await prisma.financialLedger.deleteMany({ where: { accountId: dId } });
    if (u.driver.wallet) {
      await prisma.walletTransaction.deleteMany({ where: { walletId: u.driver.wallet.id } });
      await prisma.driverWallet.delete({ where: { id: u.driver.wallet.id } });
    }
    await prisma.driver.delete({ where: { id: dId } });
    await prisma.user.delete({ where: { id: u.id } });
  };

  beforeAll(async () => {
    svc = new PayoutAllocationService(prisma as unknown as PrismaService);
    await cleanupResidue();
    const u = await prisma.user.create({
      data: {
        phone: DRIVER_PHONE, role: 'driver',
        driver: { create: { status: 'approved', legalFirstName: 'IT', legalLastName: 'Alloc', dateOfBirth: new Date('1990-01-01') } },
      },
      include: { driver: true },
    });
    driverId = u.driver!.id;
  });

  // Each test works on its own earnings; clear allocations/ledger between tests
  // but keep the driver.
  afterEach(async () => {
    await prisma.payoutAllocationTransition.deleteMany({ where: { driverId } });
    await prisma.payoutAllocation.deleteMany({ where: { driverId } });
    await prisma.payoutRequest.deleteMany({ where: { driverId } });
    await prisma.financialLedger.deleteMany({ where: { accountId: driverId } });
    const w = await prisma.driverWallet.findUnique({ where: { driverId } });
    if (w) { await prisma.walletTransaction.deleteMany({ where: { walletId: w.id } }); await prisma.driverWallet.delete({ where: { id: w.id } }); }
  });

  afterAll(async () => { await cleanupResidue(); await prisma.$disconnect(); });

  const base = () => ({ driverId, currency: 'usd', initiatorType: 'system', reason: 'itest' });

  it('allocates a single complete earning', async () => {
    const e = await seedEarning(16.5);
    const r = await svc.allocate({ ...base(), amount: 16.5, idempotencyKey: key() });
    expect(r!.status).toBe('ALLOCATED');
    expect(r!.allocations).toHaveLength(1);
    expect(r!.allocations[0].earningLedgerId).toBe(e.id);
  });

  it('allocates multiple complete earnings and records snapshots', async () => {
    await seedEarning(10); await seedEarning(20);
    const r = await svc.allocate({ ...base(), amount: 30, idempotencyKey: key() });
    expect(r!.allocations).toHaveLength(2);
    expect(Number(r!.sourceAvailableBalance)).toBeCloseTo(30, 2);
    expect(Number(r!.resultingAvailableBalance)).toBeCloseTo(0, 2);
  });

  it('selects oldest earnings first (deterministic)', async () => {
    const oldest = await seedEarning(10, 5);
    const middle = await seedEarning(7, 4);
    await seedEarning(99, 3); // newest, should NOT be picked
    const r = await svc.allocate({ ...base(), amount: 17, idempotencyKey: key() });
    const picked = r!.allocations.map((a) => a.earningLedgerId).sort();
    expect(picked).toEqual([oldest.id, middle.id].sort());
  });

  it('rejects an amount that would require splitting an earning', async () => {
    await seedEarning(10, 5); await seedEarning(20, 4);
    await expect(svc.allocate({ ...base(), amount: 25, idempotencyKey: key() }))
      .rejects.toThrow(BadRequestException); // 10, or 10+20=30 — 25 not formable
  });

  it('rejects when the requested amount exceeds available balance', async () => {
    await seedEarning(10);
    await expect(svc.allocate({ ...base(), amount: 50, idempotencyKey: key() }))
      .rejects.toThrow(BadRequestException);
  });

  it('excludes earnings still within the 2h hold', async () => {
    await seedEarning(10, 0.5); // 30 min old — held
    await expect(svc.allocate({ ...base(), amount: 10, idempotencyKey: key() }))
      .rejects.toThrow(BadRequestException); // available = 0
  });

  it('a duplicate idempotency key returns the existing request (no new allocations)', async () => {
    await seedEarning(10);
    const k = key();
    const r1 = await svc.allocate({ ...base(), amount: 10, idempotencyKey: k });
    const r2 = await svc.allocate({ ...base(), amount: 10, idempotencyKey: k });
    expect(r2!.id).toBe(r1!.id);
    expect(await prisma.payoutRequest.count({ where: { idempotencyKey: k } })).toBe(1);
    expect(await prisma.payoutAllocation.count({ where: { payoutRequestId: r1!.id } })).toBe(1);
  });

  it('a conflicting idempotency key throws ConflictException', async () => {
    await seedEarning(10, 5); await seedEarning(20, 4); // $10 is oldest -> forms the first $10 allocation
    const k = key();
    await svc.allocate({ ...base(), amount: 10, idempotencyKey: k });
    await expect(svc.allocate({ ...base(), amount: 20, idempotencyKey: k }))
      .rejects.toThrow(ConflictException);
  });

  it('concurrent identical requests create exactly one request', async () => {
    await seedEarning(10);
    const k = key();
    const results = await Promise.all([
      svc.allocate({ ...base(), amount: 10, idempotencyKey: k }),
      svc.allocate({ ...base(), amount: 10, idempotencyKey: k }),
      svc.allocate({ ...base(), amount: 10, idempotencyKey: k }),
    ]);
    const ids = new Set(results.map((r) => r!.id));
    expect(ids.size).toBe(1);
    expect(await prisma.payoutRequest.count({ where: { idempotencyKey: k } })).toBe(1);
    expect(await prisma.payoutAllocation.count({ where: { driverId } })).toBe(1);
  });

  it('concurrent competing full-balance requests allow exactly one success; balance never negative', async () => {
    await seedEarning(10); // only $10 available
    const settled = await Promise.allSettled([
      svc.allocate({ ...base(), amount: 10, idempotencyKey: key() }),
      svc.allocate({ ...base(), amount: 10, idempotencyKey: key() }),
    ]);
    const ok = settled.filter((s) => s.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    expect(await prisma.payoutAllocation.count({ where: { driverId, status: 'ALLOCATED' } })).toBe(1);
  });

  it('DB partial-unique blocks a second ACTIVE allocation of the same earning', async () => {
    const e = await seedEarning(10);
    const r = await svc.allocate({ ...base(), amount: 10, idempotencyKey: key() });
    // Attempt a raw second active allocation of the same earning — must be rejected by the DB.
    await expect(
      prisma.payoutAllocation.create({
        data: {
          payoutRequestId: r!.id, driverId, earningLedgerId: e.id, amount: 10, currency: 'usd',
          status: 'ALLOCATED', allocatedAt: new Date(),
        },
      }),
    ).rejects.toThrow(); // unique_violation on payout_allocations_active_earning_key
  });

  it('a rejected allocation leaves earnings fully available (rollback, no partial rows)', async () => {
    await seedEarning(10, 5); await seedEarning(20, 4);
    await expect(svc.allocate({ ...base(), amount: 25, idempotencyKey: key() })).rejects.toThrow();
    expect(await prisma.payoutAllocation.count({ where: { driverId } })).toBe(0);
    // now a formable amount succeeds
    const r = await svc.allocate({ ...base(), amount: 30, idempotencyKey: key() });
    expect(r!.allocations).toHaveLength(2);
  });

  it('allocation writes NO ledger debit and NO wallet transaction', async () => {
    await seedEarning(10);
    const debitsBefore = await prisma.financialLedger.count({ where: { accountId: driverId, direction: 'debit' } });
    await svc.allocate({ ...base(), amount: 10, idempotencyKey: key() });
    expect(await prisma.financialLedger.count({ where: { accountId: driverId, direction: 'debit' } })).toBe(debitsBefore);
    expect(await prisma.walletTransaction.count({ where: { driverId } })).toBe(0);
    // and no new driver_earning credit was created by allocation
    expect(await prisma.financialLedger.count({ where: { accountId: driverId, direction: 'credit', entryType: 'driver_earning' } })).toBe(1);
  });

  it('DriverWallet drift cannot create allocatable money (availability is ledger-derived)', async () => {
    // A wallet claiming $999 available, but NO eligible ledger earnings.
    await prisma.driverWallet.create({
      data: { driverId, pendingBalance: 0, availableBalance: 999, lifetimeEarnings: 999, lifetimePaid: 0 },
    });
    await expect(svc.allocate({ ...base(), amount: 100, idempotencyKey: key() }))
      .rejects.toThrow(BadRequestException); // canonical availability = 0
  });

  it('release returns all earnings to availability and is idempotent; transitions are append-only', async () => {
    const e = await seedEarning(10);
    const r = await svc.allocate({ ...base(), amount: 10, idempotencyKey: key() });
    // allocate transition exists (null -> ALLOCATED)
    expect(await prisma.payoutAllocationTransition.count({ where: { payoutRequestId: r!.id, toStatus: 'ALLOCATED', fromStatus: null } })).toBe(1);

    const rel1 = await svc.releasePayoutRequest({ payoutRequestId: r!.id, reason: 'itest release', initiatorType: 'system' });
    expect(rel1!.status).toBe('RELEASED');
    expect(await prisma.payoutAllocationTransition.count({ where: { payoutRequestId: r!.id, fromStatus: 'ALLOCATED', toStatus: 'RELEASED' } })).toBe(1);

    // duplicate release is idempotent — no additional transitions
    const rel2 = await svc.releasePayoutRequest({ payoutRequestId: r!.id, reason: 'again', initiatorType: 'system' });
    expect(rel2!.status).toBe('RELEASED');
    expect(await prisma.payoutAllocationTransition.count({ where: { payoutRequestId: r!.id } })).toBe(2); // 1 allocate + 1 release only

    // released earning is allocatable again
    const r2 = await svc.allocate({ ...base(), amount: 10, idempotencyKey: key() });
    expect(r2!.allocations[0].earningLedgerId).toBe(e.id);
  });

  it('concurrent release produces exactly one release transition per allocation', async () => {
    await seedEarning(10);
    const r = await svc.allocate({ ...base(), amount: 10, idempotencyKey: key() });
    await Promise.allSettled([
      svc.releasePayoutRequest({ payoutRequestId: r!.id, reason: 'a', initiatorType: 'system' }),
      svc.releasePayoutRequest({ payoutRequestId: r!.id, reason: 'b', initiatorType: 'system' }),
    ]);
    expect(await prisma.payoutAllocationTransition.count({ where: { payoutRequestId: r!.id, toStatus: 'RELEASED' } })).toBe(1);
    expect(await prisma.payoutRequest.findUnique({ where: { id: r!.id } }).then((x) => x!.status)).toBe('RELEASED');
  });

  it('availability: $100 credits, no debits/allocations -> $100', async () => {
    await seedEarning(100);
    expect(await svc.getAvailableBalance(driverId)).toBeCloseTo(100, 2);
  });

  it('availability: $100 credits minus a $30 canonical driver debit -> $70', async () => {
    await seedEarning(100);
    await seedDriverDebit(30, 'adjustment');
    expect(await svc.getAvailableBalance(driverId)).toBeCloseTo(70, 2);
  });

  it('availability: $100 credits minus a $30 ACTIVE reservation -> $70', async () => {
    await seedEarning(30, 5); await seedEarning(70, 4); // $30 is oldest -> selected by oldest-first
    await svc.allocate({ ...base(), amount: 30, idempotencyKey: key() });
    expect(await svc.getAvailableBalance(driverId)).toBeCloseTo(70, 2);
  });

  it('availability: $100 credits, $30 debit, $20 reservation -> $50', async () => {
    await seedEarning(20, 5); await seedEarning(80, 4); // $20 is oldest -> selected by oldest-first
    await seedDriverDebit(30, 'adjustment');
    await svc.allocate({ ...base(), amount: 20, idempotencyKey: key() });
    expect(await svc.getAvailableBalance(driverId)).toBeCloseTo(50, 2);
  });

  it('a debit blocks allocating funds already consumed by that debit', async () => {
    await seedEarning(100);
    await seedDriverDebit(100, 'payout'); // whole balance already paid/consumed
    await expect(svc.allocate({ ...base(), amount: 100, idempotencyKey: key() }))
      .rejects.toThrow(BadRequestException); // available = 0
    expect(await svc.getAvailableBalance(driverId)).toBeCloseTo(0, 2);
  });

  it('PAID allocation + canonical payout debit does NOT double-subtract (credits->alloc->PAID->debit = $0)', async () => {
    const e = await seedEarning(100);
    const r = await svc.allocate({ ...base(), amount: 100, idempotencyKey: key() });
    // simulate Commit-3 settlement: allocation -> PAID + a $100 canonical driver payout debit
    await prisma.payoutAllocation.updateMany({ where: { payoutRequestId: r!.id }, data: { status: 'PAID' } });
    await prisma.financialLedger.create({
      data: {
        correlationId: `payout:${r!.id}:driver_payout`, entryType: 'payout', accountType: 'driver',
        accountId: driverId, direction: 'debit', amount: 100, currency: 'usd', sourceEvent: 'payment:payout',
        payoutId: r!.id,
      },
    });
    // credits 100 - debits 100 - reserved(PAID excluded)=0 => exactly 0 (never -100, never 100)
    expect(await svc.getAvailableBalance(driverId)).toBe(0);
    // and the paid earning can never be re-allocated (still CONSUMED)
    void e;
    await expect(svc.allocate({ ...base(), amount: 100, idempotencyKey: key() }))
      .rejects.toThrow(BadRequestException);
  });

  it('a reversal/adjustment credit restores availability generically', async () => {
    await seedEarning(100);
    await seedDriverDebit(40, 'adjustment');
    expect(await svc.getAvailableBalance(driverId)).toBeCloseTo(60, 2);
    // a reversal modeled as a driver_earning-class credit (older than hold) adds back
    await prisma.financialLedger.create({
      data: {
        correlationId: `itest-alloc-rev:${driverId}:${Date.now()}`, entryType: 'driver_earning',
        accountType: 'driver', accountId: driverId, direction: 'credit', amount: 40, currency: 'usd',
        sourceEvent: 'itest:reversal', createdAt: new Date(Date.now() - 3 * 3600 * 1000),
      },
    });
    expect(await svc.getAvailableBalance(driverId)).toBeCloseTo(100, 2);
  });

  it('release restores reserved value to availability', async () => {
    await seedEarning(100);
    const r = await svc.allocate({ ...base(), amount: 100, idempotencyKey: key() });
    expect(await svc.getAvailableBalance(driverId)).toBeCloseTo(0, 2);
    await svc.releasePayoutRequest({ payoutRequestId: r!.id, reason: 'itest', initiatorType: 'system' });
    expect(await svc.getAvailableBalance(driverId)).toBeCloseTo(100, 2);
  });

  it('consumed set (selection/partial-index) includes PAID; reserved set (availability) excludes it', () => {
    expect(CONSUMED_ALLOCATION_STATUSES).toEqual(['ALLOCATED', 'SUBMISSION_PENDING', 'SUBMITTED', 'PAID']);
    expect(RESERVED_ALLOCATION_STATUSES).toEqual(['ALLOCATED', 'SUBMISSION_PENDING', 'SUBMITTED']);
  });
});
