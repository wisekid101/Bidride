import { createHmac } from 'crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { CheckrService, CheckrWebhookEvent } from './checkr.service';

// Mock PrismaClient + enums
jest.mock('@bidride/database', () => ({
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
}));

jest.mock('ioredis', () => ({ Redis: jest.fn().mockImplementation(() => mockRedis) }));

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
    updateMany: jest.fn(),
  },
} as any;

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  zrem: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
  incr: jest.fn(),
  expire: jest.fn().mockResolvedValue(1),
} as any;

const mockActivation = { maybeActivate: jest.fn() } as any;

const EVENT_ID = 'evt_test_001';
const V2_KEY = `checkr:event:v2:${EVENT_ID}`;

function makeEvent(
  type: string,
  status: 'pending' | 'clear' | 'consider' | 'suspended' | 'canceled',
  reportId = 'rpt_test_123',
  eventId = EVENT_ID,
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
    mockRedis.set.mockResolvedValue('OK'); // NX claim + 'done' upgrade both succeed
    mockRedis.get.mockResolvedValue(null);
    mockRedis.incr.mockResolvedValue(1);
    mockPrisma.driver.findFirst.mockResolvedValue(mockDriver);
    mockPrisma.driver.update.mockResolvedValue({});
    mockPrisma.driver.updateMany.mockResolvedValue({ count: 1 });
    mockActivation.maybeActivate.mockResolvedValue({ outcome: 'activated' });
    service = new CheckrService(mockActivation);
  });

  describe('verifyWebhookSignature', () => {
    const secret = 'test_webhook_secret';
    beforeEach(() => { process.env.CHECKR_WEBHOOK_SECRET = secret; });
    afterEach(() => { delete process.env.CHECKR_WEBHOOK_SECRET; });

    it('accepts a valid signature', () => {
      const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'report.completed' }));
      const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
      expect(service.verifyWebhookSignature(body, sig)).toBe(true);
    });
    it('rejects a tampered signature', () => {
      expect(service.verifyWebhookSignature(Buffer.from('{"id":"evt_1"}'), 'sha256=deadbeef')).toBe(false);
    });
    it('rejects when signature has wrong length', () => {
      expect(service.verifyWebhookSignature(Buffer.from('{}'), 'sha256=abc')).toBe(false);
    });
  });

  describe('two-phase dedup marker', () => {
    it('claims a short-TTL processing lease, then upgrades to a long-TTL done marker on success', async () => {
      await service.handleWebhookEvent(makeEvent('report.completed', 'clear'));
      expect(mockRedis.set).toHaveBeenNthCalledWith(1, V2_KEY, 'processing', 'EX', 120, 'NX');
      expect(mockRedis.set).toHaveBeenNthCalledWith(2, V2_KEY, 'done', 'EX', 86400);
    });

    it('skips an already-processed event (done marker present) without doing work', async () => {
      mockRedis.set.mockResolvedValue(null); // NX fails
      mockRedis.get.mockResolvedValue('done');

      await expect(service.handleWebhookEvent(makeEvent('report.completed', 'clear'))).resolves.toBeUndefined();
      expect(mockPrisma.driver.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.driver.update).not.toHaveBeenCalled();
    });

    it('signals retry (503) when another delivery is still in flight (processing marker)', async () => {
      mockRedis.set.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue('processing');
      await expect(service.handleWebhookEvent(makeEvent('report.completed', 'clear'))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(mockPrisma.driver.findFirst).not.toHaveBeenCalled();
    });

    it('signals retry (503) when the lease just expired (claim miss but no marker)', async () => {
      mockRedis.set.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue(null);
      await expect(service.handleWebhookEvent(makeEvent('report.completed', 'clear'))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('processes the same event id only once across duplicate deliveries', async () => {
      // Delivery 1 processes; delivery 2 sees the done marker.
      await service.handleWebhookEvent(makeEvent('report.completed', 'clear'));
      mockRedis.set.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue('done');
      await service.handleWebhookEvent(makeEvent('report.completed', 'clear'));
      expect(mockPrisma.driver.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('failure / crash safety', () => {
    it('crash BEFORE the DB write: releases the lease and rethrows (retryable), then a retry succeeds', async () => {
      mockPrisma.driver.findFirst.mockRejectedValueOnce(new Error('db down'));
      await expect(service.handleWebhookEvent(makeEvent('report.completed', 'clear'))).rejects.toThrow('db down');
      expect(mockRedis.del).toHaveBeenCalledWith(V2_KEY);
      expect(mockPrisma.driver.update).not.toHaveBeenCalled();
      // retry
      jest.clearAllMocks();
      mockRedis.set.mockResolvedValue('OK');
      mockPrisma.driver.findFirst.mockResolvedValue(mockDriver);
      mockPrisma.driver.update.mockResolvedValue({});
      mockActivation.maybeActivate.mockResolvedValue({ outcome: 'activated' });
      await service.handleWebhookEvent(makeEvent('report.completed', 'clear'));
      expect(mockPrisma.driver.update).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalledWith(V2_KEY, 'done', 'EX', 86400);
    });

    it('failure writing the completion marker: releases the lease and rethrows (retry reprocesses)', async () => {
      mockRedis.set.mockImplementation((_k: string, v: string) =>
        v === 'done' ? Promise.reject(new Error('redis down')) : Promise.resolve('OK'),
      );
      await expect(service.handleWebhookEvent(makeEvent('report.completed', 'clear'))).rejects.toThrow('redis down');
      expect(mockActivation.maybeActivate).toHaveBeenCalled(); // work happened
      expect(mockRedis.del).toHaveBeenCalledWith(V2_KEY); // lease released
    });

    it('Redis claim failure: rethrows and leaves no lease to delete', async () => {
      mockRedis.set.mockRejectedValueOnce(new Error('redis down'));
      await expect(service.handleWebhookEvent(makeEvent('report.completed', 'clear'))).rejects.toThrow('redis down');
      expect(mockPrisma.driver.findFirst).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('event routing', () => {
    it('ignores (acks) unsupported event types without a retry', async () => {
      await expect(service.handleWebhookEvent(makeEvent('candidate.created', 'pending'))).resolves.toBeUndefined();
      expect(mockPrisma.driver.findFirst).not.toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalledWith(V2_KEY, 'done', 'EX', 86400); // marked done, no retry
    });

    it('also handles report.updated event type', async () => {
      await service.handleWebhookEvent(makeEvent('report.updated', 'clear'));
      expect(mockPrisma.driver.update).toHaveBeenCalled();
    });
  });

  describe('unknown driver — bounded retry', () => {
    it('retries (503) while within the bounded window and releases the lease', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);
      await expect(
        service.handleWebhookEvent(makeEvent('report.completed', 'clear', 'rpt_unknown')),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(mockRedis.incr).toHaveBeenCalledWith(`checkr:event:unknown:${EVENT_ID}`);
      expect(mockRedis.del).toHaveBeenCalledWith(V2_KEY);
      expect(mockRedis.set).not.toHaveBeenCalledWith(V2_KEY, 'done', 'EX', 86400);
    });

    it('stops retrying (acks 200) after the attempt limit is exceeded', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(6); // > UNKNOWN_DRIVER_MAX_ATTEMPTS
      await expect(
        service.handleWebhookEvent(makeEvent('report.completed', 'clear', 'rpt_unknown')),
      ).resolves.toBeUndefined();
      expect(mockRedis.set).toHaveBeenCalledWith(V2_KEY, 'done', 'EX', 86400); // done → no more retries
    });
  });

  describe('clear result — delegates activation, never writes status directly', () => {
    it('records ONLY the background-check clear evidence and delegates to maybeActivate', async () => {
      await service.handleWebhookEvent(makeEvent('report.completed', 'clear'));
      expect(mockPrisma.driver.update).toHaveBeenCalledWith({
        where: { id: mockDriver.id },
        data: { backgroundCheckStatus: 'clear', backgroundCheckClearedAt: expect.any(Date) },
      });
      expect(mockActivation.maybeActivate).toHaveBeenCalledTimes(1);
      expect(mockActivation.maybeActivate).toHaveBeenCalledWith(
        mockDriver.id,
        expect.objectContaining({ notes: expect.any(String) }),
      );
    });

    it('never writes status=approved / onboardingStep=complete, and never publishes driver:approved', async () => {
      await service.handleWebhookEvent(makeEvent('report.completed', 'clear'));
      const badWrite = mockPrisma.driver.update.mock.calls.find(
        ([arg]: [any]) => arg?.data?.status === 'approved' || arg?.data?.onboardingStep === 'complete',
      );
      expect(badWrite).toBeUndefined();
      expect(mockRedis.publish).not.toHaveBeenCalledWith('driver:approved', expect.anything());
    });

    it('does not record or activate an already-approved or declined driver', async () => {
      for (const status of ['approved', 'declined']) {
        jest.clearAllMocks();
        mockRedis.set.mockResolvedValue('OK');
        mockPrisma.driver.findFirst.mockResolvedValue({ ...mockDriver, status });
        await service.handleWebhookEvent(makeEvent('report.completed', 'clear'));
        expect(mockPrisma.driver.update).not.toHaveBeenCalled();
        expect(mockActivation.maybeActivate).not.toHaveBeenCalled();
      }
    });
  });

  describe('consider result — conditional, replay-safe FCRA pre-adverse', () => {
    it('on the causing transition (count===1) sets the waiting timer and publishes pre_adverse', async () => {
      mockPrisma.driver.updateMany.mockResolvedValue({ count: 1 });
      await service.handleWebhookEvent(makeEvent('report.completed', 'consider'));
      expect(mockPrisma.driver.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: mockDriver.id,
            backgroundCheckStatus: { notIn: ['consider', 'adverse_action', 'disputed'] },
            status: { notIn: ['suspended', 'declined'] },
          }),
          data: { backgroundCheckStatus: 'consider' },
        }),
      );
      expect(mockRedis.setex).toHaveBeenCalledWith(`bgc:adverse_waiting:${mockDriver.id}`, 7 * 24 * 60 * 60, expect.any(String));
      expect(mockRedis.publish).toHaveBeenCalledWith('driver:bgc:pre_adverse_action', expect.stringContaining(mockDriver.id));
    });

    it('REPLAY (count===0): does NOT reset the FCRA waiting timer and does NOT re-publish pre_adverse', async () => {
      mockPrisma.driver.updateMany.mockResolvedValue({ count: 0 });
      await service.handleWebhookEvent(makeEvent('report.completed', 'consider'));
      expect(mockRedis.setex).not.toHaveBeenCalled();
      expect(mockRedis.publish).not.toHaveBeenCalledWith('driver:bgc:pre_adverse_action', expect.anything());
    });

    it('TERMINAL-STATE PROTECTION: a late consider for an already-suspended driver changes nothing', async () => {
      // Suspended driver carries status='suspended' + backgroundCheckStatus='adverse_action'.
      // The conditional updateMany WHERE excludes BOTH terminal states, so a real
      // DB matches zero rows → count===0 → no bg/status change, no notice, no timer.
      mockPrisma.driver.findFirst.mockResolvedValue({
        ...mockDriver,
        status: 'suspended',
        backgroundCheckStatus: 'adverse_action',
      });
      mockPrisma.driver.updateMany.mockResolvedValue({ count: 0 });

      await service.handleWebhookEvent(makeEvent('report.completed', 'consider'));

      // The guards that make it a no-op at the DB level:
      expect(mockPrisma.driver.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            backgroundCheckStatus: { notIn: ['consider', 'adverse_action', 'disputed'] },
            status: { notIn: ['suspended', 'declined'] },
          }),
        }),
      );
      // count===0 → adverse_action is never clobbered back to consider, and nothing fires:
      expect(mockRedis.setex).not.toHaveBeenCalled();
      expect(mockRedis.publish).not.toHaveBeenCalledWith('driver:bgc:pre_adverse_action', expect.anything());
    });
  });

  describe('suspended / canceled — conditional, replay-safe final adverse', () => {
    it('on the causing transition (count===1) suspends, removes from dispatch, publishes final_adverse', async () => {
      mockPrisma.driver.updateMany.mockResolvedValue({ count: 1 });
      await service.handleWebhookEvent(makeEvent('report.completed', 'suspended'));
      expect(mockPrisma.driver.updateMany).toHaveBeenCalledWith({
        where: { id: mockDriver.id, status: { not: 'suspended' } },
        data: { backgroundCheckStatus: 'adverse_action', status: 'suspended', isAvailable: false },
      });
      expect(mockRedis.del).toHaveBeenCalledWith(`driver:${mockDriver.userId}:location`);
      expect(mockRedis.zrem).toHaveBeenCalledWith('drivers:geo', mockDriver.userId);
      expect(mockRedis.publish).toHaveBeenCalledWith('driver:bgc:final_adverse_action', expect.stringContaining(mockDriver.id));
    });

    it('REPLAY (count===0): still removes from dispatch but does NOT re-publish final_adverse', async () => {
      mockPrisma.driver.updateMany.mockResolvedValue({ count: 0 });
      await service.handleWebhookEvent(makeEvent('report.completed', 'suspended'));
      expect(mockRedis.del).toHaveBeenCalled();
      expect(mockRedis.zrem).toHaveBeenCalled();
      expect(mockRedis.publish).not.toHaveBeenCalledWith('driver:bgc:final_adverse_action', expect.anything());
    });

    it('treats canceled the same as suspended (conditional adverse_action)', async () => {
      mockPrisma.driver.updateMany.mockResolvedValue({ count: 1 });
      await service.handleWebhookEvent(makeEvent('report.completed', 'canceled'));
      expect(mockPrisma.driver.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'suspended' }) }),
      );
      expect(mockRedis.publish).toHaveBeenCalledWith('driver:bgc:final_adverse_action', expect.any(String));
    });
  });
});
