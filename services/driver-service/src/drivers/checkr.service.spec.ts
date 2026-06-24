import { createHmac } from 'crypto';
import { CheckrService, CheckrWebhookEvent } from './checkr.service';

// Mock PrismaClient
jest.mock('@bidride/database', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
    DriverStatus: {
      pending: 'pending',
      under_review: 'under_review',
      action_required: 'action_required',
      approved: 'approved',
      declined: 'declined',
      suspended: 'suspended',
    },
    BackgroundCheckStatus: {
      not_started: 'not_started',
      pending: 'pending',
      clear: 'clear',
      consider: 'consider',
      adverse_action: 'adverse_action',
      disputed: 'disputed',
    },
  };
});

// Mock ioredis
jest.mock('ioredis', () => {
  return {
    Redis: jest.fn().mockImplementation(() => mockRedis),
  };
});

const mockDriver = {
  id: 'driver-uuid-1',
  userId: 'user-uuid-1',
  status: 'pending',
  backgroundCheckId: 'rpt_test_123',
  isAvailable: false,
  user: { email: 'driver@test.com' },
};

const mockPrisma = {
  driver: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
} as any;

const mockRedis = {
  set: jest.fn().mockResolvedValue('OK'),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  zrem: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
} as any;

function makeEvent(
  type: string,
  status: 'pending' | 'clear' | 'consider' | 'suspended' | 'canceled',
  reportId = 'rpt_test_123',
  eventId = 'evt_test_001',
): CheckrWebhookEvent {
  return {
    id: eventId,
    type,
    data: { object: { id: reportId, status, candidate_id: 'cand_test_001' } },
  };
}

