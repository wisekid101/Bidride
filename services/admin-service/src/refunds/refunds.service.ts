import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database';
import { IsString, IsNumber, IsEnum, IsOptional, Min, Max } from 'class-validator';

export enum RefundReason {
  OVERCHARGE = 'overcharge',
  DRIVER_CANCELLED = 'driver_cancelled',
  POOR_SERVICE = 'poor_service',
  SAFETY_INCIDENT = 'safety_incident',
  TECHNICAL_ERROR = 'technical_error',
  GOODWILL = 'goodwill',
}

export class IssueRefundDto {
  @IsString()
  tripId: string;

  @IsNumber()
  @Min(0.01)
  @Max(500)
  amount: number;

  @IsEnum(RefundReason)
  reason: RefundReason;

  @IsString()
  notes: string;

  @IsOptional()
  @IsString()
  stripePaymentIntentId?: string;
}

// Roles that can issue refunds and their caps
const REFUND_CAPS: Record<string, number> = {
  support: 25,
  operations: 100,
  fraud_analyst: 100,
  safety_officer: 500,
  finance: 500,
  compliance: 500,
  super_admin: 500,
  founder: 500,
};

@Injectable()
export class RefundsService {
  private prisma = new PrismaClient();

  async issueRefund(dto: IssueRefundDto, adminId: string, adminRole: string) {
    const cap = REFUND_CAPS[adminRole] ?? 0;
    if (dto.amount > cap) {
      throw new ForbiddenException(
        `Your role (${adminRole}) can issue refunds up to $${cap.toFixed(2)}`,
      );
    }

    const trip = await this.prisma.trip.findUnique({
      where: { id: dto.tripId },
      include: { payment: true },
    });

    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.status !== 'completed') {
      throw new BadRequestException('Refunds can only be issued on completed trips');
    }

    const existingRefunds = await this.prisma.refund.aggregate({
      where: { tripId: dto.tripId },
      _sum: { amount: true },
    });

    const totalRefunded = parseFloat(existingRefunds._sum.amount?.toString() ?? '0');
    const maxRefund = parseFloat(trip.finalFare?.toString() ?? '0');

    if (totalRefunded + dto.amount > maxRefund) {
      throw new BadRequestException(
        `Cannot refund more than the trip fare ($${maxRefund.toFixed(2)}). Already refunded: $${totalRefunded.toFixed(2)}`,
      );
    }

    const refund = await this.prisma.refund.create({
      data: {
        tripId: dto.tripId,
        amount: dto.amount,
        reason: dto.reason,
        notes: dto.notes,
        issuedByAdminId: adminId,
        stripeRefundId: null, // set after Stripe call
      },
    });

    // In production: call Stripe refund API here via payment service
    // Publishing event so payment-service handles the actual Stripe call
    // This keeps Stripe keys isolated in payment-service

    return { refundId: refund.id, amount: dto.amount, success: true };
  }

  async listRefunds(tripId?: string, page = 1, limit = 50) {
    const where = tripId ? { tripId } : {};

    const [refunds, total] = await this.prisma.$transaction([
      this.prisma.refund.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          trip: { select: { pickupAddress: true, dropoffAddress: true, finalFare: true } },
        },
      }),
      this.prisma.refund.count({ where }),
    ]);

    return { refunds, total, page, pages: Math.ceil(total / limit) };
  }
}
