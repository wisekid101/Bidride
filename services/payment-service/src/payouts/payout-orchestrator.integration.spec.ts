/**
 * Real-PostgreSQL integration tests for the instant-payout orchestrator.
 * Stripe is MOCKED; financial state, uniqueness, concurrency and transactions
 * are real. REQUIRES TEST_DATABASE_URL.
 *
 * These prove the properties mocks cannot: that the partial unique index
 * `payout_allocations_active_earning_key` and the per-driver advisory lock make
 * double-payment impossible — including across days, which is the exact defect
 * the legacy lifetime-Trip-sum path exhibited.
 *
 * NOTE ON THE FLAG: PAYOUTS_ENABLED is supplied here as an in-memory test
 * config object so submission can be exercised. No environment, .env, or
 * deployment configuration is read or modified by these tests.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PayoutAllocationService } from './payout-allocation.service';
import { PayoutSubmissionService, StripeTransfersLike, StripeTransfer } from './payout-submission.service';
import { PayoutOrchestratorService } from './payout-orchestrator.service';

const dbUrl = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const DRIVER_PHONE = '+19995559001';
const STRIPE_ACCT = 'acct_bidiride_orch';

describe('PayoutOrchestratorService — durable payout, concurrency & cross-day protection', () => {
  let alloc: PayoutAllocationService;
  let ledger: LedgerService;
  let driverId: string;

  const cfg = (flag = 'true') => ({ get: jest.fn().mockReturnValue(flag) }) as never;

  const stripeOk = (): StripeTransfersLike => ({
    transfers: {
      create: jest.fn().mockImplementation((p: { amount: number; transfer_group: string }) =>
        Promise.resolve({
          id: `tr_${Math.random().toString(36).slice(2, 10)}`, object: 'transfer',
          amount: p.amount, currency: 'usd', destination: STRIPE_ACCT,
          transfer_group: p.transfer_group, reversed: false, amount_reversed: 0,
          livemode: false, metadata: {}, lastResponse: { requestId: 'req_x' },
        } as StripeTransfer)),
      list: jest.fn().mockResolvedValue({ data: [], has_more: false }),
    },
  }) as never;

  const stripeThrows = (): StripeTransfersLike => ({
    transfers: {
      create: jest.fn().mockRejectedValue(Object.assign(new Error('card_declined'), { type: 'StripeInvalidRequestError' })),
      list: jest.fn().mockResolvedValue({ data: [], has_more: false }),
    },
  }) as never;

  const orchestrator = (stripe: StripeTransfersLike, flag = 'true') =>
    new PayoutOrchestratorService(
      prisma as unknown as PrismaService,
      alloc,
      new PayoutSubmissionService(prisma as unknown as PrismaService, ledger, stripe, cfg(flag)),
    );

  const seedEarning = async (amount: number, ageHours = 3) => {
    const row = await prisma.financialLedger.create({
      data: {
        correlationId: `itest-orch:${driverId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        entryType: 'driver_earning', accountType: 'driver', accountId: driverId,
        direction: 'credit', amount, currency: 'usd', sourceEvent: 'trip:completed',
        createdAt: new Date(Date.now() - ageHours * 3600 * 1000),
      },
    });
    return row.id;
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
    // submission attempts FK-reference payout_requests — clear them first
    const reqIds = (await prisma.payoutRequest.findMany({ where: { driverId: dId }, select: { id: true } })).map((r) => r.id);
    if (reqIds.length) await prisma.payoutSubmissionAttempt.deleteMany({ where: { payoutRequestId: { in: reqIds } } });
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
    alloc = new PayoutAllocationService(prisma as unknown as PrismaService);
    ledger = new LedgerService(prisma as unknown as PrismaService);
    await cleanupResidue();
    const u = await prisma.user.create({
      data: {
        phone: DRIVER_PHONE, role: 'driver',
        driver: {
          create: {
            status: 'approved', legalFirstName: 'IT', legalLastName: 'Orch',
            dateOfBirth: new Date('1990-01-01'), stripeAccountId: STRIPE_ACCT,
            payoutBankVerified: true,
          },
        },
      },
      include: { driver: true },
    });
    driverId = u.driver!.id;
  });

  afterEach(async () => {
    await prisma.payoutAllocationTransition.deleteMany({ where: { driverId } });
    await prisma.payoutAllocation.deleteMany({ where: { driverId } });
    const rIds = (await prisma.payoutRequest.findMany({ where: { driverId }, select: { id: true } })).map((r) => r.id);
    if (rIds.length) await prisma.payoutSubmissionAttempt.deleteMany({ where: { payoutRequestId: { in: rIds } } });
    await prisma.payoutRequest.deleteMany({ where: { driverId } });
    await prisma.financialLedger.deleteMany({ where: { accountId: driverId } });
    const w = await prisma.driverWallet.findUnique({ where: { driverId } });
    if (w) {
      await prisma.walletTransaction.deleteMany({ where: { walletId: w.id } });
      await prisma.driverWallet.delete({ where: { id: w.id } });
    }
  });

  afterAll(async () => { await cleanupResidue(); await prisma.$disconnect(); });

  it('allocates the exact eligible earnings and records them on the PayoutRequest', async () => {
    const e1 = await seedEarning(20);
    const e2 = await seedEarning(15);
    await seedEarning(9, 0.5); // inside the 2h hold — must NOT be selected

    const res = await orchestrator(stripeOk()).requestInstantPayout(driverId);

    expect(res.paid).toBe(true);
    expect(res.status).toBe('PAID');
    expect(res.amount).toBe(35);

    const req = await prisma.payoutRequest.findUnique({
      where: { id: res.payoutRequestId }, include: { allocations: true },
    });
    expect(Number(req!.amount)).toBe(35);
    const allocated = req!.allocations.map((a) => a.earningLedgerId).sort();
    expect(allocated).toEqual([e1, e2].sort());
  });

  it('derives the payable amount from the ledger, never from Trip rows', async () => {
    await seedEarning(25);
    // No Trip rows exist for this driver at all; a lifetime-Trip-sum
    // implementation would compute 0 and could not pay.
    const trips = await prisma.trip.count({ where: { driverId } });
    expect(trips).toBe(0);
    const res = await orchestrator(stripeOk()).requestInstantPayout(driverId);
    expect(res.amount).toBe(25);
    expect(res.paid).toBe(true);
  });

  it('two concurrent payout attempts cannot allocate the same earning', async () => {
    const e1 = await seedEarning(30);
    const orch = orchestrator(stripeOk());

    const [a, b] = await Promise.allSettled([
      orch.requestInstantPayout(driverId),
      orch.requestInstantPayout(driverId),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1); // exactly one attempt may claim the earning

    const active = await prisma.payoutAllocation.findMany({
      where: { earningLedgerId: e1, status: { in: ['ALLOCATED', 'SUBMISSION_PENDING', 'SUBMITTED', 'PAID'] } },
    });
    expect(active).toHaveLength(1); // the DB invariant, not application logic
  });

  it('a payout on a LATER DAY cannot re-pay earnings already consumed', async () => {
    const e1 = await seedEarning(40);
    const orch = orchestrator(stripeOk());

    const first = await orch.requestInstantPayout(driverId);
    expect(first.paid).toBe(true);

    // Backdate the settled request so the daily cap cannot be what blocks the
    // second attempt — this proves the ALLOCATION invariant is the protection.
    await prisma.payoutRequest.update({
      where: { id: first.payoutRequestId },
      data: { createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) },
    });

    await expect(orch.requestInstantPayout(driverId)).rejects.toThrow(BadRequestException);

    const active = await prisma.payoutAllocation.findMany({
      where: { earningLedgerId: e1, status: { in: ['ALLOCATED', 'SUBMISSION_PENDING', 'SUBMITTED', 'PAID'] } },
    });
    expect(active).toHaveLength(1); // still exactly one — never paid twice
    const requests = await prisma.payoutRequest.count({ where: { driverId, status: 'PAID' } });
    expect(requests).toBe(1);
  });

  it('a Stripe failure becomes a durable non-PAID state with attempt evidence, never a false success', async () => {
    // The submission service deliberately does NOT throw on a provider refusal:
    // it records the attempt and finalises a recoverable state. The orchestrator
    // must therefore report paid=false rather than treating "no exception" as
    // success, and must NOT release — releasing would destroy the evidence the
    // resume/reconcile paths depend on.
    const e1 = await seedEarning(50);
    const res = await orchestrator(stripeThrows()).requestInstantPayout(driverId);

    expect(res.paid).toBe(false);
    expect(res.status).not.toBe('PAID');

    const attempts = await prisma.payoutSubmissionAttempt.count({
      where: { payoutRequestId: res.payoutRequestId },
    });
    expect(attempts).toBeGreaterThan(0);

    const allocs = await prisma.payoutAllocation.findMany({ where: { earningLedgerId: e1 } });
    expect(allocs).toHaveLength(1);
    expect(await prisma.payoutRequest.count({ where: { driverId, status: 'PAID' } })).toBe(0);
  });

  it('with payouts disabled the request is rejected and the allocation is released with a reason', async () => {
    const e1 = await seedEarning(60);
    const orch = orchestrator(stripeOk(), 'false');

    await expect(orch.requestInstantPayout(driverId)).rejects.toThrow();

    // No money moved, and the earning is payable again once payouts are enabled.
    expect(await prisma.payoutRequest.count({ where: { driverId, status: 'PAID' } })).toBe(0);
    const allocs = await prisma.payoutAllocation.findMany({ where: { earningLedgerId: e1 } });
    expect(allocs).toHaveLength(1);
    expect(allocs[0].releaseReason ?? '').toContain('submission_failed');
    expect(allocs[0].releasedAt).toBeTruthy();
    expect(await alloc.getAvailableBalance(driverId, 'usd')).toBe(60);
  });
});
