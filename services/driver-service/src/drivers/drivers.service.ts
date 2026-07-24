import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaClient, DriverStatus, BackgroundCheckStatus } from '@bidride/database';
import { Redis } from 'ioredis';
import {
  SubmitPersonalInfoDto,
  RequestBackgroundCheckDto,
  UpdateAvailabilityDto,
  ApproveDriverDto,
  DeclineDriverDto,
  SuspendDriverDto,
} from './dto';
import { CheckrService } from './checkr.service';
import { DriverActivationService } from './driver-activation.service';
import { resolveOnboardingStep, isNonCanonicalCursor, OnboardingFacts } from './onboarding-step.util';

// driver:{userId}:location is shared with the auth-service gateway, which
// refreshes it on every GPS emit / heartbeat with the SAME env-driven TTL —
// two writers with different TTLs would make the retention bound meaningless.
// Malformed env falls back; never NaN into SETEX.
const DRIVER_LOCATION_TTL_SEC = (() => {
  const parsed = Number(process.env.LOCATION_TTL_SECONDS ?? 180);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 180;
})();

@Injectable()
export class DriversService {
  private prisma = new PrismaClient();
  private redis: Redis;
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private readonly checkrService: CheckrService,
    private readonly activation: DriverActivationService,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379'),
    });
  }

  async getProfile(userId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      include: {
        user: { select: { phone: true, email: true, profilePhotoUrl: true, createdAt: true } },
        vehicles: true,
        documents: { select: { documentType: true, status: true } },
      },
    });

    if (!driver) throw new NotFoundException('Driver profile not found');

    // Batch 1/2: the resume step is DERIVED from completion facts (canonical
    // order personal -> vehicle -> documents -> bank -> background ->
    // zero_tolerance -> complete), NOT read blindly from the stored cursor.
    // Legacy/obsolete stored values normalize forward with no DB rewrite and no
    // progress reset; the stored cursor is left untouched (secondary marker).
    //
    // Batch 2: the Zero Tolerance gate. The denormalized
    // Driver.zeroToleranceAcceptedVersion is compared against the current active
    // policy version so this stays a single Driver read for the resolver. The
    // gate is INERT until a policy is published (no active policy => accepted),
    // so it can never strand drivers before legal publishes one.
    const activeZtPolicy = await this.prisma.zeroTolerancePolicy.findFirst({
      where: { isActive: true },
      orderBy: { effectiveAt: 'desc' },
      select: { version: true },
    });
    const zeroToleranceAccepted =
      !activeZtPolicy || driver.zeroToleranceAcceptedVersion === activeZtPolicy.version;

    const facts: OnboardingFacts = {
      status: driver.status,
      legalFirstName: driver.legalFirstName,
      dateOfBirth: driver.dateOfBirth,
      licenseNumber: driver.licenseNumber,
      vehicleCount: driver.vehicles.length,
      documents: driver.documents,
      stripeAccountId: driver.stripeAccountId,
      backgroundCheckStatus: driver.backgroundCheckStatus,
      zeroToleranceAccepted,
    };
    const derivedStep = resolveOnboardingStep(facts);

    // Non-sensitive observability (driver id + cursor strings only — never PII,
    // license, DOB, documents, Stripe, or Checkr data).
    if (isNonCanonicalCursor(driver.onboardingStep)) {
      this.logger.log(
        `onboarding cursor obsolete/stale: driverId=${driver.id} stored=${driver.onboardingStep} derived=${derivedStep}`,
      );
    } else if (driver.onboardingStep !== derivedStep) {
      this.logger.log(
        `onboarding cursor normalized: driverId=${driver.id} stored=${driver.onboardingStep} derived=${derivedStep}`,
      );
    }

    return {
      id: driver.id,
      status: driver.status,
      onboardingStep: derivedStep,
      legalFirstName: driver.legalFirstName,
      legalLastName: driver.legalLastName,
      phone: driver.user.phone,
      email: driver.user.email,
      profilePhotoUrl: driver.user.profilePhotoUrl,
      activeVehicle: driver.vehicles.find((v) => v.isActive) ?? null,
      badge: driver.currentBadge ?? 'verified',
      totalTrips: driver.totalTrips,
      avgRating: driver.avgRating,
      isAvailable: driver.isAvailable,
      payoutBankVerified: driver.payoutBankVerified,
      memberSince: driver.user.createdAt,
    };
  }

  async submitPersonalInfo(userId: string, dto: SubmitPersonalInfoDto) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver not found');

    if (driver.status !== DriverStatus.pending) {
      throw new ConflictException('Personal info already submitted');
    }

    // Calculate age — must be 21+
    const dob = new Date(dto.dateOfBirth);
    const age = (Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (age < 21) throw new BadRequestException('Driver must be at least 21 years old');

    const licenseExpiry = new Date(dto.licenseExpiry);
    if (licenseExpiry <= new Date()) {
      throw new BadRequestException('Driver license is expired');
    }
    const insuranceExpiry = new Date(dto.insuranceExpiry);
    if (insuranceExpiry <= new Date()) {
      throw new BadRequestException('Insurance policy is expired');
    }

    // One identity per license. App-level check only (no unique constraint in
    // the schema), so a concurrent-submit race is possible but harmless: the
    // duplicate still can't pass document review for a license they don't hold.
    const licenseNumber = dto.licenseNumber.toUpperCase();
    const licenseState = dto.licenseState.toUpperCase();
    const duplicate = await this.prisma.driver.findFirst({
      where: { licenseNumber, licenseState, NOT: { userId } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('This driver license is already registered to another account');
    }

    await this.prisma.driver.update({
      where: { userId },
      data: {
        legalFirstName: dto.legalFirstName,
        legalLastName: dto.legalLastName,
        dateOfBirth: dob,
        homeAddress: dto.streetAddress,
        homeCity: dto.city,
        homeState: dto.state,
        homeZip: dto.zipCode,
        licenseNumber,
        licenseState,
        licenseExpiry,
        insuranceProvider: dto.insuranceProvider,
        insurancePolicyNumber: dto.insurancePolicyNumber,
        insuranceExpiry,
        onboardingStep: 'vehicle_info',
      },
    });

    return { success: true, nextStep: 'vehicle_info' };
  }

  async requestBackgroundCheck(userId: string, dto: RequestBackgroundCheckDto) {
    if (!dto.fcraConsentGiven) {
      throw new BadRequestException('FCRA consent is required to proceed');
    }

    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      include: { user: { select: { email: true, phone: true } } },
    });
    if (!driver) throw new NotFoundException('Driver not found');

    if (driver.backgroundCheckStatus !== BackgroundCheckStatus.not_started) {
      throw new ConflictException('Background check already initiated');
    }

    const candidateId = await this.checkrService.createCandidate({
      legalFirstName: driver.legalFirstName,
      legalLastName: driver.legalLastName,
      dateOfBirth: driver.dateOfBirth,
      homeZip: driver.homeZip,
      email: driver.user.email,
      phone: driver.user.phone,
    });

    // No DB field for candidateId — store temporarily in Redis
    await this.redis.setex(`checkr:candidate:${driver.id}`, 30 * 24 * 3600, candidateId);

    const reportId = await this.checkrService.createReport(candidateId);

    await this.prisma.driver.update({
      where: { userId },
      data: {
        backgroundCheckId: reportId,
        backgroundCheckStatus: BackgroundCheckStatus.pending,
        backgroundCheckOrderedAt: new Date(),
        // Batch 1/2: requesting the background check must NOT regress the cursor.
        // The resume step is derived from facts; after this, the next canonical
        // step is Zero Tolerance (Batch 2), not complete.
      },
    });

    return { success: true, nextStep: 'zero_tolerance' };
  }

  async updateAvailability(userId: string, dto: UpdateAvailabilityDto) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver not found');

    if (driver.status !== DriverStatus.approved) {
      throw new BadRequestException('Only approved drivers can toggle availability');
    }

    await this.prisma.driver.update({
      where: { userId },
      data: { isAvailable: dto.isAvailable },
    });

    if (dto.isAvailable && dto.currentLat && dto.currentLng) {
      // Store initial location for dispatch matching
      await this.redis.setex(
        `driver:${userId}:location`,
        DRIVER_LOCATION_TTL_SEC,
        JSON.stringify({ lat: parseFloat(dto.currentLat), lng: parseFloat(dto.currentLng) }),
      );
      await this.redis.geoadd(
        'drivers:geo',
        parseFloat(dto.currentLng),
        parseFloat(dto.currentLat),
        userId,
      );
    } else if (!dto.isAvailable) {
      await this.redis.del(`driver:${userId}:location`);
      await this.redis.zrem('drivers:geo', userId);
    }

    return { isAvailable: dto.isAvailable };
  }

  async getPerformanceStats(userId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      include: {
        driverEarnings: {
          where: {
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
          select: { amount: true, createdAt: true },
        },
        earningsFloorLogs: {
          where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
          select: { supplementAmount: true },
        },
      },
    });

    if (!driver) throw new NotFoundException('Driver not found');

    const last30DaysTakeHome = driver.driverEarnings.reduce(
      (sum, e) => sum + parseFloat(e.amount.toString()),
      0,
    );
    const floorSupplementTotal = driver.earningsFloorLogs.reduce(
      (sum, l) => sum + parseFloat(l.supplementAmount.toString()),
      0,
    );

    return {
      totalTrips: driver.totalTrips,
      avgRating: driver.avgRating,
      acceptanceRate: driver.acceptanceRate,
      completionRate: driver.completionRate,
      last30DaysTakeHome,
      floorSupplementTotal,
      badge: driver.currentBadge ?? 'verified',
    };
  }

  async setPushToken(userId: string, token: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver not found');

    await this.prisma.driver.update({
      where: { id: driver.id },
      data: { pushToken: token },
    });

    return { success: true };
  }

  // Admin endpoints below

  async listForAdmin(filters: {
    search?: string;
    status?: DriverStatus;
    page?: number;
    limit?: number;
  }) {
    const { search, status, page = 1, limit = 50 } = filters;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { legalFirstName: { contains: search, mode: 'insensitive' } },
        { legalLastName: { contains: search, mode: 'insensitive' } },
        { user: { phone: { contains: search } } },
      ];
    }

    const [drivers, total] = await this.prisma.$transaction([
      this.prisma.driver.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { phone: true } },
        },
      }),
      this.prisma.driver.count({ where }),
    ]);

    return {
      drivers: drivers.map((d) => ({
        id: d.id,
        legalFirstName: d.legalFirstName,
        legalLastName: d.legalLastName,
        phone: d.user.phone,
        status: d.status,
        appliedAt: d.createdAt,
        totalTrips: d.totalTrips,
        avgRating: d.avgRating,
        currentBadge: d.currentBadge ?? 'verified',
        backgroundCheckStatus: d.backgroundCheckStatus,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async getDriverDetailForAdmin(driverId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        user: { select: { phone: true, email: true, createdAt: true } },
        vehicles: true,
        documents: true,
        earningsFloorLogs: { take: 10, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!driver) throw new NotFoundException('Driver not found');

    // Same computation approveDriver enforces — the admin UI renders this
    // checklist and gates its Approve button on it. Phase 3B: resolve the current
    // Zero Tolerance policy version so the checklist includes it when blocking.
    const currentZeroTolerancePolicyVersion =
      await this.activation.getActiveZeroTolerancePolicyVersion();
    const missing = this.activation.computeMissingRequirements(driver, {
      currentZeroTolerancePolicyVersion,
    });
    return { ...driver, approvalRequirements: { met: missing.length === 0, missing } };
  }

  async approveDriver(driverId: string, dto: ApproveDriverDto, adminId: string) {
    // Admin approval flows through the single activation authority, so the
    // admin door and the Checkr webhook enforce the identical gate (no override
    // path — decline or wait).
    const result = await this.activation.maybeActivate(driverId, { notes: dto.notes });
    if (result.outcome === 'already_active') {
      throw new ConflictException('Driver is already approved');
    }
    if (result.outcome === 'blocked') {
      throw new BadRequestException({
        message: 'Driver does not meet approval requirements',
        code: 'APPROVAL_REQUIREMENTS_NOT_MET',
        missing: result.missing,
      });
    }
    return { success: true };
  }

  async declineDriver(driverId: string, dto: DeclineDriverDto, adminId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Driver not found');

    await this.prisma.driver.update({
      where: { id: driverId },
      data: { status: DriverStatus.declined },
    });

    // Trigger FCRA adverse action letter via notification service if background check involved
    if (dto.sendAdverseActionLetter) {
      await this.redis.publish(
        'driver:declined:fcra',
        JSON.stringify({ driverId, userId: driver.userId, reason: dto.reason }),
      );
    } else {
      await this.redis.publish(
        'driver:declined',
        JSON.stringify({ driverId, userId: driver.userId, reason: dto.reason }),
      );
    }

    return { success: true };
  }

  async suspendDriver(driverId: string, dto: SuspendDriverDto, adminId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Driver not found');

    await this.prisma.driver.update({
      where: { id: driverId },
      data: { status: DriverStatus.suspended, isAvailable: false },
    });

    // Force disconnect from dispatch pool
    await this.redis.del(`driver:${driver.userId}:location`);
    await this.redis.zrem('drivers:geo', driver.userId);

    await this.redis.publish(
      'driver:suspended',
      JSON.stringify({ driverId, userId: driver.userId, reason: dto.reason }),
    );

    return { success: true };
  }
}
