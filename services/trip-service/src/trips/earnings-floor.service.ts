import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveEffectiveDistance, DistanceSource } from './distance.util';

interface FloorResult {
  floorMet: boolean;
  floorAmount: number;
  earnedAmount: number;
  supplement: number;
  totalDriverEarnings: number;
  distanceMiles: number;
  distanceSource: DistanceSource | null;
}

/** Round a money value to whole cents. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

@Injectable()
export class EarningsFloorService {
  constructor(private readonly prisma: PrismaService) {}

  async enforce(
    trip: {
      id: string;
      driverId: string | null;
      actualDistanceMiles: unknown;
      routeDistanceMiles?: unknown;
      pickupLat?: unknown;
      pickupLng?: unknown;
      dropoffLat?: unknown;
      dropoffLng?: unknown;
    },
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

    // EarningsFloorService is the SOLE owner of effective-distance policy.
    // actualDistanceMiles is preferred only when it is a valid verified value;
    // route/haversine are honest estimates and are labeled as such. Never MAX.
    // When no valid source exists, source is null and the floor is duration+base.
    const eff = resolveEffectiveDistance({
      actualDistanceMiles: trip.actualDistanceMiles,
      routeDistanceMiles: trip.routeDistanceMiles,
      pickupLat: trip.pickupLat,
      pickupLng: trip.pickupLng,
      dropoffLat: trip.dropoffLat,
      dropoffLng: trip.dropoffLng,
    });

    // eff.miles is guaranteed finite and >= 0 by the helper. Guard duration and
    // earnings the same way so a malformed upstream value can never leak NaN or
    // Infinity into a money calculation.
    const distanceMiles = eff.miles;
    const durationMin = Number.isFinite(actualDurationMin as number)
      ? (actualDurationMin as number)
      : 0;
    const earned = Number.isFinite(driverEarnings) ? driverEarnings : 0;

    // Explicit cent rounding: round the floor and earnings before comparison so
    // floorMet is an exact whole-cent equality, not a floating-point gamble.
    const floorAmount = round2(distanceMiles * formula.per_mile + durationMin * formula.per_min + formula.base);
    const roundedEarned = round2(earned);
    const supplement = round2(Math.max(0, floorAmount - roundedEarned));
    const floorMet = supplement === 0;
    const totalDriverEarnings = round2(roundedEarned + supplement);

    if (supplement > 0 && trip.driverId) {
      await this.prisma.earningsFloorLog.create({
        data: {
          tripId: trip.id,
          driverId: trip.driverId,
          floorAmount,
          earnedAmount: roundedEarned,
          supplementAmount: supplement,
          formulaInputs: {
            distance_miles: distanceMiles,
            // Record a source only when one genuinely exists; no synthetic label.
            ...(eff.source != null ? { distance_source: eff.source } : {}),
            duration_min: durationMin,
            per_mile: formula.per_mile,
            per_min: formula.per_min,
            base: formula.base,
          },
        },
      });
    }

    return {
      floorMet,
      floorAmount,
      earnedAmount: roundedEarned,
      supplement,
      totalDriverEarnings,
      distanceMiles,
      distanceSource: eff.source,
    };
  }
}
