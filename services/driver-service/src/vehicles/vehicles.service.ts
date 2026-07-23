import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database';
import { IsString, IsInt, Min, Max, IsEnum, IsOptional } from 'class-validator';

export class AddVehicleDto {
  @IsString()
  make: string;

  @IsString()
  model: string;

  @IsInt()
  @Min(2015)
  @Max(new Date().getFullYear() + 1)
  year: number;

  @IsString()
  color: string;

  @IsString()
  licensePlate: string;

  @IsString()
  licensePlateState: string;

  @IsString()
  vin: string;

  @IsEnum(['standard', 'premium', 'xl', 'black'])
  vehicleClass: string;
}

@Injectable()
export class VehiclesService {
  private prisma = new PrismaClient();

  async addVehicle(userId: string, dto: AddVehicleDto) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver not found');

    // Validate VIN uniqueness across platform
    const existing = await this.prisma.vehicle.findFirst({ where: { vin: dto.vin } });
    if (existing) throw new BadRequestException('This vehicle is already registered on the platform');

    const currentYear = new Date().getFullYear();
    if (dto.year < currentYear - 10) {
      throw new BadRequestException('Vehicle must be no more than 10 years old');
    }

    const vehicle = await this.prisma.vehicle.create({
      data: {
        driverId: driver.id,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        color: dto.color,
        licensePlate: dto.licensePlate,
        licensePlateState: dto.licensePlateState,
        vin: dto.vin,
        vehicleClass: dto.vehicleClass as any,
        isActive: true,
        inspectionStatus: 'pending',
      },
    });

    // Batch 1: advance the onboarding cursor to Documents. Inspection is an
    // administrative Vehicle attribute (inspectionStatus), NOT an onboarding
    // cursor step.
    if (driver.onboardingStep === 'vehicle_info') {
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: { onboardingStep: 'document_upload' },
      });
    }

    return vehicle;
  }

  async listVehicles(userId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver not found');

    return this.prisma.vehicle.findMany({
      where: { driverId: driver.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setActiveVehicle(userId: string, vehicleId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver not found');

    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle || vehicle.driverId !== driver.id) {
      throw new ForbiddenException('Vehicle not found or not owned by this driver');
    }

    if (vehicle.inspectionStatus !== 'passed') {
      throw new BadRequestException('Vehicle must pass inspection before it can be made active');
    }

    await this.prisma.$transaction([
      this.prisma.vehicle.updateMany({
        where: { driverId: driver.id },
        data: { isActive: false },
      }),
      this.prisma.vehicle.update({
        where: { id: vehicleId },
        data: { isActive: true },
      }),
    ]);

    return { success: true };
  }

  async approveInspection(vehicleId: string, adminId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        inspectionStatus: 'passed',
        inspectionDate: new Date(),
        inspectionExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        isActive: true,
      },
    });

    // Batch 1: inspection is administrative and no longer advances the
    // onboarding cursor (it is tracked on Vehicle.inspectionStatus). Driver
    // resume is derived from completion facts, so a passed inspection needs no
    // cursor write here.
    return { success: true };
  }

  async failInspection(vehicleId: string, reason: string, adminId: string) {
    await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { inspectionStatus: 'failed' },
    });

    return { success: true };
  }
}
