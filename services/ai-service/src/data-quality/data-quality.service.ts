import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';

// Deterministic training-data classification (AI Core Phase 2, Phase 4).
// Runs the C1–C5 contamination checks from design/ai-core-data-readiness.md
// against every completed trip and records the verdict as a
// `data_quality_classified` trip_event — trip_events IS the store (no schema
// change), and the event's metadata carries reason + evidence + version +
// timestamp as the Founder directive requires.
//
// Gate (enforced by consumers, stated here canonically): monetary training
// targets may use Trusted and approved Reconciled rows ONLY. Suspect rows may
// feed behavioral features when explicitly flagged. Excluded never trains.
export const CLASSIFIER_VERSION = 'dq-v1';

export type QualityClass = 'trusted' | 'reconciled' | 'suspect' | 'excluded';

export interface TripClassification {
  tripId: string;
  qualityClass: QualityClass;
  reason: string;
  evidence: Record<string, unknown>;
}

interface CompletedTripRow {
  id: string;
  bidId: string | null;
  finalFare: Prisma.Decimal | null;
  aiFare: Prisma.Decimal;
}

@Injectable()
export class DataQualityService {
  private readonly logger = new Logger(DataQualityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async classifyAll(): Promise<{ classified: number; changed: number; counts: Record<QualityClass, number> }> {
    const trips = (await this.prisma.trip.findMany({
      where: { status: 'completed' },
      select: { id: true, bidId: true, finalFare: true, aiFare: true },
    })) as CompletedTripRow[];

    const counts: Record<QualityClass, number> = { trusted: 0, reconciled: 0, suspect: 0, excluded: 0 };
    let changed = 0;

    for (const trip of trips) {
      const c = await this.classifyTrip(trip);
      counts[c.qualityClass] += 1;
      const wrote = await this.persist(c);
      if (wrote) changed += 1;
    }

    this.logger.log(
      `data-quality classify: ${trips.length} trips → ` +
      `trusted=${counts.trusted} reconciled=${counts.reconciled} suspect=${counts.suspect} excluded=${counts.excluded} (${changed} events written)`,
    );
    return { classified: trips.length, changed, counts };
  }

  // Precedence per ai-core-data-readiness.md: Excluded > Suspect > Trusted.
  // (Reconciled requires a documented correction — never assigned
  // automatically; a human-approved repair flow promotes Suspect/Excluded
  // rows to Reconciled explicitly.)
  private async classifyTrip(trip: CompletedTripRow): Promise<TripClassification> {
    const evidence: Record<string, unknown> = {};

    // C5 — fare-integrity-frozen trips are always Excluded... unless the
    // event is a flagged test artifact (deliberate guard verification).
    const integrityEvents = await this.prisma.tripEvent.findMany({
      where: { tripId: trip.id, eventType: 'fare_integrity_error' },
      select: { metadata: true },
    });
    const organicIntegrityFailure = integrityEvents.some(
      (e) => !(e.metadata as { testArtifact?: boolean } | null)?.testArtifact,
    );
    // Guard-verification refusals recorded on otherwise-healthy trips (the
    // 2026-07-10 live proof) are distinguishable: the trip's own money chain
    // still reconciles below. Only count C5 as fatal when reconciliation
    // ALSO fails or the freeze blocked money (finalFare null on a bid trip).
    if (integrityEvents.length > 0) evidence.c5_integrityEvents = integrityEvents.length;

    if (trip.bidId != null) {
      // C1 — completed fare must equal the accepted negotiation
      const bid = await this.prisma.bid.findUnique({
        where: { id: trip.bidId },
        select: { riderOffer: true, counterOffer: true, finalFare: true },
      });
      const accepted = bid ? Number(bid.finalFare ?? bid.riderOffer) : null;
      if (trip.finalFare == null) {
        return {
          tripId: trip.id,
          qualityClass: 'excluded',
          reason: 'C5: bid trip completed with money movement frozen (missing canonical fare)',
          evidence: { ...evidence, c1_acceptedOffer: accepted, tripFinalFare: null },
        };
      }
      if (accepted != null && Math.abs(Number(trip.finalFare) - accepted) > 0.005) {
        return {
          tripId: trip.id,
          qualityClass: 'excluded',
          reason: 'C1: completed fare does not equal the accepted negotiated fare (pre-hotfix overcharge era)',
          evidence: { ...evidence, c1_acceptedOffer: accepted, tripFinalFare: Number(trip.finalFare) },
        };
      }

      // C3 — invisible settlement: no payments row at all
      const paymentCount = await this.prisma.payment.count({ where: { tripId: trip.id } });
      if (paymentCount === 0) {
        return {
          tripId: trip.id,
          qualityClass: 'excluded',
          reason: 'C3: bid trip settled on Stripe with no booked payments row (unbooked-capture era)',
          evidence: { ...evidence, c3_paymentRows: 0 },
        };
      }
    }

    // C4 — booked payment must agree with the canonical fare
    const payments = await this.prisma.payment.findMany({
      where: { tripId: trip.id, status: 'succeeded' },
      select: { amount: true },
    });
    if (payments.length === 0) {
      // Precedence: Excluded > Suspect. An organic integrity error whose
      // money chain is ALSO unverifiable can never soften to Suspect.
      if (organicIntegrityFailure) {
        return {
          tripId: trip.id,
          qualityClass: 'excluded',
          reason: 'C5: organic fare integrity error and no succeeded payment to reconcile against',
          evidence: { ...evidence, c4_succeededPayments: 0 },
        };
      }
      return {
        tripId: trip.id,
        qualityClass: 'suspect',
        reason: 'C4: completed trip has no succeeded payment row — money truth unverifiable; behavioral features only',
        evidence: { ...evidence, c4_succeededPayments: 0 },
      };
    }
    // A payment exists but the canonical fare is missing — reconciliation is
    // impossible, so this can never be Trusted ("fare == payment" was never
    // actually compared).
    if (trip.finalFare == null) {
      return {
        tripId: trip.id,
        qualityClass: 'suspect',
        reason: 'C4: succeeded payment exists but canonical finalFare is missing — money truth unverifiable',
        evidence: { ...evidence, c4_succeededPayments: payments.length, tripFinalFare: null },
      };
    }
    const mismatch = payments.find(
      (p) => Math.abs(Number(p.amount) - Number(trip.finalFare)) > 0.005,
    );
    if (mismatch) {
      return {
        tripId: trip.id,
        qualityClass: 'excluded',
        reason: 'C4/C2: booked payment disagrees with canonical fare (double-charge era)',
        evidence: { ...evidence, c4_paymentAmount: Number(mismatch.amount), tripFinalFare: Number(trip.finalFare) },
      };
    }

    if (organicIntegrityFailure) {
      return {
        tripId: trip.id,
        qualityClass: 'excluded',
        reason: 'C5: organic fare integrity error recorded for this trip',
        evidence,
      };
    }

    return {
      tripId: trip.id,
      qualityClass: 'trusted',
      reason: 'Full reconciliation: canonical fare == booked payment; no organic integrity events',
      evidence: { ...evidence, reconciledPayments: payments.length },
    };
  }

  // Idempotent: writes a new assessment event only when the class or the
  // classifier version differs from the latest existing assessment.
  private async persist(c: TripClassification): Promise<boolean> {
    const latest = await this.prisma.tripEvent.findFirst({
      where: { tripId: c.tripId, eventType: 'data_quality_classified' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    const prev = latest?.metadata as { class?: string; classifierVersion?: string } | null;
    if (prev?.class === c.qualityClass && prev?.classifierVersion === CLASSIFIER_VERSION) {
      return false;
    }
    await this.prisma.tripEvent.create({
      data: {
        tripId: c.tripId,
        eventType: 'data_quality_classified',
        metadata: {
          class: c.qualityClass,
          reason: c.reason,
          evidence: c.evidence,
          classifierVersion: CLASSIFIER_VERSION,
          classifiedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    return true;
  }

  async summary(): Promise<{
    counts: Record<QualityClass, number>;
    classifierVersion: string;
    gate: string;
  }> {
    const events = await this.prisma.tripEvent.findMany({
      where: { eventType: 'data_quality_classified' },
      orderBy: { createdAt: 'asc' },
      select: { tripId: true, metadata: true },
    });
    // Latest assessment per trip wins.
    const latest = new Map<string, QualityClass>();
    for (const e of events) {
      const cls = (e.metadata as { class?: QualityClass } | null)?.class;
      if (cls) latest.set(e.tripId, cls);
    }
    const counts: Record<QualityClass, number> = { trusted: 0, reconciled: 0, suspect: 0, excluded: 0 };
    for (const cls of latest.values()) counts[cls] += 1;
    return {
      counts,
      classifierVersion: CLASSIFIER_VERSION,
      gate: 'Monetary training targets: Trusted + approved Reconciled ONLY. Suspect: flagged behavioral features only. Excluded: never trains, retained for audit.',
    };
  }
}
