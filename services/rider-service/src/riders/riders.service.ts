import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database';
import { IsString, IsOptional, IsEmail, Length } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  profilePhotoUrl?: string;
}

export class SetHomeAddressDto {
  @IsString()
  label: string;

  @IsString()
  address: string;

  @IsString()
  lat: string;

  @IsString()
  lng: string;
}

@Injectable()
export class RidersService {
  private prisma = new PrismaClient();

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        rider: {
          include: {
            savedAddresses: true,
          },
        },
      },
    });

    if (!user || !user.rider) throw new NotFoundException('Rider profile not found');

    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePhotoUrl: user.profilePhotoUrl,
      badge: user.rider.currentBadge ?? 'verified',
      rewardPoints: user.rider.rewardPoints,
      savedAddresses: user.rider.savedAddresses,
      createdAt: user.createdAt,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.email && dto.email !== user.email) {
      const emailTaken = await this.prisma.user.findFirst({
        where: { email: dto.email, id: { not: userId } },
      });
      if (emailTaken) throw new ConflictException('Email already in use');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName && { firstName: dto.firstName }),
        ...(dto.lastName && { lastName: dto.lastName }),
        ...(dto.email && { email: dto.email }),
        ...(dto.profilePhotoUrl && { profilePhotoUrl: dto.profilePhotoUrl }),
      },
    });

    return { success: true };
  }

  async saveAddress(userId: string, dto: SetHomeAddressDto) {
    const rider = await this.prisma.rider.findUnique({ where: { userId } });
    if (!rider) throw new NotFoundException('Rider not found');

    await this.prisma.savedAddress.upsert({
      where: { riderId_label: { riderId: rider.id, label: dto.label } },
      create: {
        riderId: rider.id,
        label: dto.label,
        address: dto.address,
        lat: parseFloat(dto.lat),
        lng: parseFloat(dto.lng),
      },
      update: {
        address: dto.address,
        lat: parseFloat(dto.lat),
        lng: parseFloat(dto.lng),
      },
    });

    return { success: true };
  }

  async getTripHistory(userId: string, page = 1, limit = 20) {
    const rider = await this.prisma.rider.findUnique({ where: { userId } });
    if (!rider) throw new NotFoundException('Rider not found');

    const [trips, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where: { riderId: rider.id, status: { in: ['completed', 'cancelled'] } },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          pickupAddress: true,
          dropoffAddress: true,
          aiFare: true,
          finalFare: true,
          createdAt: true,
          completedAt: true,
          riderRatingDriver: true,
        },
      }),
      this.prisma.trip.count({
        where: { riderId: rider.id, status: { in: ['completed', 'cancelled'] } },
      }),
    ]);

    return { trips, total, page, pages: Math.ceil(total / limit) };
  }

  async getRewardPoints(userId: string) {
    const rider = await this.prisma.rider.findUnique({
      where: { userId },
      select: {
        rewardPoints: true,
        rewardTier: true,
      },
    });

    if (!rider) throw new NotFoundException('Rider not found');
    return rider;
  }
}
