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
        user: { select: { phone: true, email: true, profilePhotoUrl: true } },
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
        `driver:location:${driver.id}`,
        300,
        JSON.stringify({ lat: parseFloat(dto.currentLat), lng: parseFloat(dto.currentLng) }),
      );
      await this.redis.geoadd(
        'drivers:geo',
        parseFloat(dto.currentLng),
        parseFloat(dto.currentLat),
        driver.id,
      );
    } else if (!dto.isAvailable) {
      await this.redis.del(`driver:location:${driver.id}`);
      await this.redis.zrem('drivers:geo', driver.id);
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

    return driver;
  }

  async approveDriver(driverId: string, dto: ApproveDriverDto, adminId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Driver not found');

    if (driver.status === DriverStatus.approved) {
      throw new ConflictException('Driver is already approved');
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
    await this.redis.del(`driver:location:${driverId}`);
    await this.redis.zrem('drivers:geo', driverId);

    await this.redis.publish(
      'driver:suspended',
      JSON.stringify({ driverId, userId: driver.userId, reason: dto.reason }),
    );

    return { success: true };
  }
}
