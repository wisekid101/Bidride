/**
 * Integration tests for driver-service — runs against real PostgreSQL + Redis.
 * Requires TEST_DATABASE_URL and TEST_REDIS_URL (enforced by
 * test/integration-setup.js, so a misconfigured run fails instead of skipping).
 *
 * Scope is deliberately limited to workflows that execute entirely against
 * PostgreSQL and Redis:
 *
 *   1. Onboarding progression — derived cursor, persistence, invalid moves
 *   2. Activation            — gating, persistence, idempotency, terminal states
 *   3. Compliance            — engine keys, document tracking, zero tolerance
 *   4. Vehicle               — registration, approval, ownership, duplicates
 *   5. Wallet                — creation, default balances, earnings init
 *   6. Documents             — metadata, approval/rejection, lifecycle
 *   7. Presigned URLs        — generation, metadata, permissions, expiry ONLY
 *
 * Explicitly NOT covered (external boundaries, per the approved scope):
 * Checkr, background-check submission, and any real object upload. Presigned
 * URL generation is pure local signing — no request is issued to AWS or MinIO,
 * and `global.fetch` is replaced with a throwing spy so any outbound HTTP
 * attempt fails the run rather than escaping.
 *
 * Several providers construct their own PrismaClient/Redis rather than taking
 * them by injection, so we pin the process environment to the test backends
 * before importing them, and close each client explicitly in teardown.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

// DriverActivationService and CheckrService build Redis from REDIS_HOST/PORT,
// not from a URL, so derive those from TEST_REDIS_URL to keep the linkage.
const testRedisUrl = new URL(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379');
process.env.REDIS_HOST = testRedisUrl.hostname;
process.env.REDIS_PORT = testRedisUrl.port || '6379';

// Static placeholder credentials so the AWS signer never consults the instance
// metadata service (which would be a real network call).
process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'integration-test-key';
process.env.AWS_SECRET_ACCESS_KEY = 'integration-test-secret';
process.env.DOCUMENTS_BUCKET = 'bidride-driver-documents-test';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@bidride/database';
import { Redis } from 'ioredis';
import { DriverActivationService } from './driver-activation.service';
import { ComplianceEngine } from './compliance/compliance-engine';
import { buildComplianceContext } from './compliance/compliance-context';
import { resolveOnboardingStep, OnboardingFacts } from './onboarding-step.util';
import { VehiclesService } from '../vehicles/vehicles.service';
import { DocumentsService } from '../documents/documents.service';
import { EarningsService } from '../earnings/earnings.service';

// Test-owned client, explicitly pinned to the test database.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});
const redis = new Redis(process.env.TEST_REDIS_URL!);
const subscriber = redis.duplicate();

// Reserved fixture block for this suite — distinct from other services'.
const DRIVER_PHONE = '+19995556001';
const OTHER_PHONE = '+19995556002';
const PHONES = [DRIVER_PHONE, OTHER_PHONE];
const VIN = 'INTEG0000000TEST1';
const OTHER_VIN = 'INTEG0000000TEST2';
const ZT_VERSION = 'integration-test-zt-v1';
const ADMIN_ID = '00000000-0000-0000-0000-0000000000ad';

const publishedApprovals: string[] = [];

/** Wait until `predicate` returns truthy. Fails the test on timeout. */
async function waitFor<T>(
  predicate: () => Promise<T | undefined | null> | T | undefined | null,
  what: string,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Assert a promise rejects with the given exception type. */
async function expectReject(promise: Promise<unknown>, type: new (...a: any[]) => Error) {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(type);
  return caught as Error;
}

describe('driver-service (integration)', () => {
  let activation: DriverActivationService;
  let vehicles: VehiclesService;
  let documents: DocumentsService;
  let earnings: EarningsService;
  let fetchSpy: jest.SpyInstance;

  let driverUserId: string;
  let driverId: string;
  let otherUserId: string;
  let otherDriverId: string;

  /** Delete every row this suite can create, child-first. Idempotent. */
  async function cleanupDb() {
    const users = await prisma.user.findMany({
      where: { phone: { in: PHONES } },
      include: { driver: true },
    });
    const driverIds = users.map((u) => u.driver?.id).filter((id): id is string => !!id);

    if (driverIds.length) {
      await prisma.document.deleteMany({ where: { driverId: { in: driverIds } } });
      await prisma.vehicle.deleteMany({ where: { driverId: { in: driverIds } } });
      await prisma.driverWallet.deleteMany({ where: { driverId: { in: driverIds } } });
      await prisma.zeroToleranceAcceptance.deleteMany({ where: { driverId: { in: driverIds } } });
      await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
    }
    await prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await prisma.vehicle.deleteMany({ where: { vin: { in: [VIN, OTHER_VIN] } } });
    await prisma.zeroToleranceAcceptance.deleteMany({ where: { policyVersion: ZT_VERSION } });
    await prisma.zeroTolerancePolicy.deleteMany({ where: { version: ZT_VERSION } });
  }

  /** Reset the primary driver to a known blank onboarding state. */
  async function resetDriver(data: Record<string, unknown> = {}) {
    await prisma.document.deleteMany({ where: { driverId } });
    await prisma.vehicle.deleteMany({ where: { driverId } });
    await prisma.zeroToleranceAcceptance.deleteMany({ where: { driverId } });
    await prisma.driver.update({
      where: { id: driverId },
      data: {
        status: 'pending',
        onboardingStep: 'personal_info',
        backgroundCheckStatus: 'not_started',
        insuranceProvider: null,
        insurancePolicyNumber: null,
        insuranceExpiry: null,
        stripeAccountId: null,
        zeroToleranceAcceptedVersion: null,
        ...data,
      },
    });
  }

  /** Bring the primary driver to a fully activation-eligible state. */
  async function makeEligible() {
    await resetDriver({
      status: 'under_review',
      backgroundCheckStatus: 'clear',
      insuranceProvider: 'Integration Mutual',
      insurancePolicyNumber: 'POL-INT-1',
      insuranceExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      stripeAccountId: 'acct_integration_test',
    });
    await prisma.vehicle.create({
      data: {
        driverId,
        make: 'Toyota',
        model: 'Camry',
        year: new Date().getFullYear() - 1,
        color: 'Blue',
        licensePlate: 'INT1234',
        vin: VIN,
        isActive: true,
        inspectionStatus: 'passed',
      },
    });
    for (const documentType of ['drivers_license', 'insurance_card', 'vehicle_registration']) {
      await prisma.document.create({
        data: { driverId, documentType, s3Key: `fixture/${documentType}`, status: 'approved' },
      });
    }
  }

  beforeAll(async () => {
    await cleanupDb();

    const driverUser = await prisma.user.create({
      data: {
        phone: DRIVER_PHONE,
        role: 'driver',
        driver: {
          create: {
            status: 'pending',
            onboardingStep: 'personal_info',
            legalFirstName: 'Integration',
            legalLastName: 'Driver',
            dateOfBirth: new Date('1990-01-01'),
            licenseNumber: 'DL-INT-0001',
          },
        },
      },
      include: { driver: true },
    });
    driverUserId = driverUser.id;
    driverId = driverUser.driver!.id;

    const otherUser = await prisma.user.create({
      data: {
        phone: OTHER_PHONE,
        role: 'driver',
        driver: {
          create: {
            status: 'pending',
            legalFirstName: 'Other',
            legalLastName: 'Driver',
            dateOfBirth: new Date('1991-02-02'),
          },
        },
      },
      include: { driver: true },
    });
    otherUserId = otherUser.id;
    otherDriverId = otherUser.driver!.id;

    // These providers self-construct their clients; the env pinning above makes
    // them target the test backends.
    activation = new DriverActivationService();
    vehicles = new VehiclesService();
    documents = new DocumentsService();
    earnings = new EarningsService();

    // Nothing in the approved scope may make an outbound HTTP request.
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('Outbound HTTP attempted during integration test');
    });

    subscriber.on('message', (_channel: string, message: string) => {
      publishedApprovals.push(message);
    });
    await subscriber.subscribe('driver:approved');
  });

  afterAll(async () => {
    const settle = (work: Promise<unknown> | undefined) =>
      Promise.resolve(work).catch(() => undefined);

    fetchSpy?.mockRestore();
    await settle(cleanupDb());
    await settle(subscriber.unsubscribe());
    // Each provider owns a client that nothing else will close.
    for (const svc of [activation, vehicles, documents, earnings]) {
      const client = (svc as unknown as { prisma?: PrismaClient })?.prisma;
      await settle(client?.$disconnect());
    }
    await settle((activation as unknown as { redis?: Redis })?.redis?.quit());
    await settle(prisma.$disconnect());
    await settle(subscriber.quit());
    await settle(redis.quit());
  });

  beforeEach(() => {
    publishedApprovals.length = 0;
    fetchSpy.mockClear();
  });

  // ── 1. Onboarding progression ────────────────────────────────────────────

  describe('onboarding progression', () => {
    beforeEach(() => resetDriver());

    /** Build the resolver facts from the driver's real persisted rows. */
    async function factsFromDb(): Promise<OnboardingFacts> {
      const driver = await prisma.driver.findUniqueOrThrow({
        where: { id: driverId },
        include: { vehicles: true, documents: { select: { documentType: true, status: true } } },
      });
      const policy = await prisma.zeroTolerancePolicy.findFirst({
        where: { isActive: true },
        orderBy: { effectiveAt: 'desc' },
        select: { version: true },
      });
      return {
        status: driver.status,
        legalFirstName: driver.legalFirstName,
        dateOfBirth: driver.dateOfBirth,
        licenseNumber: driver.licenseNumber,
        vehicleCount: driver.vehicles.length,
        documents: driver.documents,
        stripeAccountId: driver.stripeAccountId,
        backgroundCheckStatus: driver.backgroundCheckStatus,
        zeroToleranceAccepted: !policy || driver.zeroToleranceAcceptedVersion === policy.version,
      };
    }

    it('derives the next step from persisted facts, in canonical order', async () => {
      // Personal info is already present on the fixture → next gap is vehicle.
      expect(resolveOnboardingStep(await factsFromDb())).toBe('vehicle_info');

      await vehicles.addVehicle(driverUserId, {
        make: 'Honda', model: 'Accord', year: new Date().getFullYear() - 2,
        color: 'Black', licensePlate: 'INT9999', licensePlateState: 'NJ',
        vin: VIN, vehicleClass: 'standard',
      } as any);
      expect(resolveOnboardingStep(await factsFromDb())).toBe('document_upload');

      for (const documentType of ['drivers_license', 'insurance', 'registration']) {
        await prisma.document.create({
          data: { driverId, documentType, s3Key: `k/${documentType}`, status: 'pending' },
        });
      }
      expect(resolveOnboardingStep(await factsFromDb())).toBe('bank_account');

      await prisma.driver.update({
        where: { id: driverId },
        data: { stripeAccountId: 'acct_integration_test' },
      });
      expect(resolveOnboardingStep(await factsFromDb())).toBe('background_check');

      await prisma.driver.update({
        where: { id: driverId },
        data: { backgroundCheckStatus: 'pending' },
      });
      expect(resolveOnboardingStep(await factsFromDb())).toBe('complete');
    });

    it('persists the cursor advance when a vehicle is registered', async () => {
      await prisma.driver.update({
        where: { id: driverId },
        data: { onboardingStep: 'vehicle_info' },
      });

      await vehicles.addVehicle(driverUserId, {
        make: 'Honda', model: 'Accord', year: new Date().getFullYear() - 2,
        color: 'Black', licensePlate: 'INT9999', licensePlateState: 'NJ',
        vin: VIN, vehicleClass: 'standard',
      } as any);

      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(driver.onboardingStep).toBe('document_upload');
    });

    it('routes back to document upload when a document is rejected', async () => {
      await prisma.vehicle.create({
        data: {
          driverId, make: 'Honda', model: 'Accord', year: new Date().getFullYear() - 2,
          color: 'Black', licensePlate: 'INT9999', vin: VIN, isActive: true,
        },
      });
      for (const documentType of ['drivers_license', 'insurance', 'registration']) {
        await prisma.document.create({
          data: { driverId, documentType, s3Key: `k/${documentType}`, status: 'approved' },
        });
      }
      await prisma.driver.update({
        where: { id: driverId },
        data: { stripeAccountId: 'acct_x', backgroundCheckStatus: 'pending' },
      });
      expect(resolveOnboardingStep(await factsFromDb())).toBe('complete');

      await prisma.document.update({
        where: { driverId_documentType: { driverId, documentType: 'insurance' } },
        data: { status: 'rejected' },
      });

      expect(resolveOnboardingStep(await factsFromDb())).toBe('document_upload');
    });

    it('never routes an approved driver backward', async () => {
      await prisma.driver.update({ where: { id: driverId }, data: { status: 'approved' } });

      // Approved short-circuits to complete even with every other fact missing.
      expect(resolveOnboardingStep(await factsFromDb())).toBe('complete');
    });

    it('normalizes an obsolete stored cursor without rewriting it', async () => {
      await prisma.driver.update({
        where: { id: driverId },
        data: { onboardingStep: 'vehicle_inspection' }, // retired cursor value
      });

      expect(resolveOnboardingStep(await factsFromDb())).toBe('vehicle_info');

      // The stored cursor is a secondary marker and is left untouched.
      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(driver.onboardingStep).toBe('vehicle_inspection');
    });
  });

  // ── 2. Activation ────────────────────────────────────────────────────────

  describe('driver activation', () => {
    it('blocks activation when every requirement is unmet', async () => {
      await resetDriver({ status: 'under_review' });

      const result = await activation.maybeActivate(driverId);

      expect(result.outcome).toBe('blocked');
      expect((result as { missing: string[] }).missing).toEqual([
        'document_not_approved:drivers_license',
        'document_not_approved:insurance_card',
        'document_not_approved:vehicle_registration',
        'background_check:not_started',
        'no_active_vehicle',
        'insurance_info_missing',
      ]);

      // Nothing was written.
      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(driver.status).toBe('under_review');
      expect(publishedApprovals).toHaveLength(0);
    });

    it('activates and persists once every requirement is met', async () => {
      await makeEligible();

      const result = await activation.maybeActivate(driverId, { notes: 'integration' });
      expect(result.outcome).toBe('activated');

      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(driver.status).toBe('approved');
      expect(driver.onboardingStep).toBe('complete');

      const message = await waitFor(
        () => publishedApprovals.find((m) => JSON.parse(m).driverId === driverId),
        'the driver:approved event',
      );
      expect(JSON.parse(message)).toMatchObject({ driverId, userId: driverUserId });
    });

    it('is idempotent — a repeated activation neither re-approves nor re-publishes', async () => {
      await makeEligible();
      await activation.maybeActivate(driverId);
      await waitFor(
        () => publishedApprovals.find((m) => JSON.parse(m).driverId === driverId),
        'the first driver:approved event',
      );
      const publishedAfterFirst = publishedApprovals.length;

      const second = await activation.maybeActivate(driverId);
      expect(second.outcome).toBe('already_active');

      // No second event for this driver.
      await new Promise((r) => setTimeout(r, 150));
      expect(publishedApprovals.length).toBe(publishedAfterFirst);
    });

    it('refuses to activate a terminal-negative driver', async () => {
      await makeEligible();
      await prisma.driver.update({ where: { id: driverId }, data: { status: 'suspended' } });

      const result = await activation.maybeActivate(driverId);

      expect(result).toEqual({ outcome: 'blocked', missing: ['driver_status:suspended'] });
      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(driver.status).toBe('suspended');
      expect(publishedApprovals).toHaveLength(0);
    });

    it('throws for a driver that does not exist', async () => {
      await expectReject(
        activation.maybeActivate('00000000-0000-0000-0000-000000000000'),
        NotFoundException,
      );
    });
  });

  // ── 3. Compliance ────────────────────────────────────────────────────────

  describe('compliance', () => {
    const engine = new ComplianceEngine();

    /** Evaluate the engine against the driver's real persisted record. */
    async function evaluateFromDb(currentZeroTolerancePolicyVersion?: string | null) {
      const driver = await prisma.driver.findUniqueOrThrow({
        where: { id: driverId },
        include: {
          documents: { select: { documentType: true, status: true } },
          vehicles: { select: { isActive: true } },
        },
      });
      return engine.evaluate(
        buildComplianceContext(driver, { currentZeroTolerancePolicyVersion }),
      );
    }

    it('reports a fully compliant driver as activatable', async () => {
      await makeEligible();

      const report = await evaluateFromDb();
      expect(report.canActivate).toBe(true);
      expect(report.missing).toEqual([]);
    });

    it('tracks each required document individually', async () => {
      await makeEligible();
      await prisma.document.deleteMany({ where: { driverId, documentType: 'insurance_card' } });

      const report = await evaluateFromDb();
      expect(report.missing).toEqual(['document_not_approved:insurance_card']);
      expect(report.canActivate).toBe(false);
    });

    it('treats a pending document as not approved', async () => {
      await makeEligible();
      await prisma.document.update({
        where: { driverId_documentType: { driverId, documentType: 'drivers_license' } },
        data: { status: 'pending' },
      });

      expect((await evaluateFromDb()).missing).toContain('document_not_approved:drivers_license');
    });

    it('treats a rejected document as not approved', async () => {
      await makeEligible();
      await prisma.document.update({
        where: { driverId_documentType: { driverId, documentType: 'vehicle_registration' } },
        data: { status: 'rejected' },
      });

      expect((await evaluateFromDb()).missing).toContain(
        'document_not_approved:vehicle_registration',
      );
    });

    it('blocks when no vehicle is active and when insurance has expired', async () => {
      await makeEligible();
      await prisma.vehicle.updateMany({ where: { driverId }, data: { isActive: false } });
      await prisma.driver.update({
        where: { id: driverId },
        data: { insuranceExpiry: new Date(Date.now() - 24 * 3600 * 1000) },
      });

      const report = await evaluateFromDb();
      expect(report.missing).toEqual(['no_active_vehicle', 'insurance_expired']);
    });

    it('leaves the zero-tolerance gate inert when no policy is published', async () => {
      await makeEligible();

      const report = await evaluateFromDb(null);
      expect(report.missing).toEqual([]);
      expect(report.canActivate).toBe(true);
    });

    it('blocks activation when a published policy has not been accepted', async () => {
      await makeEligible();
      await prisma.zeroTolerancePolicy.create({
        data: {
          version: ZT_VERSION,
          contentHash: 'hash',
          body: 'Zero tolerance policy body.',
          minAppVersion: '1.0.0',
          isActive: true,
          effectiveAt: new Date(),
        },
      });

      // Resolved through the service's own policy lookup, not a literal.
      const version = await activation.getActiveZeroTolerancePolicyVersion();
      expect(version).toBe(ZT_VERSION);
      expect((await evaluateFromDb(version)).missing).toEqual(['zero_tolerance:not_accepted']);

      const blocked = await activation.maybeActivate(driverId);
      expect(blocked).toEqual({
        outcome: 'blocked',
        missing: ['zero_tolerance:not_accepted'],
      });

      // Accepting the current version clears the gate and unblocks activation.
      await prisma.zeroToleranceAcceptance.create({
        data: {
          driverId,
          policyVersion: ZT_VERSION,
          policyContentHash: 'hash',
          acceptedAt: new Date(),
        },
      });
      await prisma.driver.update({
        where: { id: driverId },
        data: { zeroToleranceAcceptedVersion: ZT_VERSION },
      });

      expect((await evaluateFromDb(version)).missing).toEqual([]);
      expect((await activation.maybeActivate(driverId)).outcome).toBe('activated');

      await prisma.zeroTolerancePolicy.update({
        where: { version: ZT_VERSION },
        data: { isActive: false },
      });
    });
  });

  // ── 4. Vehicle ───────────────────────────────────────────────────────────

  describe('vehicle registration and approval', () => {
    beforeEach(() => resetDriver({ onboardingStep: 'vehicle_info' }));

    const newVehicle = (overrides: Record<string, unknown> = {}) => ({
      make: 'Honda', model: 'Accord', year: new Date().getFullYear() - 2,
      color: 'Black', licensePlate: 'INT9999', licensePlateState: 'NJ',
      vin: VIN, vehicleClass: 'standard', ...overrides,
    });

    it('registers a vehicle and persists it against the driver', async () => {
      const vehicle = await vehicles.addVehicle(driverUserId, newVehicle() as any);

      expect(vehicle.driverId).toBe(driverId);
      expect(vehicle.inspectionStatus).toBe('pending');

      const stored = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(stored.vin).toBe(VIN);
      expect(stored.isActive).toBe(true);
    });

    it('rejects a duplicate VIN already registered on the platform', async () => {
      await vehicles.addVehicle(driverUserId, newVehicle() as any);

      // Same VIN, different driver — must still be refused platform-wide.
      const error = await expectReject(
        vehicles.addVehicle(otherUserId, newVehicle({ licensePlate: 'OTH1111' }) as any),
        BadRequestException,
      );
      expect(error.message).toContain('already registered');

      expect(await prisma.vehicle.count({ where: { vin: VIN } })).toBe(1);
    });

    it('rejects a vehicle older than the age limit', async () => {
      await expectReject(
        vehicles.addVehicle(driverUserId, newVehicle({ year: new Date().getFullYear() - 15 }) as any),
        BadRequestException,
      );

      expect(await prisma.vehicle.count({ where: { driverId } })).toBe(0);
    });

    it('refuses to activate a vehicle owned by another driver', async () => {
      const mine = await vehicles.addVehicle(driverUserId, newVehicle() as any);

      await expectReject(vehicles.setActiveVehicle(otherUserId, mine.id), ForbiddenException);
    });

    it('requires a passed inspection before a vehicle can be made active', async () => {
      const vehicle = await vehicles.addVehicle(driverUserId, newVehicle() as any);
      expect(vehicle.inspectionStatus).toBe('pending');

      await expectReject(
        vehicles.setActiveVehicle(driverUserId, vehicle.id),
        BadRequestException,
      );

      await vehicles.approveInspection(vehicle.id, ADMIN_ID);
      const approved = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(approved.inspectionStatus).toBe('passed');

      await expect(vehicles.setActiveVehicle(driverUserId, vehicle.id)).resolves.toBeDefined();
    });

    it('throws for a user with no driver profile', async () => {
      await expectReject(
        vehicles.addVehicle('00000000-0000-0000-0000-000000000000', newVehicle() as any),
        NotFoundException,
      );
    });
  });

  // ── 5. Wallet ────────────────────────────────────────────────────────────

  describe('wallet and earnings initialization', () => {
    beforeEach(async () => {
      await resetDriver();
      await prisma.driverWallet.deleteMany({ where: { driverId } });
    });

    it('creates a wallet with zeroed default balances', async () => {
      const wallet = await prisma.driverWallet.create({ data: { driverId } });

      expect(Number(wallet.pendingBalance)).toBe(0);
      expect(Number(wallet.availableBalance)).toBe(0);
      expect(Number(wallet.lifetimeEarnings)).toBe(0);
      expect(Number(wallet.lifetimePaid)).toBe(0);
      expect(wallet.lastPayoutAt).toBeNull();
    });

    it('enforces one wallet per driver', async () => {
      await prisma.driverWallet.create({ data: { driverId } });

      await expect(prisma.driverWallet.create({ data: { driverId } })).rejects.toThrow();
      expect(await prisma.driverWallet.count({ where: { driverId } })).toBe(1);
    });

    it('reports a zeroed earnings summary for a new driver', async () => {
      await prisma.driverWallet.create({ data: { driverId } });

      const summary = await earnings.getToday(driverUserId);

      expect(summary).toMatchObject({
        takeHome: 0, trips: 0, floorSupplements: 0, floorTriggeredCount: 0,
        pendingWallet: 0, availableWallet: 0, lifetimeEarnings: 0, periodLabel: 'Today',
      });
    });

    it('reflects real wallet balances in the summary', async () => {
      await prisma.driverWallet.create({
        data: {
          driverId, pendingBalance: 42.5, availableBalance: 17.25, lifetimeEarnings: 300.75,
        },
      });

      const summary = await earnings.getWeek(driverUserId);
      expect(summary.pendingWallet).toBe(42.5);
      expect(summary.availableWallet).toBe(17.25);
      expect(summary.lifetimeEarnings).toBe(300.75);
      expect(summary.periodLabel).toBe('This Week');
    });

    it('treats a driver with no wallet as zeroed rather than failing', async () => {
      const summary = await earnings.getToday(driverUserId);
      expect(summary.pendingWallet).toBe(0);
      expect(summary.lifetimeEarnings).toBe(0);
    });

    it('throws for a user with no driver profile', async () => {
      await expectReject(
        earnings.getToday('00000000-0000-0000-0000-000000000000'),
        NotFoundException,
      );
    });
  });

  // ── 6 + 7. Documents and presigned URLs ──────────────────────────────────

  describe('documents and presigned URLs', () => {
    beforeEach(() => resetDriver({ onboardingStep: 'document_upload' }));

    it('generates a presigned upload URL and records the document metadata', async () => {
      const result = await documents.getUploadUrl(driverUserId, 'drivers_license', 'image/jpeg');

      expect(result.expiresIn).toBe(300);
      expect(result.key).toMatch(new RegExp(`^drivers/${driverId}/drivers_license/`));

      // Host shape depends on AWS_ENDPOINT_URL (LocalStack locally, real S3 in a
      // deployed environment), so assert only endpoint-independent properties.
      const url = new URL(result.uploadUrl);
      expect(url.hostname).toContain(process.env.DOCUMENTS_BUCKET);
      expect(url.pathname).toContain(result.key);
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(url.searchParams.get('X-Amz-Credential')).toContain(process.env.AWS_ACCESS_KEY_ID);
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBeTruthy();

      // Signing is local — no request was issued to AWS or MinIO.
      expect(fetchSpy).not.toHaveBeenCalled();

      const doc = await prisma.document.findUniqueOrThrow({
        where: { driverId_documentType: { driverId, documentType: 'drivers_license' } },
      });
      expect(doc.status).toBe('pending');
      expect(doc.s3Key).toBe(result.key);
    });

    it('rejects a disallowed content type before signing anything', async () => {
      await expectReject(
        documents.getUploadUrl(driverUserId, 'drivers_license', 'application/zip'),
        BadRequestException,
      );

      expect(await prisma.document.count({ where: { driverId } })).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('re-issuing an upload URL resets the review state', async () => {
      const first = await documents.getUploadUrl(driverUserId, 'insurance', 'image/png');
      await documents.reviewDocument(driverId, 'insurance', 'rejected', ADMIN_ID, 'illegible');

      const second = await documents.getUploadUrl(driverUserId, 'insurance', 'image/png');
      expect(second.key).not.toBe(first.key);

      const doc = await prisma.document.findUniqueOrThrow({
        where: { driverId_documentType: { driverId, documentType: 'insurance' } },
      });
      expect(doc.status).toBe('pending');
      expect(doc.reviewedAt).toBeNull();
      expect(doc.reviewedByAdminId).toBeNull();
      expect(await prisma.document.count({ where: { driverId, documentType: 'insurance' } })).toBe(1);
    });

    it('generates a time-limited view URL with a longer expiry', async () => {
      await documents.getUploadUrl(driverUserId, 'drivers_license', 'image/jpeg');

      const view = await documents.getDocumentViewUrl(driverId, 'drivers_license');
      expect(view.expiresIn).toBe(600);
      expect(new URL(view.url).searchParams.get('X-Amz-Expires')).toBe('600');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refuses a view URL for a document that does not exist', async () => {
      await expectReject(
        documents.getDocumentViewUrl(driverId, 'profile_photo'),
        NotFoundException,
      );
    });

    it('persists an approval decision with reviewer metadata', async () => {
      await documents.getUploadUrl(driverUserId, 'drivers_license', 'image/jpeg');

      await documents.reviewDocument(driverId, 'drivers_license', 'approved', ADMIN_ID, 'looks good');

      const doc = await prisma.document.findUniqueOrThrow({
        where: { driverId_documentType: { driverId, documentType: 'drivers_license' } },
      });
      expect(doc.status).toBe('approved');
      expect(doc.reviewedByAdminId).toBe(ADMIN_ID);
      expect(doc.reviewNotes).toBe('looks good');
      expect(doc.reviewedAt).toBeInstanceOf(Date);

      // An approval must not change the driver's status.
      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(driver.status).toBe('pending');
    });

    it('flags the driver as action_required when a document is rejected', async () => {
      await documents.getUploadUrl(driverUserId, 'registration', 'application/pdf');

      await documents.reviewDocument(driverId, 'registration', 'rejected', ADMIN_ID, 'expired');

      const doc = await prisma.document.findUniqueOrThrow({
        where: { driverId_documentType: { driverId, documentType: 'registration' } },
      });
      expect(doc.status).toBe('rejected');
      expect(doc.reviewNotes).toBe('expired');

      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(driver.status).toBe('action_required');
    });

    it('advances onboarding once every required document is submitted', async () => {
      for (const documentType of ['drivers_license', 'insurance'] as const) {
        await documents.getUploadUrl(driverUserId, documentType, 'image/jpeg');
        const partial = await documents.confirmUpload(driverUserId, documentType);
        expect(partial.allRequiredSubmitted).toBe(false);
      }

      await documents.getUploadUrl(driverUserId, 'registration', 'application/pdf');
      const complete = await documents.confirmUpload(driverUserId, 'registration');

      expect(complete.allRequiredSubmitted).toBe(true);
      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(driver.onboardingStep).toBe('bank_account');
      expect(driver.status).toBe('under_review');
    });

    it('lists the documents belonging to the driver only', async () => {
      await documents.getUploadUrl(driverUserId, 'drivers_license', 'image/jpeg');
      await prisma.document.create({
        data: {
          driverId: otherDriverId, documentType: 'drivers_license',
          s3Key: 'other/key', status: 'approved',
        },
      });

      const listed = await documents.listDocuments(driverUserId);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ documentType: 'drivers_license', status: 'pending' });
    });
  });
});
