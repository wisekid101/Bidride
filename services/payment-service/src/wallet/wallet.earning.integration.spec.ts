/**
 * DB-level integration tests for the idempotent driver-earning credit.
 * Runs against a real PostgreSQL — REQUIRES TEST_DATABASE_URL; skipped otherwise.
 *
 * Unit mocks cannot prove a unique constraint, so these exercise real inserts
 * to prove: one economic earning per trip, idempotent duplicate delivery,
 * concurrent single-credit resolution, and loud failure on conflicting payloads.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from './wallet.service';
import { LedgerService } from '../ledger/ledger.service';

const dbUrl = process.env.TEST_DATABASE_URL;
const describeDb = dbUrl ? describe : describe.skip;

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl ?? 'postgresql://localhost/none' } } });
const DRIVER_PHONE = '+19995559001';
const TRIP_PREFIX = 'itest-earn-';

describeDb('WalletService.creditDriverEarning — DB idempotency & concurrency', () => {
  let wallet: WalletService;
  let driverId: string;

  const corr = (tripId: string) => `trip:${tripId}:driver_earning`;
  const newTrip = () => `${TRIP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Discovery predicates the FUTURE reconciliation milestone will use. Test-only
  // here (no production code, no scheduler) — they prove a missed credit is
  // findable and correctly classified from durable DB facts.
  const journalCreditLeg = (tripId: string) =>
    prisma.financialLedger.findFirst({
      where: { correlationId: corr(tripId), entryType: 'driver_earning', direction: 'credit' },
    });
  const walletEarningForTrip = (tripId: string) =>
    prisma.walletTransaction.findFirst({ where: { tripId, type: 'earning' } });

  // Case 1: no journal AND no wallet earning -> safe to auto-replay.
  const isCase1AutoReplay = async (tripId: string) =>
    !(await journalCreditLeg(tripId)) && !(await walletEarningForTrip(tripId));
  // Case 2: complete journal (2 legs) but the projection row is gone.
  const isCase2MissingProjection = async (tripId: string) =>
    (await prisma.financialLedger.count({ where: { correlationId: corr(tripId), entryType: 'driver_earning' } })) === 2 &&
    !(await prisma.walletTransaction.findFirst({ where: { correlationId: corr(tripId) } }));
  // Case 3: legacy wallet-only projection with no canonical journal -> reconcile, never blind-replay.
  const isCase3LegacyWalletOnly = async (tripId: string) =>
    !(await journalCreditLeg(tripId)) && !!(await walletEarningForTrip(tripId));

  const cleanupResidue = async () => {
    await prisma.financialLedger.deleteMany({ where: { tripId: { startsWith: TRIP_PREFIX } } });
    const u = await prisma.user.findUnique({
      where: { phone: DRIVER_PHONE },
      include: { driver: { include: { wallet: true } } },
    });
    if (u?.driver?.wallet) {
      await prisma.walletTransaction.deleteMany({ where: { walletId: u.driver.wallet.id } });
      await prisma.driverWallet.delete({ where: { id: u.driver.wallet.id } });
    }
    if (u?.driver) await prisma.driver.delete({ where: { id: u.driver.id } });
    if (u) await prisma.user.delete({ where: { id: u.id } });
  };

  beforeAll(async () => {
    const prismaService = prisma as unknown as PrismaService;
    wallet = new WalletService(prismaService, new LedgerService(prismaService));
    await cleanupResidue();
    const u = await prisma.user.create({
      data: {
        phone: DRIVER_PHONE,
        role: 'driver',
        driver: {
          create: {
            status: 'approved',
            legalFirstName: 'IT',
            legalLastName: 'Earn',
            dateOfBirth: new Date('1990-01-01'),
          },
        },
      },
      include: { driver: true },
    });
    driverId = u.driver!.id;
  });

  afterAll(async () => {
    await cleanupResidue();
    await prisma.$disconnect();
  });

  it('one trip → exactly one journal (2 legs) + one wallet txn', async () => {
    const tripId = newTrip();
    expect(await wallet.creditDriverEarning(driverId, tripId, 16.5)).toBe('credited');
    expect(await prisma.financialLedger.findMany({ where: { tripId } })).toHaveLength(2);
    expect(await prisma.walletTransaction.findMany({ where: { correlationId: corr(tripId) } })).toHaveLength(1);
  });

  it('duplicate delivery (same amount) is idempotent — no second rows', async () => {
    const tripId = newTrip();
    await wallet.creditDriverEarning(driverId, tripId, 20);
    expect(await wallet.creditDriverEarning(driverId, tripId, 20)).toBe('duplicate_ignored');
    expect(await prisma.financialLedger.findMany({ where: { tripId } })).toHaveLength(2); // not 4
    expect(await prisma.walletTransaction.findMany({ where: { correlationId: corr(tripId) } })).toHaveLength(1);
  });

  it('concurrent credits for the same trip resolve to exactly one economic earning', async () => {
    const tripId = newTrip();
    const results = await Promise.allSettled([
      wallet.creditDriverEarning(driverId, tripId, 12),
      wallet.creditDriverEarning(driverId, tripId, 12),
      wallet.creditDriverEarning(driverId, tripId, 12),
    ]);
    const values = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<string>).value);
    expect(values.filter((v) => v === 'credited')).toHaveLength(1);
    expect(await prisma.financialLedger.findMany({ where: { tripId } })).toHaveLength(2); // one journal only
    expect(await prisma.walletTransaction.findMany({ where: { correlationId: corr(tripId) } })).toHaveLength(1);
  });

  it('conflicting amount for the same trip fails loudly and writes no second journal', async () => {
    const tripId = newTrip();
    await wallet.creditDriverEarning(driverId, tripId, 30);
    await expect(wallet.creditDriverEarning(driverId, tripId, 31)).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.financialLedger.findMany({ where: { tripId } })).toHaveLength(2);
  });

  it('wallet projection lifetimeEarnings matches the canonical ledger driver-credit total', async () => {
    const creditLegs = await prisma.financialLedger.findMany({
      where: { accountId: driverId, direction: 'credit', entryType: 'driver_earning' },
    });
    const ledgerTotal = creditLegs.reduce((s, e) => s + Number(e.amount), 0);
    const w = await prisma.driverWallet.findUnique({ where: { driverId } });
    expect(Number(w!.lifetimeEarnings)).toBeCloseTo(ledgerTotal, 2);
  });

  it('Case 1: a genuinely missing credit is discoverable and replays into exactly one economic credit', async () => {
    const tripId = newTrip();
    expect(await isCase1AutoReplay(tripId)).toBe(true); // discoverable as missing
    expect(await wallet.creditDriverEarning(driverId, tripId, 14)).toBe('credited'); // replay
    expect(await prisma.financialLedger.findMany({ where: { tripId } })).toHaveLength(2);
    expect(await prisma.walletTransaction.findMany({ where: { correlationId: corr(tripId) } })).toHaveLength(1);
    expect(await isCase1AutoReplay(tripId)).toBe(false); // no longer flagged after replay
  });

  it('Case 2: complete journal with a missing projection is identifiable; replay adds no second journal', async () => {
    const tripId = newTrip();
    await wallet.creditDriverEarning(driverId, tripId, 18);
    await prisma.walletTransaction.deleteMany({ where: { correlationId: corr(tripId) } }); // simulate lost projection
    expect(await isCase2MissingProjection(tripId)).toBe(true); // identifiable (journal present, projection gone)
    expect(await isCase1AutoReplay(tripId)).toBe(false); // NOT an auto-replay candidate (journal exists)
    // A blind creditDriverEarning is idempotent on the journal and creates no second one.
    expect(await wallet.creditDriverEarning(driverId, tripId, 18)).toBe('duplicate_ignored');
    expect(await prisma.financialLedger.findMany({ where: { tripId } })).toHaveLength(2);
    // (Projection repair is a separate ledger-driven rebuild, not this credit primitive.)
  });

  it('Case 3: a legacy wallet-only projection (no journal) is identifiable and excluded from auto-replay', async () => {
    const tripId = newTrip();
    const w = await prisma.driverWallet.upsert({
      where: { driverId }, update: {},
      create: { driverId, pendingBalance: 0, availableBalance: 0, lifetimeEarnings: 0, lifetimePaid: 0 },
    });
    // Pre-Commit-1 legacy credit: wallet row with NULL correlationId and no canonical journal.
    await prisma.walletTransaction.create({
      data: { walletId: w.id, driverId, type: 'earning', direction: 'credit', amount: 25, balanceAfter: 0, tripId, description: 'legacy', correlationId: null },
    });
    expect(await isCase3LegacyWalletOnly(tripId)).toBe(true); // identifiable as legacy wallet-only
    expect(await isCase1AutoReplay(tripId)).toBe(false); // EXCLUDED from blind auto-replay (would double-credit)
  });
});
