import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient, DriverStatus, BackgroundCheckStatus } from '@bidride/database';
import { Redis } from 'ioredis';

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

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379'),
    });
  }

  // Each entry lists the accepted documentType spellings for one required doc
  // (the app uploads 'insurance'/'registration'; the schema enum names them
  // 'insurance_card'/'vehicle_registration').
  private static readonly REQUIRED_DOCUMENTS: Array<{ label: string; types: string[] }> = [
    { label: 'drivers_license', types: ['drivers_license'] },
    { label: 'insurance_card', types: ['insurance', 'insurance_card'] },
    { label: 'vehicle_registration', types: ['registration', 'vehicle_registration'] },
  ];

  /**
   * The four existing activation gates, derived from real records (never from
   * onboardingStep). Returns the list of unmet requirements; empty = eligible.
   * Public so the admin driver-detail view can render the same checklist.
   */
  computeMissingRequirements(driver: {
    documents: Array<{ documentType: string; status: string }>;
    vehicles: Array<{ isActive: boolean }>;
    backgroundCheckStatus: BackgroundCheckStatus;
    insuranceProvider: string | null;
    insurancePolicyNumber: string | null;
    insuranceExpiry: Date | null;
  }): string[] {
    const missing: string[] = [];
    for (const req of DriverActivationService.REQUIRED_DOCUMENTS) {
      const ok = driver.documents.some(
        (d) => req.types.includes(d.documentType) && d.status === 'approved',
      );
      if (!ok) missing.push(`document_not_approved:${req.label}`);
    }
    if (driver.backgroundCheckStatus !== BackgroundCheckStatus.clear) {
      missing.push(`background_check:${driver.backgroundCheckStatus}`);
    }
    if (!driver.vehicles.some((v) => v.isActive)) {
      missing.push('no_active_vehicle');
    }
    if (!driver.insuranceProvider || !driver.insurancePolicyNumber || !driver.insuranceExpiry) {
      missing.push('insurance_info_missing');
    } else if (driver.insuranceExpiry <= new Date()) {
      missing.push('insurance_expired');
    }
    return missing;
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

    const missing = this.computeMissingRequirements(driver);
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