describe('CheckrService', () => {
  let service: CheckrService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: NX succeeds (event not yet processed)
    mockRedis.set.mockResolvedValue('OK');
    service = new CheckrService();
  });

  // ── verifyWebhookSignature ───────────────────────────────────────────────

  describe('verifyWebhookSignature', () => {
    const secret = 'test_webhook_secret';

    beforeEach(() => {
      process.env.CHECKR_WEBHOOK_SECRET = secret;
    });

    afterEach(() => {
      delete process.env.CHECKR_WEBHOOK_SECRET;
    });

    it('accepts a valid signature', () => {
      const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'report.completed' }));
      const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
      expect(service.verifyWebhookSignature(body, sig)).toBe(true);
    });

    it('rejects a tampered signature', () => {
      const body = Buffer.from('{"id":"evt_1"}');
      expect(service.verifyWebhookSignature(body, 'sha256=deadbeef')).toBe(false);
    });

    it('rejects when signature has wrong length', () => {
      const body = Buffer.from('{}');
      expect(service.verifyWebhookSignature(body, 'sha256=abc')).toBe(false);
    });
  });

  // ── handleWebhookEvent ───────────────────────────────────────────────────

  describe('handleWebhookEvent', () => {
    beforeEach(() => {
      mockPrisma.driver.findFirst.mockResolvedValue(mockDriver);
      mockPrisma.driver.update.mockResolvedValue({});
    });

    it('skips processing when event was already handled (idempotency)', async () => {
      mockRedis.set.mockResolvedValue(null); // NX fails — already set

      await service.handleWebhookEvent(makeEvent('report.completed', 'clear'));

      expect(mockPrisma.driver.update).not.toHaveBeenCalled();
    });

    it('processes the same event ID only once across duplicate deliveries', async () => {
      mockRedis.set
        .mockResolvedValueOnce('OK')  // first delivery — claimed
        .mockResolvedValueOnce(null); // second delivery — already set

      const event = makeEvent('report.completed', 'clear');
      await service.handleWebhookEvent(event);
      await service.handleWebhookEvent(event);

      expect(mockPrisma.driver.update).toHaveBeenCalledTimes(1);
    });

    it('ignores events that are not report.completed or report.updated', async () => {
      await service.handleWebhookEvent(makeEvent('candidate.created', 'pending'));

      expect(mockPrisma.driver.findFirst).not.toHaveBeenCalled();
    });

    it('no-ops when no driver has the matching backgroundCheckId', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(null);

      await service.handleWebhookEvent(makeEvent('report.completed', 'clear', 'rpt_unknown'));

      expect(mockPrisma.driver.update).not.toHaveBeenCalled();
    });

    describe('clear result', () => {
      it('auto-approves driver and publishes driver:approved event', async () => {
        await service.handleWebhookEvent(makeEvent('report.completed', 'clear'));

        expect(mockPrisma.driver.update).toHaveBeenCalledWith({
          where: { id: mockDriver.id },
          data: expect.objectContaining({
            backgroundCheckStatus: 'clear',
            status: 'approved',
            onboardingStep: 'complete',
          }),
        });
        expect(mockRedis.publish).toHaveBeenCalledWith(
          'driver:approved',
          expect.stringContaining(mockDriver.id),
        );
      });

      it('does not auto-approve a driver that is already approved', async () => {
        mockPrisma.driver.findFirst.mockResolvedValue({ ...mockDriver, status: 'approved' });

        await service.handleWebhookEvent(makeEvent('report.completed', 'clear'));

        expect(mockPrisma.driver.update).not.toHaveBeenCalled();
      });

      it('does not auto-approve a declined driver', async () => {
        mockPrisma.driver.findFirst.mockResolvedValue({ ...mockDriver, status: 'declined' });

        await service.handleWebhookEvent(makeEvent('report.completed', 'clear'));

        expect(mockPrisma.driver.update).not.toHaveBeenCalled();
      });
    });

    describe('consider result — FCRA pre-adverse action', () => {
      it('sets backgroundCheckStatus to consider', async () => {
        await service.handleWebhookEvent(makeEvent('report.completed', 'consider'));

        expect(mockPrisma.driver.update).toHaveBeenCalledWith({
          where: { id: mockDriver.id },
          data: { backgroundCheckStatus: 'consider' },
        });
      });

      it('sets 7-day Redis waiting period key', async () => {
        await service.handleWebhookEvent(makeEvent('report.completed', 'consider'));

        expect(mockRedis.setex).toHaveBeenCalledWith(
          `bgc:adverse_waiting:${mockDriver.id}`,
          7 * 24 * 60 * 60,
          expect.any(String),
        );
      });

      it('publishes driver:bgc:pre_adverse_action event', async () => {
        await service.handleWebhookEvent(makeEvent('report.completed', 'consider'));

        expect(mockRedis.publish).toHaveBeenCalledWith(
          'driver:bgc:pre_adverse_action',
          expect.stringContaining(mockDriver.id),
        );
      });

      it('does not auto-approve or suspend driver on consider', async () => {
        await service.handleWebhookEvent(makeEvent('report.completed', 'consider'));

        expect(mockPrisma.driver.update).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'approved' }),
          }),
        );
        expect(mockPrisma.driver.update).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'suspended' }),
          }),
        );
      });
    });

    describe('suspended result — adverse action', () => {
      it('sets backgroundCheckStatus to adverse_action and suspends driver', async () => {
        await service.handleWebhookEvent(makeEvent('report.completed', 'suspended'));

        expect(mockPrisma.driver.update).toHaveBeenCalledWith({
          where: { id: mockDriver.id },
          data: expect.objectContaining({
            backgroundCheckStatus: 'adverse_action',
            status: 'suspended',
            isAvailable: false,
          }),
        });
      });

      it('removes driver from dispatch pool', async () => {
        await service.handleWebhookEvent(makeEvent('report.completed', 'suspended'));

        expect(mockRedis.del).toHaveBeenCalledWith(`driver:location:${mockDriver.id}`);
        expect(mockRedis.zrem).toHaveBeenCalledWith('drivers:geo', mockDriver.id);
      });

      it('publishes driver:bgc:final_adverse_action event', async () => {
        await service.handleWebhookEvent(makeEvent('report.completed', 'suspended'));

        expect(mockRedis.publish).toHaveBeenCalledWith(
          'driver:bgc:final_adverse_action',
          expect.stringContaining(mockDriver.id),
        );
      });
    });

    describe('canceled result — failed report', () => {
      it('treats canceled the same as suspended (adverse_action)', async () => {
        await service.handleWebhookEvent(makeEvent('report.completed', 'canceled'));

        expect(mockPrisma.driver.update).toHaveBeenCalledWith({
          where: { id: mockDriver.id },
          data: expect.objectContaining({
            backgroundCheckStatus: 'adverse_action',
            status: 'suspended',
          }),
        });
        expect(mockRedis.publish).toHaveBeenCalledWith(
          'driver:bgc:final_adverse_action',
          expect.any(String),
        );
      });
    });

    it('also handles report.updated event type', async () => {
      await service.handleWebhookEvent(makeEvent('report.updated', 'clear'));

      expect(mockPrisma.driver.update).toHaveBeenCalled();
    });
  });
});
