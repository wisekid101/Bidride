import { Injectable, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { InferenceLogService } from '../services/inference-log.service';
import { DriverRankingEngine, DriverRankingResult, RANKING_VERSION } from './driver-ranking.engine';

export interface RankDriversInput {
  tripId: string;
  isAirportTrip: boolean;
  riderUserId?: string;
  candidates: Array<{
    driverUserId: string;
    distanceMiles: number;
    etaMinutes: number;
  }>;
}

@Injectable()
export class DriverRankingService {
  constructor(
    private readonly engine: DriverRankingEngine,
    private readonly prisma: PrismaService,
    private readonly inferenceLog: InferenceLogService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  async rankDrivers(input: RankDriversInput): Promise<DriverRankingResult[]> {
    const userIds = input.candidates.map((c) => c.driverUserId);

    type DriverRow = {
      userId: string;
      avgRating: unknown;
      acceptanceRate: unknown;
      completionRate: unknown;
      totalTrips: number;
      user: { trustScore: { trustScore: number } | null } | null;
    };

    // Enrich from DB in one query
    const drivers: DriverRow[] = await this.prisma.driver.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        avgRating: true,
        acceptanceRate: true,
        completionRate: true,
        totalTrips: true,
        user: {
          select: {
            trustScore: { select: { trustScore: true } },
          },
        },
      },
    }).catch(() => [] as DriverRow[]);

    const driverMap = new Map(drivers.map((d) => [d.userId, d]));

    // Redis enrichment (hours online, response time)
    const hoursMap = await this.getHoursOnline(userIds);

    // Build enriched candidates
    const enriched = input.candidates.map((c) => {
      const d = driverMap.get(c.driverUserId);
      return {
        driverUserId: c.driverUserId,
        distanceMiles: c.distanceMiles,
        etaMinutes: c.etaMinutes,
        trustScore: d?.user?.trustScore?.trustScore ?? 500,
        acceptanceRate: d ? Number(d.acceptanceRate) : 0.7,
        cancellationRate: d ? Math.max(0, 1 - Number(d.completionRate)) : 0.05,
        avgRating: d ? Number(d.avgRating) : 4.0,
        hasAirportExperience: d ? (d.totalTrips > 30) : false,
        hoursOnline: hoursMap.get(c.driverUserId) ?? 0,
      };
    });

    const ranked = this.engine.rank(enriched, input.isAirportTrip);

    // Fire-and-forget: log each ranking decision
    for (const r of ranked) {
      this.inferenceLog.log({
        modelName: 'driver-ranking',
        modelVersion: RANKING_VERSION,
        inputFeatures: {
          tripId: input.tripId,
          isAirportTrip: input.isAirportTrip,
          ...r.signals,
        },
        output: { score: r.score, rank: r.rank } as Record<string, unknown>,
        confidence: 0.8,
        fallbackUsed: false,
        latencyMs: 0,
        tripId: input.tripId,
        userId: r.driverUserId,
      });
    }

    return ranked;
  }

  private async getHoursOnline(userIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!this.redis) return map;

    await Promise.all(
      userIds.map(async (uid) => {
        const startTs = await this.redis!.get(`driver:${uid}:session_start`).catch(() => null);
        if (startTs) {
          const hours = (Date.now() - parseInt(startTs, 10)) / 3600000;
          map.set(uid, Math.max(0, hours));
        }
      }),
    );
    return map;
  }
}
