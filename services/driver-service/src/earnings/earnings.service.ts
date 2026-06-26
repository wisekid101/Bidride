import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database';

@Injectable()
export class EarningsService {
  private prisma = new PrismaClient();

  async getToday(userId: string) {
    const driver = await this.findDriver(userId);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [earnings, wallet] = await Promise.all([
      this.prisma.driverEarning.findMany({
        where: { driverId: driver.id, createdAt: { gte: startOfDay } },
        select: { amount: true },
      }),
      this.prisma.driverWallet.findUnique({
        where: { driverId: driver.id },
        select: { pendingBalance: true, availableBalance: true, lifetimeEarnings: true },
      }),
    ]);

    const takeHome = earnings.reduce((s, e) => s + Number(e.amount), 0);
    const tripCount = earnings.length;

    return {
      takeHome,
      tripCount,
      tips: 0,
      pendingWallet: Number(wallet?.pendingBalance ?? 0),
      availableWallet: Number(wallet?.availableBalance ?? 0),
      lifetimeEarnings: Number(wallet?.lifetimeEarnings ?? 0),
      periodLabel: 'Today',
    };
  }

  async getWeek(userId: string) {
    const driver = await this.findDriver(userId);
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [earnings, wallet] = await Promise.all([
      this.prisma.driverEarning.findMany({
        where: { driverId: driver.id, createdAt: { gte: startOfWeek } },
        select: { amount: true },
      }),
      this.prisma.driverWallet.findUnique({
        where: { driverId: driver.id },
        select: { pendingBalance: true, availableBalance: true, lifetimeEarnings: true },
      }),
    ]);

    const takeHome = earnings.reduce((s, e) => s + Number(e.amount), 0);
    const tripCount = earnings.length;

    return {
      takeHome,
      tripCount,
      tips: 0,
      pendingWallet: Number(wallet?.pendingBalance ?? 0),
      availableWallet: Number(wallet?.availableBalance ?? 0),
      lifetimeEarnings: Number(wallet?.lifetimeEarnings ?? 0),
      periodLabel: 'This Week',
    };
  }

  async getHistory(userId: string, limit: number, offset: number) {
    const driver = await this.findDriver(userId);

    const [total, earnings] = await Promise.all([
      this.prisma.driverEarning.count({ where: { driverId: driver.id } }),
      this.prisma.driverEarning.findMany({
        where: { driverId: driver.id },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: { id: true, tripId: true, amount: true, createdAt: true },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      earnings: earnings.map((e) => ({
        id: e.id,
        tripId: e.tripId,
        amount: Number(e.amount),
        date: e.createdAt.toISOString(),
      })),
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
