import { ServiceUnavailableException } from '@nestjs/common';
import { PayoutDriverController } from './payout.driver.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Commit 0 — emergency containment: instant payout must be OFF unless
// PAYOUTS_ENABLED is explicitly enabling. When OFF the handler must 503 with a
// stable code and touch nothing downstream (no driver lookup, no PaymentService
// call, therefore no Stripe call, no payout row, no wallet/ledger mutation).
describe('PayoutDriverController — instant payout containment', () => {
  const build = (flag?: unknown) => {
    const payments = {
      instantPayout: jest.fn().mockResolvedValue({ payoutId: 'p1', amount: 49.01 }),
      createConnectOnboardingLink: jest.fn(),
    };
    const prisma = { driver: { findUnique: jest.fn().mockResolvedValue({ id: 'driver-1' }) } };
    const config = { get: jest.fn().mockReturnValue(flag) };
    const controller = new PayoutDriverController(
      payments as any, prisma as any, config as any,
    );
    return { controller, payments, prisma, config };
  };

  async function expectDisabled(flag?: unknown) {
    const { controller, payments, prisma } = build(flag);
    let err: any;
    try { await controller.instant('user-1'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.getStatus()).toBe(503);
    expect((err.getResponse() as any).code).toBe('payouts_temporarily_unavailable');
    // nothing downstream ran: no PaymentService (⇒ no Stripe/payout/wallet/ledger) and no DB read
    expect(payments.instantPayout).not.toHaveBeenCalled();
    expect(prisma.driver.findUnique).not.toHaveBeenCalled();
    return err;
  }

  it('1. flag missing (undefined) → 503 + stable code, instantPayout not called', async () => {
    await expectDisabled(undefined);
  });

  it('2. flag boolean false → disabled', async () => {
    await expectDisabled(false);
  });

  it('3. flag string "false" → disabled', async () => {
    await expectDisabled('false');
  });

  it('4. flag string "0" → disabled', async () => {
    await expectDisabled('0');
  });

  it('4b. arbitrary truthy-looking string "1"/"yes" → still disabled (no truthiness mistake)', async () => {
    await expectDisabled('1');
    await expectDisabled('yes');
  });

  it('5. flag boolean true → instantPayout invoked once, response preserved', async () => {
    const { controller, payments, prisma } = build(true);
    const res = await controller.instant('user-1');
    expect(prisma.driver.findUnique).toHaveBeenCalledTimes(1);
    expect(payments.instantPayout).toHaveBeenCalledTimes(1);
    expect(payments.instantPayout).toHaveBeenCalledWith('driver-1');
    expect(res).toEqual({ payoutId: 'p1', amount: 49.01 });
  });

  it('6. flag string "true" → enabled (repo convention), instantPayout invoked once', async () => {
    const { controller, payments } = build('true');
    await controller.instant('user-1');
    expect(payments.instantPayout).toHaveBeenCalledTimes(1);
    expect(payments.instantPayout).toHaveBeenCalledWith('driver-1');
  });

  it('7. disabled path performs no Stripe/payout/wallet/ledger work and no DB read', async () => {
    const { controller, payments, prisma } = build(undefined);
    await controller.instant('user-1').catch(() => {});
    expect(payments.instantPayout).not.toHaveBeenCalled(); // all money movement lives inside instantPayout
    expect(prisma.driver.findUnique).not.toHaveBeenCalled();
  });

  it('8. authentication guard remains applied to the controller class', () => {
    const guards = Reflect.getMetadata('__guards__', PayoutDriverController) || [];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('connect endpoint is unaffected by the payout flag', async () => {
    const { controller, payments } = build(undefined); // flag OFF
    (payments.createConnectOnboardingLink as jest.Mock).mockResolvedValue({ url: 'https://connect' });
    const res = await controller.connect('user-1');
    expect(payments.createConnectOnboardingLink).toHaveBeenCalledWith('driver-1');
    expect(res).toEqual({ url: 'https://connect' });
  });
});
