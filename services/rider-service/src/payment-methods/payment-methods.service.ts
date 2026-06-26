import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database';
import Stripe from 'stripe';

@Injectable()
export class PaymentMethodsService {
  private prisma = new PrismaClient();
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
    apiVersion: '2024-04-10',
  });

  async listPaymentMethods(userId: string) {
    const rider = await this.prisma.rider.findUnique({
      where: { userId },
      select: { id: true, stripeCustomerId: true, defaultPaymentMethodId: true },
    });
    if (!rider) throw new NotFoundException('Rider not found');
    if (!rider.stripeCustomerId) return { paymentMethods: [], defaultPaymentMethodId: null };

    const methods = await this.stripe.paymentMethods.list({
      customer: rider.stripeCustomerId,
      type: 'card',
    });

    return {
      paymentMethods: methods.data.map((pm) => ({
        id: pm.id,
        brand: pm.card!.brand,
        last4: pm.card!.last4,
        expMonth: pm.card!.exp_month,
        expYear: pm.card!.exp_year,
        isDefault: pm.id === rider.defaultPaymentMethodId,
      })),
      defaultPaymentMethodId: rider.defaultPaymentMethodId,
    };
  }

  async createSetupIntent(userId: string) {
    const rider = await this.prisma.rider.findUnique({
      where: { userId },
      include: { user: { select: { phone: true } } },
    });
    if (!rider) throw new NotFoundException('Rider not found');

    let customerId = rider.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        metadata: { riderId: rider.id, userId },
        phone: rider.user.phone,
      });
      customerId = customer.id;
      await this.prisma.rider.update({
        where: { id: rider.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const intent = await this.stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    });

    return { clientSecret: intent.client_secret, customerId };
  }

  async setDefaultPaymentMethod(userId: string, paymentMethodId: string) {
    const rider = await this.prisma.rider.findUnique({
      where: { userId },
      select: { id: true, stripeCustomerId: true },
    });
    if (!rider?.stripeCustomerId) throw new NotFoundException('Rider has no payment methods');

    const pm = await this.stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.customer !== rider.stripeCustomerId) {
      throw new BadRequestException('Payment method not found on this account');
    }

    await this.prisma.rider.update({
      where: { id: rider.id },
      data: { defaultPaymentMethodId: paymentMethodId },
    });

    await this.stripe.customers.update(rider.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    return { success: true, defaultPaymentMethodId: paymentMethodId };
  }

  async removePaymentMethod(userId: string, paymentMethodId: string) {
    const rider = await this.prisma.rider.findUnique({
      where: { userId },
      select: { id: true, stripeCustomerId: true, defaultPaymentMethodId: true },
    });
    if (!rider?.stripeCustomerId) throw new NotFoundException('Rider has no payment methods');

    const pm = await this.stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.customer !== rider.stripeCustomerId) {
      throw new BadRequestException('Payment method not found on this account');
    }

    await this.stripe.paymentMethods.detach(paymentMethodId);

    if (rider.defaultPaymentMethodId === paymentMethodId) {
      await this.prisma.rider.update({
        where: { id: rider.id },
        data: { defaultPaymentMethodId: null },
      });
    }

    return { success: true };
  }

  async hasDefaultPaymentMethod(userId: string): Promise<boolean> {
    const rider = await this.prisma.rider.findUnique({
      where: { userId },
      select: { defaultPaymentMethodId: true },
    });
    return !!rider?.defaultPaymentMethodId;
  }
}
