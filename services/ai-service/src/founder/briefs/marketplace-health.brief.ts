import { Injectable, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { BriefSection, FounderBrief } from './brief.types';
import {
  BRIEFS_SOURCE_VERSION, briefWindow, changePct, metric, moneyEligible, round2, zoneKey,
} from './brief-helpers';
import { QualityClassService } from '../../quality/quality-class.service';
import { MIN_SAMPLE_SIZE } from '../../recommendations/recommendation.types';

// ─── BRIEF 1 — Marketplace Health ─────────────────────────────────────────────
// Read-only. Every number carries window, sample size, source, comparison
// period, and a quality label. Monetary averages are Trusted/Reconciled only.

@Injectable()
export class MarketplaceHealthBrief {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quality: QualityClassService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  async generate(now = new Date()): Promise<FounderBrief> {
    const w = briefWindow(7, now);
    const insufficient: string[] = [];

    const [completed, completedPrev, cancelled, cancelledPrev] = await Promise.all([
      this.prisma.trip.findMany({
        where: { status: 'completed', completedAt: { gte: w.start, lte: w.end } },
        select: { id: true, finalFare: true, driverEarnings: true, earningsSupplement: true, pickupLat: true, pickupLng: true, isAirportTrip: true, createdAt: true, acceptedAt: true },
      }),
      this.prisma.trip.count({ where: { status: 'completed', completedAt: { gte: w.prevStart, lt: w.prevEnd } } }),
      this.prisma.trip.count({ where: { status: 'cancelled', cancelledAt: { gte: w.start, lte: w.end } } }),
      this.prisma.trip.count({ where: { status: 'cancelled', cancelledAt: { gte: w.prevStart, lt: w.prevEnd } } }),
    ]);
    // Bounded quality read: only the completed trips in this window.
    const qualityClasses = await this.quality.classesFor(completed.map((t) => t.id));

    const terminal = completed.length + cancelled;
    const completionRate = terminal > 0 ? round2((completed.length / terminal) * 100) : null;

    // Monetary averages: Trusted/Reconciled classes only.
    const moneyTrips = completed.filter((t) => moneyEligible(qualityClasses, t.id) && t.finalFare != null);
    const avgFare = moneyTrips.length
      ? round2(moneyTrips.reduce((s, t) => s + Number(t.finalFare), 0) / moneyTrips.length)
      : null;
    const takeHomeTrips = moneyTrips.filter((t) => t.driverEarnings != null);
    const avgTakeHome = takeHomeTrips.length
      ? round2(takeHomeTrips.reduce((s, t) => s + Number(t.driverEarnings) + Number(t.earningsSupplement ?? 0), 0) / takeHomeTrips.length)
      : null;

    // Match time: created → accepted on trips accepted in the window.
    const accepted = await this.prisma.trip.findMany({
      where: { acceptedAt: { gte: w.start, lte: w.end } },
      select: { createdAt: true, acceptedAt: true },
    });
    const matchSecs = accepted
      .map((t) => (t.acceptedAt!.getTime() - t.createdAt.getTime()) / 1000)
      .filter((s) => s >= 0 && s < 3600);
    const avgMatchSec = matchSecs.length ? round2(matchSecs.reduce((a, b) => a + b, 0) / matchSecs.length) : null;

    // Offers.
    const [offersTotal, offersAccepted, counterBids] = await Promise.all([
      this.prisma.bidOutcome.count({ where: { createdAt: { gte: w.start, lte: w.end } } }),
      this.prisma.bidOutcome.count({ where: { createdAt: { gte: w.start, lte: w.end }, wasAccepted: true } }),
      this.prisma.bid.findMany({
        where: { counterOffer: { not: null }, createdAt: { gte: w.start, lte: w.end } },
        select: { status: true },
      }),
    ]);
    const counterAccepted = counterBids.filter((b) => b.status === 'accepted').length;

    // Airport demand.
    const airportTrips = completed.filter((t) => t.isAirportTrip).length;
    const airportRequested = await this.prisma.trip.count({
      where: { isAirportTrip: true, createdAt: { gte: w.start, lte: w.end } },
    });

    // Zone tables — demand/supply are live Redis snapshots; growth is Postgres.
    const zoneCounts = new Map<string, number>();
    const allWindowTrips = await this.prisma.trip.findMany({
      where: { createdAt: { gte: w.start, lte: w.end } },
      select: { pickupLat: true, pickupLng: true },
    });
    for (const t of allWindowTrips) {
      const z = zoneKey(Number(t.pickupLat), Number(t.pickupLng));
      zoneCounts.set(z, (zoneCounts.get(z) ?? 0) + 1);
    }
    const prevZoneCounts = new Map<string, number>();
    const prevTrips = await this.prisma.trip.findMany({
      where: { createdAt: { gte: w.prevStart, lt: w.prevEnd } },
      select: { pickupLat: true, pickupLng: true },
    });
    for (const t of prevTrips) {
      const z = zoneKey(Number(t.pickupLat), Number(t.pickupLng));
      prevZoneCounts.set(z, (prevZoneCounts.get(z) ?? 0) + 1);
    }
    const growth = [...zoneCounts.entries()]
      .map(([zone, n]) => ({ zone, requests: n, previous: prevZoneCounts.get(zone) ?? 0, growthPct: changePct(n, prevZoneCounts.get(zone) ?? 0) }))
      .sort((a, b) => (b.growthPct ?? -Infinity) - (a.growthPct ?? -Infinity));
    const growingZones = growth.filter((g) => g.requests >= MIN_SAMPLE_SIZE).slice(0, 5);
    const thinZones = growth.filter((g) => g.requests < MIN_SAMPLE_SIZE).map((g) => g.zone);

    const liveSupply: Array<{ zone: string; drivers: number }> = [];
    const liveDemand: Array<{ zone: string; requests: number }> = [];
    if (this.redis) {
      const supplyKeys = await this.redis.keys('surge:drivers:*').catch(() => [] as string[]);
      for (const key of supplyKeys) {
        liveSupply.push({ zone: key.split(':').slice(-2).join(':'), drivers: await this.redis.scard(key).catch(() => 0) });
      }
      const demandKeys = await this.redis.keys('surge:requests:*').catch(() => [] as string[]);
      for (const key of demandKeys) {
        const raw = await this.redis.get(key).catch(() => null);
        liveDemand.push({ zone: key.split(':').slice(-2).join(':'), requests: raw ? parseInt(raw, 10) : 0 });
      }
    }

    const sections: BriefSection[] = [
      {
        title: 'Rides',
        metrics: [
          metric({ name: 'completed_rides', value: completed.length, window: w.label, sampleSize: completed.length, source: 'trips.status=completed (canonical)', qualityLabel: 'canonical_all', isCount: true, comparison: { period: w.prevLabel, value: completedPrev, changePct: changePct(completed.length, completedPrev) } }),
          metric({ name: 'cancelled_rides', betterWhen: 'down', value: cancelled, window: w.label, sampleSize: cancelled, source: 'trips.status=cancelled (canonical)', qualityLabel: 'canonical_all', isCount: true, comparison: { period: w.prevLabel, value: cancelledPrev, changePct: changePct(cancelled, cancelledPrev) } }),
          metric({ name: 'completion_rate', value: completionRate, unit: '%', window: w.label, sampleSize: terminal, source: 'trips (canonical)', qualityLabel: 'canonical_all' }),
          metric({ name: 'avg_match_time', value: avgMatchSec, unit: 'sec', window: w.label, sampleSize: matchSecs.length, source: 'trips.createdAt→acceptedAt (canonical)', qualityLabel: 'canonical_all' }),
        ],
      },
      {
        title: 'Money (canonical, Trusted/Reconciled only)',
        metrics: [
          metric({ name: 'average_fare', value: avgFare, unit: 'USD', window: w.label, sampleSize: moneyTrips.length, source: 'trips.finalFare (canonical, quality-gated)', qualityLabel: 'canonical_trusted' }),
          metric({ name: 'average_driver_take_home', value: avgTakeHome, unit: 'USD', window: w.label, sampleSize: takeHomeTrips.length, source: 'trips.driverEarnings + trips.earningsSupplement (canonical, quality-gated)', qualityLabel: 'canonical_trusted' }),
        ],
      },
      {
        title: 'Offers',
        metrics: [
          metric({ name: 'offer_acceptance', value: offersTotal ? round2((offersAccepted / offersTotal) * 100) : null, unit: '%', window: w.label, sampleSize: offersTotal, source: 'bid_outcomes (operational)', qualityLabel: 'operational' }),
          metric({ name: 'counter_offer_acceptance', value: counterBids.length ? round2((counterAccepted / counterBids.length) * 100) : null, unit: '%', window: w.label, sampleSize: counterBids.length, source: 'bids.counterOffer/status (canonical)', qualityLabel: 'canonical_all' }),
        ],
      },
      {
        title: 'Airport',
        metrics: [
          metric({ name: 'airport_trips_requested', value: airportRequested, window: w.label, sampleSize: airportRequested, source: 'trips.isAirportTrip (canonical)', qualityLabel: 'canonical_all', isCount: true }),
          metric({ name: 'airport_trips_completed', value: airportTrips, window: w.label, sampleSize: airportTrips, source: 'trips.isAirportTrip + status=completed (canonical)', qualityLabel: 'canonical_all', isCount: true }),
        ],
      },
      {
        title: 'Zones',
        metrics: [],
        zoneTable: {
          columns: ['zone', 'requests', 'previous', 'growthPct'],
          rows: growingZones.map((g) => ({ zone: g.zone, requests: g.requests, previous: g.previous, growthPct: g.growthPct })),
        },
        notes: [
          `live supply snapshot (Redis, point-in-time): ${liveSupply.length ? liveSupply.map((s) => `${s.zone}=${s.drivers}`).join(', ') : 'no online drivers right now'}`,
          `live demand snapshot (Redis, point-in-time): ${liveDemand.length ? liveDemand.map((d) => `${d.zone}=${d.requests}`).join(', ') : 'no active surge counters right now'}`,
          thinZones.length ? `zones with insufficient evidence (n<${MIN_SAMPLE_SIZE}): ${thinZones.join(', ')}` : 'no thin zones this window',
        ],
      },
    ];

    for (const s of sections) {
      for (const m of s.metrics) if (m.qualityLabel === 'insufficient_evidence') insufficient.push(m.name);
    }

    return {
      briefType: 'marketplace_health',
      windowStart: w.start.toISOString(),
      windowEnd: w.end.toISOString(),
      comparisonWindowStart: w.prevStart.toISOString(),
      comparisonWindowEnd: w.prevEnd.toISOString(),
      generatedAt: now.toISOString(),
      sourceVersion: BRIEFS_SOURCE_VERSION,
      sections,
      insufficientEvidence: insufficient,
    };
  }
}
