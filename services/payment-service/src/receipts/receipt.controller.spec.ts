import { ReceiptController } from './receipt.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * The controller must be a thin, authenticated pass-through: identity comes
 * from the JWT-derived x-user-id header, never from a body or query parameter,
 * and the route must stay behind JwtAuthGuard.
 */
describe('ReceiptController', () => {
  const build = () => {
    const receipts = { getRiderReceipt: jest.fn().mockResolvedValue({ receiptId: 'RCPT-pay-1' }) };
    return { controller: new ReceiptController(receipts as never), receipts };
  };

  it('passes the JWT-derived user id and trip id to the service', async () => {
    const { controller, receipts } = build();
    const res = await controller.getReceipt('user-1', 'trip-1');
    expect(receipts.getRiderReceipt).toHaveBeenCalledWith('user-1', 'trip-1');
    expect(res).toEqual({ receiptId: 'RCPT-pay-1' });
  });

  it('keeps the authentication guard applied to the controller class', () => {
    const guards = Reflect.getMetadata('__guards__', ReceiptController) || [];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('propagates service errors rather than masking them', async () => {
    const { controller, receipts } = build();
    receipts.getRiderReceipt.mockRejectedValue(new Error('nope'));
    await expect(controller.getReceipt('user-1', 'trip-1')).rejects.toThrow('nope');
  });

  it('exposes only the receipt read surface (no mutating handlers)', () => {
    const methods = Object.getOwnPropertyNames(ReceiptController.prototype).filter((m) => m !== 'constructor');
    expect(methods).toEqual(['getReceipt']);
  });
});
