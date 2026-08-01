import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Rider receipt aggregation.
 *
 * The receipt is DERIVED, never stored: Payment (one per trip) and Refund rows
 * are already immutable financial evidence, so a snapshot table would duplicate
 * them and risk divergence from the ledger. Reading the same immutable rows is
 * what makes retrieval deterministic and idempotent — this service performs no
 * writes of any kind.
 *
 * The total ALWAYS comes from Payment.amount — what the rider was actually
 * charged — never from Trip.finalFare (the fare), never from Trip.aiFare (an
 * estimate), and never recomputed from pricing rules. Those can legitimately
 * diverge from the charge, and a receipt that shows a fare while claiming to be
 * a total is the exact defect this milestone exists to fix.
 *
 * Unsupported line items (tip, discount, credit, tax, tolls, airport fee) are
 * OMITTED rather than reported as zero: the platform does not persist them, and
 * a zero would assert something untrue.
 */

/** Cent-level tolerance when cross-checking two decimal aggregates. */
const RECONCILIATION_TOLERANCE = 0.005;

const money = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100;

export interface RiderReceiptRefund {
  amount: number;
  /** Coarse category only — never the admin note or the provider refund id. */
  reason: string;
  createdAt: Date;
}

export interface RiderReceipt {
  receiptId: string;
  tripId: string;
  tripStatus: string;
  completedAt: Date | null;
  pickupAddress: string;
  dropoffAddress: string;
  currency: string;
  /** Fare COMPONENTS. Not the amount charged — see grossCharged. */
  fare: { finalFare: number; platformFee: number; waitFee: number };
  /** The authoritative amount charged (Payment.amount). */
  grossCharged: number;
  refundedTotal: number;
  netPaid: number;
  paymentStatus: string;
  refunds: RiderReceiptRefund[];
}

@Injectable()
export class ReceiptService {
  constructor(private readonly prisma: PrismaService) {}

  async getRiderReceipt(userId: string, tripId: string): Promise<RiderReceipt> {
    const rider = await this.prisma.rider.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!rider) {
      throw new NotFoundException({
        code: 'RECEIPT_NOT_FOUND',
        message: 'Receipt not found.',
      });
    }

    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true, riderId: true, status: true, completedAt: true,
        pickupAddress: true, dropoffAddress: true,
        finalFare: true, platformFee: true, waitFeeCharged: true,
      },
    });

    // A trip belonging to someone else is reported IDENTICALLY to a missing
    // trip, so a rider cannot probe for the existence of other riders' trips.
    if (!trip || trip.riderId !== rider.id) {
      throw new NotFoundException({
        code: 'RECEIPT_NOT_FOUND',
        message: 'Receipt not found.',
      });
    }

    if (trip.status !== 'completed') {
      throw new BadRequestException({
        code: 'RECEIPT_TRIP_NOT_COMPLETED',
        message: 'A receipt is available only for a completed trip.',
      });
    }

    const payment = await this.prisma.payment.findUnique({
      where: { tripId },
      select: { id: true, riderId: true, amount: true, currency: true, status: true, refundAmount: true },
    });
    if (!payment || payment.riderId !== rider.id) {
      // Fail explicitly rather than inventing a total from the fare.
      throw new NotFoundException({
        code: 'RECEIPT_PAYMENT_NOT_FOUND',
        message: 'No payment record exists for this trip yet.',
      });
    }

    const refundRows = await this.prisma.refund.findMany({
      where: { tripId },
      select: { amount: true, reason: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Payment.refundAmount is maintained as the running aggregate by the refund
    // path; Refund rows are its itemisation. They must agree. If they do not,
    // the financial evidence is inconsistent and we fail closed rather than
    // pick a side and show the rider a number we cannot stand behind.
    const aggregateRefunded = money(payment.refundAmount);
    const itemisedRefunded = money(refundRows.reduce((s, r) => s + Number(r.amount ?? 0), 0));
    if (Math.abs(aggregateRefunded - itemisedRefunded) > RECONCILIATION_TOLERANCE) {
      throw new ConflictException({
        code: 'RECEIPT_RECONCILIATION_REQUIRED',
        message: 'This receipt is temporarily unavailable while a payment adjustment is reconciled.',
      });
    }

    const grossCharged = money(payment.amount);
    const refundedTotal = aggregateRefunded;

    return {
      receiptId: `RCPT-${payment.id}`,
      tripId: trip.id,
      tripStatus: trip.status,
      completedAt: trip.completedAt,
      pickupAddress: trip.pickupAddress,
      dropoffAddress: trip.dropoffAddress,
      currency: payment.currency,
      fare: {
        finalFare: money(trip.finalFare),
        platformFee: money(trip.platformFee),
        waitFee: money(trip.waitFeeCharged),
      },
      grossCharged,
      refundedTotal,
      netPaid: money(grossCharged - refundedTotal),
      paymentStatus: payment.status,
      refunds: refundRows.map((r) => ({
        amount: money(r.amount),
        reason: r.reason,
        createdAt: r.createdAt,
      })),
    };
  }
}
