import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BriefSection, BriefZoneRow, FounderBrief } from './brief.types';
import {
  BRIEFS_SOURCE_VERSION, briefWindow, changePct, metric, moneyEligible, round2, zoneKey,
} from './brief-helpers';
import { QualityClassService } from '../../quality/quality-class.service';
import { MIN_SAMPLE_SIZE } from '../../recommendations/recommendation.types';

// ─── BRIEF 2 — Money Map ──────────────────────────────────────────────────────
// CANONICAL MONEY ONLY: every dollar figure comes from trips/payments/refunds
// (post-e225720 canonical chain), quality-gated to Trusted/Reconciled trips.
// AI tables are never cited as a money source. This brief moves no money and
// recommends no payment action — it only shows where money already went.

@Injectable()
export class MoneyMapBrief {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quality: QualityClassService,
  ) {}

  async generate(now = new Date()): Promise<FounderBrief> {
    const w = briefWindow(7, now);
    const insufficient: string[] = [];

    const [trips, prevTrips, refunds, paymentsSucceeded, paymentsFailed] = await Promise.all([
      this.prisma.trip.findMany({
        where: { status: 'completed', completedAt: { gte: w.start, lte: w.end } },
        select: {
          id: true, finalFare: true, driverEarnings: true, platformFee: true,
          earningsSupplement: true, pickupLat: true, pickupLng: true,
          isAirportTrip: true, bidId: true,
        },
      }),
      this.prisma.trip.findMany({
        where: { status: 'completed', completedAt: { gte: w.prevStart, lt: w.prevEnd } },
        select: { id: true, finalFare: true },
      }),
      this.prisma.refund.aggregate({
        where: { createdAt: { gte: w.start, lte: w.end } },
        _sum: { amount: true }, _count: true,
      }),
      this.prisma.payment.count({ where: { status: 'succeeded', createdAt: { gte: w.start, lte: w.end } } }),
      this.prisma.payment.count({ where: { status: 'failed', createdAt: { gte: w.start, lte: w.end } } }),
    ]);

    // Bounded quality read: only this window's and the comparison window's trips.
    const qualityClasses = await this.quality.classesFor([...trips.map((t) => t.id), ...prevTrips.map((t) => t.id)]);
    const money = trips.filter((t) => moneyEligible(qualityClasses, t.id) && t.finalFare != null);
    const prevMoney = prevTrips.filter((t) => moneyEligible(qualityClasses, t.id) && t.finalFare != null);

    const sum = (rows: typeof money, f: (t: (typeof money)[number]) => number) => round2(rows.reduce((s, t) => s + f(t), 0));

    const gross = sum(money, (t) => Number(t.finalFare));
    const grossPrev = round2(prevMoney.reduce((s, t) => s + Number(t.finalFare), 0));
    const driverEarnings = sum(money, (t) => Number(t.driverEarnings ?? 0));
    const platformRevenue = sum(money, (t) => Number(t.platformFee ?? 0));
    const supplements = sum(money, (t) => Number(t.earningsSupplement ?? 0));
    const paymentsTerminal = paymentsSucceeded + paymentsFailed;

    // Per-zone contribution: platform fee minus absorbed floor supplements.
    const zoneAgg = new Map<string, { trips: number; gross: number; fees: number; supplements: number }>();
    for (const t of money) {
      const z = zoneKey(Number(t.pickupLat), Number(t.pickupLng));
      const agg = zoneAgg.get(z) ?? { trips: 0, gross: 0, fees: 0, supplements: 0 };
      agg.trips += 1;
      agg.gross += Number(t.finalFare);
      agg.fees += Number(t.platformFee ?? 0);
      agg.supplements += Number(t.earningsSupplement ?? 0);
      zoneAgg.set(z, agg);
    }
    // Zone rows below the sample floor expose NO dollar values — an n=1 row
    // would reveal a single trip's money tuple at zone granularity.
    const zoneRows: BriefZoneRow[] = [...zoneAgg.entries()]
      .map(([zone, a]) => {
        const sufficient = a.trips >= MIN_SAMPLE_SIZE;
        return {
          zone,
          trips: a.trips,
          gross: sufficient ? round2(a.gross) : null,
          platformFees: sufficient ? round2(a.fees) : null,
          floorSupplements: sufficient ? round2(a.supplements) : null,
          contribution: sufficient ? round2(a.fees - a.supplements) : null,
          evidence: sufficient ? 'ok' : `insufficient (n=${a.trips})`,
        };
      })
      .sort((a, b) => ((a.contribution as number | null) ?? Infinity) - ((b.contribution as number | null) ?? Infinity));
    const losingZones = zoneRows.filter((z) => (z.contribution as number) < 0 && z.evidence === 'ok');

    const airportMoney = money.filter((t) => t.isAirportTrip);
    const offerMoney = money.filter((t) => t.bidId != null);

    const sections: BriefSection[] = [
      {
        title: 'Totals (canonical, Trusted/Reconciled only)',
        metrics: [
          metric({ name: 'gross_ride_value', value: gross, unit: 'USD', window: w.label, sampleSize: money.length, source: 'trips.finalFare (canonical)', qualityLabel: 'canonical_trusted', comparison: { period: w.prevLabel, value: grossPrev, changePct: changePct(gross, grossPrev) } }),
          metric({ name: 'driver_earnings', value: driverEarnings, unit: 'USD', window: w.label, sampleSize: money.length, source: 'trips.driverEarnings (canonical)', qualityLabel: 'canonical_trusted' }),
          metric({ name: 'platform_revenue', value: platformRevenue, unit: 'USD', window: w.label, sampleSize: money.length, source: 'trips.platformFee (canonical)', qualityLabel: 'canonical_trusted' }),
          metric({ name: 'earnings_floor_supplements_absorbed', betterWhen: 'down', value: supplements, unit: 'USD', window: w.label, sampleSize: money.length, source: 'trips.earningsSupplement (canonical)', qualityLabel: 'canonical_trusted', note: 'platform absorbs these — deterministic floor, never AI-touched' }),
        ],
      },
      {
        title: 'Payments',
        metrics: [
          metric({ name: 'refunds_total', betterWhen: 'down', value: refunds._sum.amount != null ? round2(Number(refunds._sum.amount)) : 0, unit: 'USD', window: w.label, sampleSize: refunds._count, source: 'refunds (canonical)', qualityLabel: 'canonical_all', isCount: true }),
          metric({ name: 'failed_payments', betterWhen: 'down', value: paymentsFailed, window: w.label, sampleSize: paymentsFailed, source: 'payments.status=failed (canonical)', qualityLabel: 'canonical_all', isCount: true }),
          metric({ name: 'completed_payment_rate', value: paymentsTerminal ? round2((paymentsSucceeded / paymentsTerminal) * 100) : null, unit: '%', window: w.label, sampleSize: paymentsTerminal, source: 'payments (canonical)', qualityLabel: 'canonical_all' }),
        ],
        notes: [
          'payments/refunds aggregates come straight from the canonical payment tables; the C1–C5 trip quality gate does not apply to them (it classifies trips, not payment rows)',
        ],
      },
      {
        title: 'Contribution',
        metrics: [
          metric({ name: 'airport_contribution', value: round2(airportMoney.reduce((s, t) => s + Number(t.platformFee ?? 0) - Number(t.earningsSupplement ?? 0), 0)), unit: 'USD', window: w.label, sampleSize: airportMoney.length, source: 'trips.platformFee − trips.earningsSupplement (canonical)', qualityLabel: 'canonical_trusted' }),
          metric({ name: 'offer_ride_contribution', value: round2(offerMoney.reduce((s, t) => s + Number(t.platformFee ?? 0) - Number(t.earningsSupplement ?? 0), 0)), unit: 'USD', window: w.label, sampleSize: offerMoney.length, source: 'trips (bidId≠null) platformFee − earningsSupplement (canonical)', qualityLabel: 'canonical_trusted' }),
        ],
        zoneTable: { columns: ['zone', 'trips', 'gross', 'platformFees', 'floorSupplements', 'contribution', 'evidence'], rows: zoneRows },
        notes: [
          losingZones.length
            ? `possible money-losing zones (contribution < 0, n≥${MIN_SAMPLE_SIZE}): ${losingZones.map((z) => z.zone).join(', ')} — floor supplements exceed platform fees there`
            : `no zone with sufficient evidence shows negative contribution in ${w.label}`,
          'excluded/suspect trips are omitted from every dollar figure (data-quality gate); this brief reads money, it never moves it',
        ],
      },
    ];

    for (const s of sections) for (const m of s.metrics) if (m.qualityLabel === 'insufficient_evidence') insufficient.push(m.name);

    return {
      briefType: 'money_map',
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
