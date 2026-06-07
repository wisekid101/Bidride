import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface FloorResult {
  floorMet: boolean;
  floorAmount: number;
  earnedAmount: number;
  supplement: number;
  totalDriverEarnings: number;
}

@Injectable()
export class EarningsFloorService {
  constructor(private readonly prisma: PrismaService) {}

  async enforce(
    trip: { id: string; driverId: string | null; actualDistanceMiles: unknown },
    driverEarnings: number,
    actualDurationMin: number | null,
  ): Promise<FloorResult> {
    const config = await this.prisma.platformConfig.findUnique({
      where: { key: 'earnings_floor_formula' },
    });

    const formula = config?.value as { per_mile: number; per_min: number; base: number } ?? {
      per_mile: 1.10,
      per_min: 0.22,
      base: 2.50,
    };

    const distanceMiles = Number(trip.actualDistanceMiles ?? 0);
    const durationMin = actualDurationMin ?? 0;

    const floorAmount =
      distanceMiles * formula.per_mile +
      durationMin * formula.per_min +
      formula.base;

    const supplement = Math.max(0, floorAmount - driverEarnings);
    const floorMet = supplement === 0;
    const totalDriverEarnings = driverEarnings + supplement;

    if (supplement > 0 && trip.driverId) {
      await this.prisma.earningsFloorLog.create({
        data: {
          tripId: trip.id,
          driverId: trip.driverId,
          floorAmount,
          earnedAmount: driverEarnings,
          supplementAmount: supplement,
          formulaInputs: {
            distance_miles: distanceMiles,
            duration_min: durationMin,
            per_mile: formula.per_mile,
            per_min: formula.per_min,
            base: formula.base,
          },
        },
      });
    }

    return { floorMet, floorAmount, earnedAmount: driverEarnings, supplement, totalDriverEarnings };
  }
}
