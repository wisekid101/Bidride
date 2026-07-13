import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { QualityClassService } from '../quality/quality-class.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  FEATURE_REGISTRY,
  FEATURE_TTL_SEC,
  PROJECTION_INTERVAL_MS,
  FeatureSpec,
} from './feature-registry';

// Phase 6 — projection jobs ONLY. Reads authoritative stores, writes derived
// feature values to Redis (ai:feature:*) with a bounded TTL. Nothing here
// makes decisions; consumers are the (shadowed) prediction modules and the
// future founder dashboard. Monetary features are quality-gated to trips
// whose latest data_quality_classified event is 'trusted'.
const EWR_ZONE = `${Math.floor(40.6895 / 0.018)}:${Math.floor(-74.1745 / 0.022)}`;
const WINDOW_DAYS = 7;
const MIN_SAMPLE = 5;

@Injectable()
export class FeatureStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeatureStoreService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly quality: QualityClassService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  onModuleInit(): void {
    if (!this.redis) {
      this.logger.warn('feature store: no Redis client — projection job disabled');
      return;
    }
    this.timer = setInterval(() => {
      this.projectAll().catch((e: unknown) => this.logger.error('feature projection failed', e));
    }, PROJECTION_INTERVAL_MS);
    // First projection shortly after boot (don't block module init).
    setTimeout(() => this.projectAll().catch(() => {}), 3_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async projectAll(): Promise<void> {
    if (!this.redis) return;
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);

    await Promise.all([
      this.projectZoned('demand', 'surge:requests:*'),
      this.projectSupply(),
      this.projectAcceptanceRate(since),
      this.projectCancellationRate(since),
      this.projectDriverUtilization(),
      this.projectAirportDemand(),
      this.projectCustomerSavings(since),
      this.projectMoneyAverages(since),
    ]);
  }

  /**
   * Trusted-only gate for monetary features, read via the shared bounded
   * QualityClassService (never a full classification-history scan).
   */
  private async trustedSubset(tripIds: string[]): Promise<Set<string>> {
    const classes = await this.quality.classesFor(tripIds);
    return new Set([...classes.entries()].filter(([, c]) => c === 'trusted').map(([id]) => id));
  }

  private async write(name: string, value: unknown, zone?: string): Promise<void> {
    if (!this.redis) return;
    const key = zone ? `ai:feature:${name}:${zone}` : `ai:feature:${name}`;
    await this.redis
      .setex(key, FEATURE_TTL_SEC, JSON.stringify({ value, computedAt: new Date().toISOString() }))
      .catch(() => {});
  }

  private async projectZoned(feature: string, pattern: string): Promise<void> {
    const keys = await this.redis!.keys(pattern).catch(() => [] as string[]);
    for (const key of keys) {
      const zone = key.split(':').slice(-2).join(':');
      const raw = await this.redis!.get(key).catch(() => null);
      const value = raw ? parseInt(raw, 10) : 0;
      if (Number.isFinite(value) && value >= 0) await this.write(feature, value, zone);
    }
  }

  private async projectSupply(): Promise<void> {
    const keys = await this.redis!.keys('surge:drivers:*').catch(() => [] as string[]);
    for (const key of keys) {
      const zone = key.split(':').slice(-2).join(':');
      const count = await this.redis!.scard(key).catch(() => 0);
      await this.write('supply', count, zone);
    }
  }

  private async projectAcceptanceRate(since: Date): Promise<void> {
    const [total, accepted] = await Promise.all([
      this.prisma.bidOutcome.count({ where: { createdAt: { gte: since } } }),
      this.prisma.bidOutcome.count({ where: { createdAt: { gte: since }, wasAccepted: true } }),
    ]);
    await this.write('acceptance_rate', total >= MIN_SAMPLE ? round4(accepted / total) : null);
  }

  private async projectCancellationRate(since: Date): Promise<void> {
    const [cancelled, completed] = await Promise.all([
      this.prisma.trip.count({ where: { createdAt: { gte: since }, status: 'cancelled' } }),
      this.prisma.trip.count({ where: { createdAt: { gte: since }, status: 'completed' } }),
    ]);
    const terminal = cancelled + completed;
    await this.write('cancellation_rate', terminal >= MIN_SAMPLE ? round4(cancelled / terminal) : null);
  }

  private async projectDriverUtilization(): Promise<void> {
    const [inProgress, online] = await Promise.all([
      this.prisma.trip.count({ where: { status: 'in_progress' } }),
      this.prisma.driver.count({ where: { isAvailable: true } }),
    ]);
    await this.write('driver_utilization', online > 0 ? round4(Math.min(1, inProgress / online)) : null);
  }

  private async projectAirportDemand(): Promise<void> {
    const raw = await this.redis!.get(`surge:requests:${EWR_ZONE}`).catch(() => null);
    await this.write('airport_demand', raw ? parseInt(raw, 10) : 0);
  }

  private async projectCustomerSavings(since: Date): Promise<void> {
    const bidTrips = await this.prisma.trip.findMany({
      where: { status: 'completed', bidId: { not: null }, completedAt: { gte: since } },
      select: { id: true, aiFare: true, finalFare: true },
    });
    const trusted = await this.trustedSubset(bidTrips.map((t) => t.id));
    let savings = 0;
    for (const t of bidTrips) {
      if (!trusted.has(t.id) || t.finalFare == null) continue; // quality gate
      savings += Number(t.aiFare) - Number(t.finalFare);
    }
    await this.write('customer_savings', round2(Math.max(0, savings)));
  }

  private async projectMoneyAverages(since: Date): Promise<void> {
    const trips = await this.prisma.trip.findMany({
      where: { status: 'completed', completedAt: { gte: since } },
      select: { id: true, finalFare: true, driverEarnings: true },
    });
    const trusted = await this.trustedSubset(trips.map((t) => t.id));
    const gated = trips.filter((t) => trusted.has(t.id) && t.finalFare != null);
    if (gated.length >= MIN_SAMPLE) {
      const avgFare = gated.reduce((s, t) => s + Number(t.finalFare), 0) / gated.length;
      const withEarnings = gated.filter((t) => t.driverEarnings != null);
      const avgEarnings = withEarnings.length
        ? withEarnings.reduce((s, t) => s + Number(t.driverEarnings), 0) / withEarnings.length
        : null;
      await this.write('average_fare', round2(avgFare));
      await this.write('driver_earnings_avg', avgEarnings != null ? round2(avgEarnings) : null);
    } else {
      await this.write('average_fare', null);
      await this.write('driver_earnings_avg', null);
    }
  }

  async snapshot(): Promise<{
    registry: FeatureSpec[];
    values: Record<string, unknown>;
  }> {
    const values: Record<string, unknown> = {};
    if (this.redis) {
      const keys = await this.redis.keys('ai:feature:*').catch(() => [] as string[]);
      for (const key of keys) {
        const raw = await this.redis.get(key).catch(() => null);
        if (raw) {
          try { values[key.replace('ai:feature:', '')] = JSON.parse(raw); } catch { /* skip */ }
        }
      }
    }
    return { registry: FEATURE_REGISTRY, values };
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
