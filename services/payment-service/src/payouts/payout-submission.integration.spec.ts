/**
 * Real-PostgreSQL integration tests for Bidiride retry-safe payout submission
 * and exactly-once settlement (Commit 3). Stripe is MOCKED; financial state,
 * uniqueness, concurrency and transactions are real. REQUIRES TEST_DATABASE_URL.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PayoutAllocationService } from './payout-allocation.service';
import { PayoutSubmissionService, StripeTransfersLike, StripeTransfer } from './payout-submission.service';

const dbUrl = process.env.TEST_DATABASE_URL;
const describeDb = dbUrl ? describe : describe.skip;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl ?? 'postgresql://localhost/none' } } });
const DRIVER_PHONE = '+19995557001';
const STRIPE_ACCT = 'acct_bidiride_it';

describeDb('PayoutSubmissionService — submission, settlement, failure & reconciliation', () => {
  let alloc: PayoutAllocationService;
  let ledger: LedgerService;
  let driverId: string;
  let keyN = 0;
  const idemKey = () => `payout:${driverId}:sub-${Date.now()}-${keyN++}`;

  const cfg = (flag: string | string[]) => {
    const vals = Array.isArray(flag) ? [...flag] : null;
    return { get: vals ? jest.fn().mockImplementation(() => vals.shift() ?? 'false') : jest.fn().mockReturnValue(flag) } as any;
  };
  // Stripe mock: create + list configurable per test.
  const stripeMock = (): StripeTransfersLike & { transfers: { create: jest.Mock; list: jest.Mock } } => ({
    transfers: { create: jest.fn(), list: jest.fn().mockResolvedValue({ data: [], has_more: false }) },
  }) as any;
  const okTransfer = (req: { id: string }, over: Partial<StripeTransfer> = {}): StripeTransfer => ({
    id: `tr_${req.id.slice(0, 8)}`, object: 'transfer', amount: 0, currency: 'usd',
    destination: STRIPE_ACCT, transfer_group: `bidiride:payout:${req.id}`,
    reversed: false, amount_reversed: 0, livemode: false,
    metadata: { payout_request_id: req.id, driver_id: driverId }, lastResponse: { requestId: 'req_x' }, ...over,
  });
  const svc = (stripe: StripeTransfersLike, flag: string | string[] = 'true') =>
    new PayoutSubmissionService(prisma as unknown as PrismaService, ledger, stripe, cfg(flag));

  const seedEarning = async (amount: number, ageHours = 3) => {
    await prisma.financialLedger.create({
      data: {
        correlationId: `itest-sub:${driverId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        entryType: 'driver_earning', accountType: 'driver', accountId: driverId, direction: 'credit',
        amount, currency: 'usd', sourceEvent: 'trip:completed', createdAt: new Date(Date.now() - ageHours * 3600 * 1000),
      },
    });
  };
  const makeAllocated = async (amount: number) => {
    await seedEarning(amount);
    return alloc.allocate({ driverId, amount, currency: 'usd', idempotencyKey: idemKey(), initiatorType: 'system', reason: 'itest' });
  };
  const ledgerDebits = (id: string) => prisma.financialLedger.count({ where: { correlationId: `payout:${id}:ledger`, direction: 'debit' } });

  const cleanup = async () => {
    const u = await prisma.user.findUnique({ where: { phone: DRIVER_PHONE }, include: { driver: true } });
    if (!u?.driver) { if (u) await prisma.user.delete({ where: { id: u.id } }); return; }
    const d = u.driver.id;
    await prisma.payoutSubmissionAttempt.deleteMany({ where: { request: { driverId: d } } });
    await prisma.payoutAllocationTransition.deleteMany({ where: { driverId: d } });
    await prisma.payoutAllocation.deleteMany({ where: { driverId: d } });
    await prisma.payoutRequest.deleteMany({ where: { driverId: d } });
    await prisma.financialLedger.deleteMany({ where: { accountId: d } });
    await prisma.financialLedger.deleteMany({ where: { payoutId: { not: null }, accountType: 'platform', correlationId: { contains: d } } });
    await prisma.driver.delete({ where: { id: d } });
    await prisma.user.delete({ where: { id: u.id } });
  };

  beforeAll(async () => {
    const ps = prisma as unknown as PrismaService;
    ledger = new LedgerService(ps);
    alloc = new PayoutAllocationService(ps);
    await cleanup();
    const u = await prisma.user.create({
      data: { phone: DRIVER_PHONE, role: 'driver', driver: { create: { status: 'approved', legalFirstName: 'IT', legalLastName: 'Sub', dateOfBirth: new Date('1990-01-01'), stripeAccountId: STRIPE_ACCT } } },
      include: { driver: true },
    });
    driverId = u.driver!.id;
  });
  afterEach(async () => {
    await prisma.payoutSubmissionAttempt.deleteMany({ where: { request: { driverId } } });
    await prisma.payoutAllocationTransition.deleteMany({ where: { driverId } });
    await prisma.payoutAllocation.deleteMany({ where: { driverId } });
    await prisma.payoutRequest.deleteMany({ where: { driverId } });
    await prisma.financialLedger.deleteMany({ where: { accountId: driverId } });
    await prisma.financialLedger.deleteMany({ where: { entryType: 'payout', accountType: 'platform' } });
  });
  afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

  it('flag OFF: no claim, no Stripe, request stays ALLOCATED', async () => {
    const r = await makeAllocated(50);
    const s = stripeMock();
    await expect(svc(s, 'false').submitPayoutRequest(r!.id)).rejects.toThrow(ServiceUnavailableException);
    expect(s.transfers.create).not.toHaveBeenCalled();
    expect((await prisma.payoutRequest.findUnique({ where: { id: r!.id } }))!.status).toBe('ALLOCATED');
    expect(await prisma.payoutSubmissionAttempt.count({ where: { payoutRequestId: r!.id } })).toBe(0);
  });

  // Helper: drive a request into SUBMISSION_BLOCKED via a flag flip after TX1.
  const blockIt = async (amount: number) => {
    const r = await makeAllocated(amount);
    const s = stripeMock();
    await svc(s, ['true', 'false']).submitPayoutRequest(r!.id); // true before TX1, false before Stripe
    expect(s.transfers.create).not.toHaveBeenCalled();
    return r!;
  };

  it('flag flips false AFTER TX1: SUBMISSION_BLOCKED (NOT reconciliation); reserved; no debit; blocked attempt has no provider ids', async () => {
    const r = await blockIt(50);
    const req = await prisma.payoutRequest.findUnique({ where: { id: r.id }, include: { allocations: true } });
    expect(req!.status).toBe('SUBMISSION_BLOCKED');
    expect(req!.status).not.toBe('RECONCILIATION_REQUIRED');
    expect(req!.allocations.every((a) => a.status === 'SUBMISSION_PENDING')).toBe(true); // reserved
    expect(req!.stripeTransferId).toBeNull();
    expect(await ledgerDebits(r.id)).toBe(0);
    expect(await alloc.getAvailableBalance(driverId)).toBeCloseTo(0, 2); // still reserved, not reusable
    const att = await prisma.payoutSubmissionAttempt.findFirst({ where: { payoutRequestId: r.id }, orderBy: { attemptNumber: 'desc' } });
    expect(att!.status).toBe('BLOCKED_BY_FEATURE_FLAG');
    expect(att!.providerRequestId).toBeNull();
    expect(att!.stripeTransferId).toBeNull();
  });

  it('reconcile REJECTS a SUBMISSION_BLOCKED request: no list/retrieve/create, no state change', async () => {
    const r = await blockIt(50);
    const s = stripeMock();
    const res = await svc(s).reconcilePayoutRequest(r.id);
    expect(res).toEqual({ result: 'not_reconcilable', status: 'SUBMISSION_BLOCKED' });
    expect(s.transfers.list).not.toHaveBeenCalled();
    expect(s.transfers.create).not.toHaveBeenCalled();
    expect((await prisma.payoutRequest.findUnique({ where: { id: r.id } }))!.status).toBe('SUBMISSION_BLOCKED');
  });

  it('resume while flag FALSE is rejected: no state change, no new attempt, no Stripe', async () => {
    const r = await blockIt(50);
    const before = await prisma.payoutSubmissionAttempt.count({ where: { payoutRequestId: r.id } });
    const s = stripeMock();
    await expect(svc(s, 'false').resumeBlockedPayoutRequest(r.id)).rejects.toThrow(ServiceUnavailableException);
    expect(s.transfers.create).not.toHaveBeenCalled();
    expect((await prisma.payoutRequest.findUnique({ where: { id: r.id } }))!.status).toBe('SUBMISSION_BLOCKED');
    expect(await prisma.payoutSubmissionAttempt.count({ where: { payoutRequestId: r.id } })).toBe(before);
  });

  it('successful resume reuses the SNAPSHOT (not a changed driver account), same key+group; PAID; one journal', async () => {
    const r = await blockIt(60);
    // the driver changes their Stripe account after being blocked; resume must ignore it
    await prisma.driver.update({ where: { id: driverId }, data: { stripeAccountId: 'acct_CHANGED' } });
    const s = stripeMock();
    s.transfers.create.mockImplementation(async () => okTransfer(r, { amount: 6000 }));
    const out = await svc(s).resumeBlockedPayoutRequest(r.id);
    expect(out!.status).toBe('PAID');
    expect(out!.allocations.every((a: any) => a.status === 'PAID')).toBe(true);
    expect(s.transfers.create).toHaveBeenCalledTimes(1);
    expect(s.transfers.create.mock.calls[0][0].destination).toBe(STRIPE_ACCT); // snapshot, NOT acct_CHANGED
    expect(s.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: `payout:${r.id}:transfer` });
    expect(s.transfers.create.mock.calls[0][0].transfer_group).toBe(`bidiride:payout:${r.id}`);
    expect(await ledgerDebits(r.id)).toBe(1);
    // restore for other tests
    await prisma.driver.update({ where: { id: driverId }, data: { stripeAccountId: STRIPE_ACCT } });
  });

  it('retryable failure after resume: SUBMISSION_PENDING, reserved, no release, no debit', async () => {
    const r = await blockIt(25);
    const s = stripeMock();
    s.transfers.create.mockRejectedValue({ type: 'StripeRateLimitError', statusCode: 429, message: 'rate' });
    await svc(s).resumeBlockedPayoutRequest(r.id);
    const req = await prisma.payoutRequest.findUnique({ where: { id: r.id }, include: { allocations: true } });
    expect(req!.status).toBe('SUBMISSION_PENDING');
    expect(req!.allocations.every((a) => a.status === 'SUBMISSION_PENDING')).toBe(true);
    expect(await ledgerDebits(r.id)).toBe(0);
  });

  it('ambiguous failure after resume: RECONCILIATION_REQUIRED, allocations reserved, no debit', async () => {
    const r = await blockIt(25);
    const s = stripeMock();
    s.transfers.create.mockRejectedValue({ type: 'StripeConnectionError', message: 'ETIMEDOUT' });
    await svc(s).resumeBlockedPayoutRequest(r.id);
    const req = await prisma.payoutRequest.findUnique({ where: { id: r.id }, include: { allocations: true } });
    expect(req!.status).toBe('RECONCILIATION_REQUIRED');
    expect(req!.allocations.every((a) => a.status === 'SUBMISSION_PENDING')).toBe(true);
    expect(await ledgerDebits(r.id)).toBe(0);
  });

  it('concurrent resumes: one flip claim, one Stripe create, one PAID, one ledger journal', async () => {
    const r = await blockIt(40);
    const s = stripeMock();
    s.transfers.create.mockImplementation(async () => okTransfer(r, { amount: 4000 }));
    const shared = svc(s);
    await Promise.allSettled([shared.resumeBlockedPayoutRequest(r.id), shared.resumeBlockedPayoutRequest(r.id)]);
    expect(s.transfers.create).toHaveBeenCalledTimes(1);
    expect(await ledgerDebits(r.id)).toBe(1);
    expect((await prisma.payoutRequest.findUnique({ where: { id: r.id } }))!.status).toBe('PAID');
  });

  it('release cannot act on a blocked/pending request (no released-and-paid split); resume settles', async () => {
    const r = await blockIt(30);
    // Commit-2 release only accepts ALLOCATED -> blocked request is rejected
    await expect(alloc.releasePayoutRequest({ payoutRequestId: r.id, reason: 'x', initiatorType: 'system' })).rejects.toThrow();
    const s = stripeMock();
    s.transfers.create.mockImplementation(async () => okTransfer(r, { amount: 3000 }));
    const out = await svc(s).resumeBlockedPayoutRequest(r.id);
    expect(out!.status).toBe('PAID');
    expect(await ledgerDebits(r.id)).toBe(1);
  });

  it('success: one Stripe call (deterministic key+group), PAID, one ledger journal, availability = 0', async () => {
    const r = await makeAllocated(60);
    const s = stripeMock();
    s.transfers.create.mockImplementation(async (_p, _o) => okTransfer(r!, { amount: 6000 }));
    const out = await svc(s).submitPayoutRequest(r!.id);
    expect(out!.status).toBe('PAID');
    expect(out!.allocations.every((a: any) => a.status === 'PAID')).toBe(true);
    expect(s.transfers.create).toHaveBeenCalledTimes(1);
    expect(s.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: `payout:${r!.id}:transfer` });
    expect(s.transfers.create.mock.calls[0][0].transfer_group).toBe(`bidiride:payout:${r!.id}`);
    expect(s.transfers.create.mock.calls[0][0].metadata).toEqual({ payout_request_id: r!.id, driver_id: driverId });
    expect(await ledgerDebits(r!.id)).toBe(1);
    expect(await alloc.getAvailableBalance(driverId)).toBeCloseTo(0, 2); // credit 60 - debit 60 - reserved(PAID excluded) 0
  });

  it('idempotent re-submit after PAID: no second Stripe transfer, no second debit', async () => {
    const r = await makeAllocated(30);
    const s = stripeMock();
    s.transfers.create.mockImplementation(async () => okTransfer(r!, { amount: 3000 }));
    await svc(s).submitPayoutRequest(r!.id);
    const again = await svc(s).submitPayoutRequest(r!.id); // status PAID -> alreadyClaimed
    expect(again!.status).toBe('PAID');
    expect(s.transfers.create).toHaveBeenCalledTimes(1);
    expect(await ledgerDebits(r!.id)).toBe(1);
  });

  it('concurrent submitters: one claim, one Stripe call, one ledger journal', async () => {
    const r = await makeAllocated(40);
    const s = stripeMock();
    s.transfers.create.mockImplementation(async () => okTransfer(r!, { amount: 4000 }));
    const svcShared = svc(s);
    await Promise.allSettled([svcShared.submitPayoutRequest(r!.id), svcShared.submitPayoutRequest(r!.id)]);
    expect(s.transfers.create).toHaveBeenCalledTimes(1);
    expect(await ledgerDebits(r!.id)).toBe(1);
    expect((await prisma.payoutRequest.findUnique({ where: { id: r!.id } }))!.status).toBe('PAID');
  });

  it('definitive pre-transfer failure: RELEASED atomically, no debit, earnings available again', async () => {
    const r = await makeAllocated(25);
    const s = stripeMock();
    s.transfers.create.mockRejectedValue({ type: 'StripeInvalidRequestError', code: 'account_invalid', message: 'No such destination' });
    await svc(s).submitPayoutRequest(r!.id);
    const req = await prisma.payoutRequest.findUnique({ where: { id: r!.id }, include: { allocations: true } });
    expect(req!.status).toBe('RELEASED');
    expect(req!.allocations.every((a) => a.status === 'RELEASED')).toBe(true);
    expect(await ledgerDebits(r!.id)).toBe(0);
    expect(await prisma.payoutSubmissionAttempt.count({ where: { payoutRequestId: r!.id, status: 'DEFINITIVE_FAILURE' } })).toBe(1);
    expect(await alloc.getAvailableBalance(driverId)).toBeCloseTo(25, 2); // returned to availability
  });

  it('retryable failure: stays SUBMISSION_PENDING, reserved, no release, no debit', async () => {
    const r = await makeAllocated(25);
    const s = stripeMock();
    s.transfers.create.mockRejectedValue({ type: 'StripeRateLimitError', statusCode: 429, message: 'rate limited' });
    await svc(s).submitPayoutRequest(r!.id);
    const req = await prisma.payoutRequest.findUnique({ where: { id: r!.id }, include: { allocations: true } });
    expect(req!.status).toBe('SUBMISSION_PENDING');
    expect(req!.allocations.every((a) => a.status === 'SUBMISSION_PENDING')).toBe(true);
    expect(await ledgerDebits(r!.id)).toBe(0);
    expect(await alloc.getAvailableBalance(driverId)).toBeCloseTo(0, 2); // still reserved
  });

  it('ambiguous timeout: RECONCILIATION_REQUIRED, allocations reserved, no debit, no release', async () => {
    const r = await makeAllocated(25);
    const s = stripeMock();
    s.transfers.create.mockRejectedValue({ type: 'StripeConnectionError', message: 'ETIMEDOUT socket hang up' });
    await svc(s).submitPayoutRequest(r!.id);
    const req = await prisma.payoutRequest.findUnique({ where: { id: r!.id }, include: { allocations: true } });
    expect(req!.status).toBe('RECONCILIATION_REQUIRED');
    expect(req!.allocations.every((a) => a.status === 'SUBMISSION_PENDING')).toBe(true);
    expect(await ledgerDebits(r!.id)).toBe(0);
  });

  it('config/auth failure: RECONCILIATION_REQUIRED, no release, redacted error stored', async () => {
    const r = await makeAllocated(25);
    const s = stripeMock();
    s.transfers.create.mockRejectedValue({ type: 'StripeAuthenticationError', message: 'Invalid API Key '.repeat(60) });
    await svc(s).submitPayoutRequest(r!.id);
    const req = await prisma.payoutRequest.findUnique({ where: { id: r!.id } });
    expect(req!.status).toBe('RECONCILIATION_REQUIRED');
    expect((req!.lastErrorMessage ?? '').length).toBeLessThanOrEqual(500);
    expect(await ledgerDebits(r!.id)).toBe(0);
  });

  it('reconcile finds exactly one transfer (crash-after-Stripe recovery): settles PAID exactly once via list', async () => {
    const r = await makeAllocated(35);
    // ambiguous first (request -> RECONCILIATION_REQUIRED), but the transfer actually exists
    const s1 = stripeMock();
    s1.transfers.create.mockRejectedValue({ type: 'StripeConnectionError', message: 'timeout' });
    await svc(s1).submitPayoutRequest(r!.id);
    // reconcile: list returns the real transfer by group+destination
    const s2 = stripeMock();
    s2.transfers.list.mockResolvedValue({ data: [okTransfer(r!, { amount: 3500 })], has_more: false });
    const res = await svc(s2).reconcilePayoutRequest(r!.id);
    expect(s2.transfers.create).not.toHaveBeenCalled(); // never blindly creates
    expect(s2.transfers.list).toHaveBeenCalled();
    expect((res as any)!.status).toBe('PAID');
    expect(await ledgerDebits(r!.id)).toBe(1);
    expect(await alloc.getAvailableBalance(driverId)).toBeCloseTo(0, 2);
  });

  it('reconcile: no matching transfer -> unsettled, no release, no create', async () => {
    const r = await makeAllocated(35);
    const s1 = stripeMock(); s1.transfers.create.mockRejectedValue({ type: 'StripeConnectionError', message: 'timeout' });
    await svc(s1).submitPayoutRequest(r!.id);
    const s2 = stripeMock(); // list default = empty
    const res = await svc(s2).reconcilePayoutRequest(r!.id);
    expect(res).toEqual({ result: 'no_match' });
    expect(s2.transfers.create).not.toHaveBeenCalled();
    expect((await prisma.payoutRequest.findUnique({ where: { id: r!.id } }))!.status).toBe('RECONCILIATION_REQUIRED');
    expect(await ledgerDebits(r!.id)).toBe(0);
  });

  it('reconcile: multiple matching transfers -> integrity conflict, stays RECONCILIATION_REQUIRED', async () => {
    const r = await makeAllocated(35);
    const s1 = stripeMock(); s1.transfers.create.mockRejectedValue({ type: 'StripeConnectionError', message: 'timeout' });
    await svc(s1).submitPayoutRequest(r!.id);
    const s2 = stripeMock();
    s2.transfers.list.mockResolvedValue({ data: [okTransfer(r!, { amount: 3500, id: 'tr_a' }), okTransfer(r!, { amount: 3500, id: 'tr_b' })], has_more: false });
    const res = await svc(s2).reconcilePayoutRequest(r!.id);
    expect(res).toEqual({ result: 'conflict' });
    expect(await ledgerDebits(r!.id)).toBe(0);
    expect((await prisma.payoutRequest.findUnique({ where: { id: r!.id } }))!.status).toBe('RECONCILIATION_REQUIRED');
  });

  it('reconcile: candidate with wrong amount is rejected (no settle)', async () => {
    const r = await makeAllocated(35);
    const s1 = stripeMock(); s1.transfers.create.mockRejectedValue({ type: 'StripeConnectionError', message: 'timeout' });
    await svc(s1).submitPayoutRequest(r!.id);
    const s2 = stripeMock();
    s2.transfers.list.mockResolvedValue({ data: [okTransfer(r!, { amount: 9999 })], has_more: false }); // wrong amount
    const res = await svc(s2).reconcilePayoutRequest(r!.id);
    expect(res).toEqual({ result: 'no_match' });
    expect(await ledgerDebits(r!.id)).toBe(0);
  });

  it('reconcile: reversed candidate is not settled as ordinary PAID', async () => {
    const r = await makeAllocated(35);
    const s1 = stripeMock(); s1.transfers.create.mockRejectedValue({ type: 'StripeConnectionError', message: 'timeout' });
    await svc(s1).submitPayoutRequest(r!.id);
    const s2 = stripeMock();
    s2.transfers.list.mockResolvedValue({ data: [okTransfer(r!, { amount: 3500, reversed: true, amount_reversed: 3500 })], has_more: false });
    const res = await svc(s2).reconcilePayoutRequest(r!.id);
    expect(res).toEqual({ result: 'reversed_candidate' });
    expect(await ledgerDebits(r!.id)).toBe(0);
  });

  it('pre-existing conflicting ledger correlation -> hard integrity failure (no PAID, no second debit)', async () => {
    const r = await makeAllocated(40);
    // inject a CONFLICTING canonical payout debit (different amount) for this request
    await prisma.financialLedger.create({
      data: { correlationId: `payout:${r!.id}:ledger`, entryType: 'payout', accountType: 'driver', accountId: driverId, direction: 'debit', amount: 999, currency: 'usd', sourceEvent: 'payment:payout', payoutId: r!.id },
    });
    const s = stripeMock();
    s.transfers.create.mockImplementation(async () => okTransfer(r!, { amount: 4000 }));
    await expect(svc(s).submitPayoutRequest(r!.id)).rejects.toThrow(); // ledger_integrity_conflict
    expect((await prisma.payoutRequest.findUnique({ where: { id: r!.id } }))!.status).not.toBe('PAID');
  });
});
