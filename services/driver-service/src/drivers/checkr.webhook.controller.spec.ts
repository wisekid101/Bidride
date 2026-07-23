import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { CheckrWebhookController } from './checkr.webhook.controller';

const mockCheckr = {
  verifyWebhookSignature: jest.fn(),
  handleWebhookEvent: jest.fn(),
} as any;

function req(body: string | undefined) {
  return { rawBody: body === undefined ? undefined : Buffer.from(body) } as any;
}
const validBody = JSON.stringify({ id: 'e1', type: 'report.completed', data: { object: {} } });

describe('CheckrWebhookController', () => {
  let controller: CheckrWebhookController;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckr.verifyWebhookSignature.mockReturnValue(true);
    mockCheckr.handleWebhookEvent.mockResolvedValue(undefined);
    controller = new CheckrWebhookController(mockCheckr);
  });

  it('rejects a missing signature (400)', async () => {
    await expect(controller.handleCheckrWebhook(req('{}'), '')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing body (400)', async () => {
    await expect(controller.handleCheckrWebhook(req(undefined), 'sha256=x')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid signature (400)', async () => {
    mockCheckr.verifyWebhookSignature.mockReturnValue(false);
    await expect(controller.handleCheckrWebhook(req('{}'), 'sha256=bad')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 400 for malformed-but-signed JSON and never invokes the handler (no infinite retry)', async () => {
    await expect(controller.handleCheckrWebhook(req('{not valid json'), 'sha256=ok')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockCheckr.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it('acks a valid, signed event', async () => {
    const res = await controller.handleCheckrWebhook(req(validBody), 'sha256=ok');
    expect(res).toEqual({ received: true });
    expect(mockCheckr.handleWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it('propagates a ServiceUnavailableException (503) so Checkr redelivers', async () => {
    mockCheckr.handleWebhookEvent.mockRejectedValue(new ServiceUnavailableException('retry'));
    await expect(controller.handleCheckrWebhook(req(validBody), 'sha256=ok')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
