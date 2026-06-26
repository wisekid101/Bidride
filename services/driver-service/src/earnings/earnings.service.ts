import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database';

@Injectable()
export class EarningsService {
  private prisma = new PrismaClient();

  async getToday(userId: string) {
    const driver = await this.findDriver(userId);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.buildSummary(driver.id, startOfDay, 'Today');
  }

  async getWeek(userId: string) {
    const driver = await this.findDriver(userId);
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    return this.buildSummary(driver.id, startOfWeek, 'This Week');
  }

  async getHistory(userId: string, limit: number, offset: number) {
    const driver = await this.findDriver(userId);

    const trips = await this.prisma.trip.findMany({
      where: { driverId: driver.id, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true,
        completedAt: true,
        pickupAddress: true,
        dropoffAddress: true,
        driverEarnings: true,
        earningsSupplement: true,
        driverRatingRider: true,
      },
    });

    return trips.map((t) => ({
      id: t.id,
      completedAt: t.completedAt?.toISOString() ?? '',
      pickupArea: t.pickupAddress.split(',')[0].trim(),
      dropoffArea: t.dropoffAddress.split(',')[0].trim(),
      takeHome: Number(t.driverEarnings ?? 0) + Number(t.earningsSupplement ?? 0),
      floorSupplement: Number(t.earningsSupplement ?? 0),
      ratingGiven: t.driverRatingRider ?? null,
    }));
  }

  private async buildSummary(driverId: string, since: Date, periodLabel: string) {
    const [trips, wallet] = await Promise.all([
      this.prisma.trip.findMany({
        where: { driverId, status: 'completed', completedAt: { gte: since } },
        select: {
          driverEarnings: true,
          earningsSupplement: true,
          earningsFloorMet: true,
        },
      }),
      this.prisma.driverWallet.findUnique({
        where: { driverId },
        select: { pendingBalance: true, availableBalance: true, lifetimeEarnings: true },
      }),
    ]);

    const takeHome = trips.reduce(
      (s, t) => s + Number(t.driverEarnings ?? 0) + Number(t.earningsSupplement ?? 0),
      0,
    );
    const floorTriggeredCount = trips.filter((t) => !t.earningsFloorMet).length;
    const floorSupplements = trips.reduce(
      (s, t) => (t.earningsFloorMet ? s : s + Number(t.earningsSupplement ?? 0)),
      0,
    );

    return {
      takeHome,
      trips: trips.length,
      tips: 0,
      hoursOnline: 0,
      floorSupplements,
      floorTriggeredCount,
      rewardBonuses: 0,
      pendingWallet: Number(wallet?.pendingBalance ?? 0),
      availableWallet: Number(wallet?.availableBalance ?? 0),
      lifetimeEarnings: Number(wallet?.lifetimeEarnings ?? 0),
      periodLabel,
    };
  }

  private async findDriver(userId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) throw new NotFoundException('Driver not found');
    return driver;
  }
}
