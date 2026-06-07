import { Injectable } from '@nestjs/common';
import { PrismaClient, TripStatus } from '@bidride/database';

@Injectable()
export class AnalyticsService {
  private prisma = new PrismaClient();

  async getDashboardMetrics() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      activeTrips,
      todayTrips,
      weekTrips,
      monthTrips,
      todayGmv,
      monthGmv,
      activeDrivers,
      pendingDrivers,
      openSosSessions,
    ] = await this.prisma.$transaction([
      this.prisma.trip.count({ where: { status: { in: [TripStatus.in_progress, TripStatus.driver_en_route, TripStatus.driver_arrived] } } }),
      this.prisma.trip.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.trip.count({ where: { createdAt: { gte: weekStart } } }),
      this.prisma.trip.count({ where: { createdAt: { gte: monthStart } } }),
      this.prisma.trip.aggregate({
        where: { status: TripStatus.completed, completedAt: { gte: todayStart } },
        _sum: { finalFare: true },
      }),
      this.prisma.trip.aggregate({
        where: { status: TripStatus.completed, completedAt: { gte: monthStart } },
        _sum: { finalFare: true },
      }),
      this.prisma.driver.count({ where: { isAvailable: true, status: 'approved' } }),
      this.prisma.driver.count({ where: { status: { in: ['pending', 'under_review'] } } }),
      this.prisma.safetySession.count({ where: { currentState: { in: ['sos_active'] } } }),
    ]);

    return {
      activeTrips,
      todayTrips,
      weekTrips,
      monthTrips,
      todayGmv: todayGmv._sum.finalFare ?? 0,
      monthGmv: monthGmv._sum.finalFare ?? 0,
      activeDrivers,
      pendingDrivers,
      openSosSessions,
    };
  }

  async getRevenueTimeSeries(period: 'day' | 'week' | 'month' = 'week') {
    const days = period === 'day' ? 1 : period === 'week' ? 7 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const trips = await this.prisma.trip.findMany({
      where: {
        status: TripStatus.completed,
        completedAt: { gte: since },
      },
      select: { completedAt: true, finalFare: true, platformFee: true },
      orderBy: { completedAt: 'asc' },
    });

    // Group by date
    const byDate: Record<string, { gmv: number; revenue: number; trips: number }> = {};
    for (const trip of trips) {
      const key = trip.completedAt!.toISOString().slice(0, 10);
      if (!byDate[key]) byDate[key] = { gmv: 0, revenue: 0, trips: 0 };
      byDate[key].gmv += parseFloat(trip.finalFare?.toString() ?? '0');
      byDate[key].revenue += parseFloat(trip.platformFee?.toString() ?? '0');
      byDate[key].trips += 1;
    }

    return Object.entries(byDate).map(([date, data]) => ({ date, ...data }));
  }

  async getEarningsFloorImpact(period: 'week' | 'month' = 'month') {
    const since = new Date(
      Date.now() - (period === 'week' ? 7 : 30) * 24 * 60 * 60 * 1000,
    );

    const logs = await this.prisma.earningsFloorLog.findMany({
      where: { createdAt: { gte: since } },
      select: { supplementAmount: true, createdAt: true },
    });

    const total = logs.reduce((sum, l) => sum + parseFloat(l.supplementAmount.toString()), 0);

    return {
      totalSupplement: total,
      tripsAffected: logs.length,
      avgSupplement: logs.length > 0 ? total / logs.length : 0,
    };
  }

  async getTripHeatmap(lat: number, lng: number, radiusMiles: number) {
    // Returns trip pickup locations for a geographic area for heatmap display
    const radiusDegrees = radiusMiles / 69;
    const trips = await this.prisma.trip.findMany({
      where: {
        status: TripStatus.completed,
        pickupLat: { gte: lat - radiusDegrees, lte: lat + radiusDegrees },
        pickupLng: { gte: lng - radiusDegrees, lte: lng + radiusDegrees },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      select: { pickupLat: true, pickupLng: true },
      take: 500,
    });

    return trips;
  }
}
