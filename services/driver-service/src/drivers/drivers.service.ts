import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
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

@Injectable()
export class DriversService {
  private prisma = new PrismaClient();
  private redis: Redis;

  constructor(private readonly checkrService: CheckrService) {
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
        vehicles: { where: { isActive: true }, take: 1 },
      },
    });

    if (!driver) throw new NotFoundException('Driver profile not found');

    return {
      id: driver.id,
      status: driver.status,
      onboardingStep: driver.onboardingStep,
      legalFirstName: driver.legalFirstName,
      legalLastName: driver.legalLastName,
      phone: driver.user.phone,
      email: driver.user.email,
      profilePhotoUrl: driver.user.profilePhotoUrl,
      activeVehicle: driver.vehicles[0] ?? null,
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
        onboardingStep: 'document_upload',
      },
    });

    return { success: true, nextStep: 'document_upload' };
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
        onboardingStep: 'vehicle_info',
      },
    });

    return { success: true, nextStep: 'vehicle_info' };
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
        300,
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
    // checklist and gates its Approve button on it.
    const missing = this.computeMissingRequirements(driver);
    return { ...driver, approvalRequirements: { met: missing.length === 0, missing } };
  }

  // Each entry lists the accepted documentType spellings for one required doc
  // (the app uploads 'insurance'/'registration'; the schema enum names them
  // 'insurance_card'/'vehicle_registration').
  private static readonly REQUIRED_DOCUMENTS: Array<{ label: string; types: string[] }> = [
    { label: 'drivers_license', types: ['drivers_license'] },
    { label: 'insurance_card', types: ['insurance', 'insurance_card'] },
    { label: 'vehicle_registration', types: ['registration', 'vehicle_registration'] },
  ];

  private computeMissingRequirements(driver: {
    documents: Array<{ documentType: string; status: string }>;
    vehicles: Array<{ isActive: boolean }>;
    backgroundCheckStatus: BackgroundCheckStatus;
    insuranceProvider: string | null;
    insurancePolicyNumber: string | null;
    insuranceExpiry: Date | null;
  }): string[] {
    const missing: string[] = [];
    for (const req of DriversService.REQUIRED_DOCUMENTS) {
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

  async approveDriver(driverId: string, dto: ApproveDriverDto, adminId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        documents: { select: { documentType: true, status: true } },
        vehicles: { select: { isActive: true } },
      },
    });
    if (!driver) throw new NotFoundException('Driver not found');

    if (driver.status === DriverStatus.approved) {
      throw new ConflictException('Driver is already approved');
    }

    // Production gate: an admin cannot approve a driver who hasn't cleared
    // every onboarding requirement. No override path — decline or wait.
    const missing = this.computeMissingRequirements(driver);
    if (missing.length > 0) {
      throw new BadRequestException({
        message: 'Driver does not meet approval requirements',
        code: 'APPROVAL_REQUIREMENTS_NOT_MET',
        missing,
      });
    }

    await this.prisma.driver.update({
      where: { id: driverId },
      data: { status: DriverStatus.approved, onboardingStep: 'complete' },
    });

    await this.redis.publish(
      'driver:approved',
      JSON.stringify({ driverId, userId: driver.userId, notes: dto.notes }),
    );

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
