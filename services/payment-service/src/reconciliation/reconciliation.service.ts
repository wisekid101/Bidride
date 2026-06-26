import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcilePaymentIntent(opts: {
    stripeId: string;
    stripeAmountCents: number;
    stripeStatus: string;
  }): Promise<void> {
    const stripeAmount = opts.stripeAmountCents / 100;
    const existing = await this.prisma.paymentReconciliation.findUnique({
      where: { stripeObjectId: opts.stripeId },
    });
    if (existing) return; // already reconciled

    const localPayment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: opts.stripeId },
    });

    if (!localPayment) {
      await this.prisma.paymentReconciliation.create({
        data: {
          stripeObjectId: opts.stripeId,
          stripeObjectType: 'payment_intent',
          stripeAmount,
          localAmount: null,
          status: 'orphan',
          mismatchReason: 'No matching local payment record',
        },
      });
      return;
    }

    const localAmount = Number(localPayment.amount);
    const isMatch = Math.abs(localAmount - stripeAmount) < 0.01;

    await this.prisma.paymentReconciliation.create({
      data: {
        stripeObjectId: opts.stripeId,
        stripeObjectType: 'payment_intent',
        stripeAmount,
        localAmount,
        status: isMatch ? 'matched' : 'mismatch',
        mismatchReason: isMatch
          ? null
          : `Amount mismatch: stripe=${stripeAmount} local=${localAmount}`,
      },
    });
  }

  async reconcileRefund(opts: {
    stripeRefundId: string;
    stripeAmountCents: number;
    paymentIntentId: string;
  }): Promise<void> {
    const stripeAmount = opts.stripeAmountCents / 100;
    const existing = await this.prisma.paymentReconciliation.findUnique({
      where: { stripeObjectId: opts.stripeRefundId },
    });
    if (existing) return;

    const localPayment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: opts.paymentIntentId },
    });

    if (!localPayment) {
      await this.prisma.paymentReconciliation.create({
        data: {
          stripeObjectId: opts.stripeRefundId,
          stripeObjectType: 'refund',
          stripeAmount,
          status: 'orphan',
          mismatchReason: 'No matching local payment for this refund',
        },
      });
      return;
    }

    const localRefundTotal = Number(localPayment.refundAmount);
    const isMatch = Math.abs(localRefundTotal - stripeAmount) < 0.01;

    await this.prisma.paymentReconciliation.create({
      data: {
        stripeObjectId: opts.stripeRefundId,
        stripeObjectType: 'refund',
        stripeAmount,
        localAmount: localRefundTotal,
        status: isMatch ? 'matched' : 'mismatch',
        mismatchReason: isMatch
          ? null
          : `Refund amount mismatch: stripe=${stripeAmount} local=${localRefundTotal}`,
      },
    });
  }

  async recordDispute(opts: {
    stripeDisputeId: string;
    stripeAmountCents: number;
    paymentIntentId: string;
  }): Promise<void> {
    const existing = await this.prisma.paymentReconciliation.findUnique({
      where: { stripeObjectId: opts.stripeDisputeId },
    });
    if (existing) return;

    await this.prisma.paymentReconciliation.create({
      data: {
        stripeObjectId: opts.stripeDisputeId,
        stripeObjectType: 'dispute',
        stripeAmount: opts.stripeAmountCents / 100,
        status: 'mismatch',
        mismatchReason: `Dispute opened on ${opts.paymentIntentId}`,
      },
    });
  }

  async listMismatches(limit = 50) {
    return this.prisma.paymentReconciliation.findMany({
      where: { status: { in: ['mismatch', 'orphan'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async resolveEntry(id: string, adminId: string): Promise<void> {
    await this.prisma.paymentReconciliation.update({
      where: { id },
      data: { status: 'resolved', resolvedAt: new Date(), resolvedByAdminId: adminId },
    });
  }
}
