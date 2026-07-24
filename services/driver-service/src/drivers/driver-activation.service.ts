import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient, DriverStatus } from '@bidride/database';
import { Redis } from 'ioredis';
import { ComplianceEngine } from './compliance/compliance-engine';
import { buildComplianceContext, DriverComplianceRecord } from './compliance/compliance-context';

export type ActivationResult =
  | { outcome: 'activated' }
  | { outcome: 'already_active' }
  | { outcome: 'blocked'; missing: string[] };

// The statuses from which a driver may still be activated. declined/suspended
// are terminal-negative and must never be flipped to approved here.
const ACTIVATABLE_STATUSES: DriverStatus[] = [
  DriverStatus.pending,
  DriverStatus.under_review,
  DriverStatus.action_required,
];

/**
 * The single authority for driver activation.
 *
 * Every path that could approve a driver — the admin approve endpoint AND the
 * Checkr `clear` webhook — funnels through `maybeActivate()`, so there is
 * exactly one gated writer of `status=approved` / `onboardingStep='complete'` /
 * the `driver:approved` event. Extracted into its own provider (injecting
 * neither DriversService nor CheckrService) to break the DriversService ↔
 * CheckrService dependency cycle.
 *
 * Scope note: this evaluator enforces exactly the four EXISTING activation
 * gates. Additional gates (vehicle inspection, payout bank, W-9, etc.) are
 * deferred to a separate, founder-signed change.
 */
@Injectable()
export class DriverActivationService {
  private readonly prisma = new PrismaClient();
  private readonly redis: Redis;
  // SB2A Batch 3A: the centralized Compliance Requirements Engine. The four
  // existing activation gates now live as pure requirement modules; this service
  // no longer knows the individual rules — it asks the engine. Behavior is
  // identical (guarded by a golden-equivalence test).
  private readonly compliance = new ComplianceEngine();

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379'),
    });
  }

  /**
   * The active Zero Tolerance policy version, or null if none is published.
   * Resolved OUTSIDE the pure engine (this is the only I/O) so callers can inject
   * it into the ComplianceContext. Mirrors the resolution used by getProfile.
   */
  async getActiveZeroTolerancePolicyVersion(): Promise<string | null> {
    const policy = await this.prisma.zeroTolerancePolicy.findFirst({
      where: { isActive: true },
      orderBy: { effectiveAt: 'desc' },
      select: { version: true },
    });
    return policy?.version ?? null;
  }

  /**
   * The activation gates, derived from real records (never from onboardingStep).
   * Returns the list of unmet requirements; empty = eligible. Public so the admin
   * driver-detail view can render the same checklist.
   *
   * Delegates to the Compliance Engine. The legacy four gates produce
   * byte-identical keys/order; Phase 3B appends `zero_tolerance:not_accepted`
   * when a current policy is published and unaccepted. `currentZeroTolerancePolicyVersion`
   * MUST be resolved by the caller (see getActiveZeroTolerancePolicyVersion) and
   * passed in — omitting it leaves the Zero Tolerance gate inert.
   */
  computeMissingRequirements(
    driver: DriverComplianceRecord,
    opts: { currentZeroTolerancePolicyVersion?: string | null } = {},
  ): string[] {
    return this.compliance.evaluate(
      buildComplianceContext(driver, {
        currentZeroTolerancePolicyVersion: opts.currentZeroTolerancePolicyVersion,
      }),
    ).missing;
  }

  /**
   * Approve a driver ONLY if every activation gate is satisfied. Idempotent and
   * race-safe: the approved transition is a conditional updateMany, and
   * `driver:approved` is published only when that transition actually flipped a
   * row — so concurrent admin+webhook calls cannot double-approve or
   * double-publish.
   */
  async maybeActivate(driverId: string, opts: { notes?: string } = {}): Promise<ActivationResult> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        documents: { select: { documentType: true, status: true } },
        vehicles: { select: { isActive: true } },
      },
    });
    if (!driver) throw new NotFoundException('Driver not found');

    if (driver.status === DriverStatus.approved) {
      return { outcome: 'already_active' };
    }
    if (!ACTIVATABLE_STATUSES.includes(driver.status)) {
      // declined / suspended — terminal-negative, never activate.
      return { outcome: 'blocked', missing: [`driver_status:${driver.status}`] };
    }

    // Phase 3B: resolve the current Zero Tolerance policy version BEFORE the pure
    // engine, and inject it. A read failure here fails closed (aborts activation)
    // — it never silently approves without Zero Tolerance.
    const currentZeroTolerancePolicyVersion = await this.getActiveZeroTolerancePolicyVersion();
    const missing = this.computeMissingRequirements(driver, { currentZeroTolerancePolicyVersion });
    if (missing.length > 0) {
      return { outcome: 'blocked', missing };
    }

    // Atomic gate: only transition if still in an activatable state. A losing
    // racer sees count === 0 and does not publish.
    const result = await this.prisma.driver.updateMany({
      where: { id: driverId, status: { in: ACTIVATABLE_STATUSES } },
      data: { status: DriverStatus.approved, onboardingStep: 'complete' },
    });
    if (result.count !== 1) {
      return { outcome: 'already_active' };
    }

    await this.redis.publish(
      'driver:approved',
      JSON.stringify({ driverId, userId: driver.userId, notes: opts.notes }),
    );
    return { outcome: 'activated' };
  }
}
