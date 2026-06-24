// ─── Module mocks — must come before any imports that pull in real Twilio/Redis ──

const mockMessageInteractions = { create: jest.fn().mockResolvedValue({}) };

const mockParticipantInstance = () => ({
  messageInteractions: mockMessageInteractions,
});

const SESSION_SID = 'KS_SESSION_001';
const RIDER_P_SID = 'KP_RIDER_001';
const DRIVER_P_SID = 'KP_DRIVER_001';

const mockSessionObj = {
  update: jest.fn().mockResolvedValue({}),
  remove: jest.fn().mockResolvedValue({}),
  participants: Object.assign(
    jest.fn().mockReturnValue(mockParticipantInstance()),
    {
      create: jest
        .fn()
        .mockResolvedValueOnce({ sid: RIDER_P_SID, proxyIdentifier: '+15550001111' })
        .mockResolvedValueOnce({ sid: DRIVER_P_SID, proxyIdentifier: '+15550002222' }),
    },
  ),
};

const mockSessionsCreate = jest.fn().mockResolvedValue({ sid: SESSION_SID });

const mockServices = jest.fn().mockReturnValue({
  sessions: Object.assign(jest.fn().mockReturnValue(mockSessionObj), {
    create: mockSessionsCreate,
  }),
});

const mockTwilioInstance = { proxy: { v1: { services: mockServices } } };

jest.mock('twilio', () => ({
  Twilio: jest.fn().mockImplementation(() => mockTwilioInstance),
}));

// Redis mock — shared instance, methods overridden per-test via mockResolvedValue
const mockRedis: Record<string, jest.Mock> = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockRedis),
}));

// ─── Actual imports ────────────────────────────────────────────────────────────

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProxyService } from './proxy.service';
import { PrismaService } from '../prisma/prisma.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeConfig = () => ({
  getOrThrow: jest.fn().mockImplementation((key: string) => {
    const vals: Record<string, string> = {
      TWILIO_ACCOUNT_SID: 'ACxxx',
      TWILIO_AUTH_TOKEN: 'auth_token',
      TWILIO_PROXY_SERVICE_SID: 'KSxxx',
    };
    return vals[key] ?? key;
  }),
  get: jest.fn().mockImplementation((_key: string, def?: unknown) => def),
});

const makePrisma = (proxyRecord?: Record<string, unknown> | null) => ({
  proxySession: {
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(proxyRecord ?? null),
    findUnique: jest.fn().mockResolvedValue(proxyRecord ?? null),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
});

async function buildService(prismaOverride?: Record<string, unknown> | null) {
  const prisma = makePrisma(prismaOverride);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProxyService,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: makeConfig() },
    ],
  }).compile();

  return { service: module.get<ProxyService>(ProxyService), prisma };
}

// ─── Test data ────────────────────────────────────────────────────────────────

const TRIP_ID = 'trip-uuid-0001';
const RIDER_PHONE = '+12015550001';
const DRIVER_PHONE = '+12015550002';

const sampleSessionJson = JSON.stringify({
  tripId: TRIP_ID,
  twilioSessionSid: SESSION_SID,
  riderParticipantSid: RIDER_P_SID,
  driverParticipantSid: DRIVER_P_SID,
  riderProxyNumber: '+15550001111',
  driverProxyNumber: '+15550002222',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  mockRedis.incr.mockResolvedValue(1);
  mockSessionObj.participants.create
    .mockResolvedValueOnce({ sid: RIDER_P_SID, proxyIdentifier: '+15550001111' })
    .mockResolvedValueOnce({ sid: DRIVER_P_SID, proxyIdentifier: '+15550002222' });
});

describe('ProxyService', () => {
  describe('createSession', () => {
    it('creates Twilio session and both participants', async () => {
      const { service } = await buildService();

      const result = await service.createSession(TRIP_ID, RIDER_PHONE, DRIVER_PHONE);

      expect(result.tripId).toBe(TRIP_ID);
      expect(result.twilioSessionSid).toBe(SESSION_SID);
      expect(result.riderParticipantSid).toBe(RIDER_P_SID);
      expect(result.driverParticipantSid).toBe(DRIVER_P_SID);
      expect(mockServices).toHaveBeenCalledWith('KSxxx');
    });

    it('persists session to DB', async () => {
      const { service, prisma } = await buildService();

      await service.createSession(TRIP_ID, RIDER_PHONE, DRIVER_PHONE);

      expect(prisma.proxySession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tripId: TRIP_ID,
            twilioSessionSid: SESSION_SID,
            riderParticipantSid: RIDER_P_SID,
            driverParticipantSid: DRIVER_P_SID,
          }),
        }),
      );
    });

    it('caches session in Redis with TTL', async () => {
      const { service } = await buildService();

      await service.createSession(TRIP_ID, RIDER_PHONE, DRIVER_PHONE);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `proxy:session:trip:${TRIP_ID}`,
        expect.any(Number),
        expect.stringContaining(SESSION_SID),
      );
    });

    it('throws ConflictException if session already exists for trip', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      const { service } = await buildService();

      await expect(service.createSession(TRIP_ID, RIDER_PHONE, DRIVER_PHONE)).rejects.toThrow(
        ConflictException,
      );
    });

    it('emits session.created audit log', async () => {
      const { service } = await buildService();

      await service.createSession(TRIP_ID, RIDER_PHONE, DRIVER_PHONE);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'proxy:audit',
        expect.stringContaining('session.created'),
      );
    });
  });

  describe('closeSession', () => {
    it('removes Twilio session and clears Redis', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      const { service } = await buildService();

      await service.closeSession(TRIP_ID);

      // services() is always called with proxyServiceSid ('KSxxx'), not the session SID
      expect(mockSessionObj.remove).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith(`proxy:session:trip:${TRIP_ID}`);
    });

    it('updates DB status to closed', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      const { service, prisma } = await buildService();

      await service.closeSession(TRIP_ID);

      expect(prisma.proxySession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tripId: TRIP_ID, status: 'active' },
          data: expect.objectContaining({ status: 'closed' }),
        }),
      );
    });

    it('is a no-op when no session in Redis', async () => {
      mockRedis.get.mockResolvedValue(null);
      const { service, prisma } = await buildService();

      await expect(service.closeSession(TRIP_ID)).resolves.toBeUndefined();
      expect(prisma.proxySession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('sendMaskedSms', () => {
    it('sends message via Twilio Proxy participant interaction', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      const { service } = await buildService();

      await service.sendMaskedSms(TRIP_ID, 'rider', 'Hey driver, I am outside');

      expect(mockMessageInteractions.create).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'Hey driver, I am outside' }),
      );
    });

    it('rate-limits against rider participant SID', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      const { service } = await buildService();

      await service.sendMaskedSms(TRIP_ID, 'rider', 'test');

      expect(mockRedis.incr).toHaveBeenCalledWith(`proxy:sms_rate:${RIDER_P_SID}`);
    });

    it('rate-limits against driver participant SID', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      const { service } = await buildService();

      await service.sendMaskedSms(TRIP_ID, 'driver', 'test');

      expect(mockRedis.incr).toHaveBeenCalledWith(`proxy:sms_rate:${DRIVER_P_SID}`);
    });

    it('throws NotFoundException when no proxy session exists', async () => {
      mockRedis.get.mockResolvedValue(null);
      const { service } = await buildService();

      await expect(service.sendMaskedSms(TRIP_ID, 'rider', 'test')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 429 when SMS rate limit exceeded', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      mockRedis.incr.mockResolvedValue(6); // exceeds SMS_MAX_PER_MINUTE = 5
      const { service } = await buildService();

      const err = await service.sendMaskedSms(TRIP_ID, 'rider', 'spam').catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
    });

    it('publishes sms.failed audit when Twilio throws', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      mockMessageInteractions.create.mockRejectedValueOnce(new Error('Twilio error'));
      const { service } = await buildService();

      await expect(service.sendMaskedSms(TRIP_ID, 'rider', 'test')).rejects.toThrow();
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'proxy:audit',
        expect.stringContaining('sms.failed'),
      );
    });
  });

  describe('initiateCall', () => {
    it('returns riderProxyNumber for rider', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      const { service } = await buildService();

      const result = await service.initiateCall(TRIP_ID, 'rider');

      expect(result.proxyNumber).toBe('+15550001111');
    });

    it('returns driverProxyNumber for driver', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      const { service } = await buildService();

      const result = await service.initiateCall(TRIP_ID, 'driver');

      expect(result.proxyNumber).toBe('+15550002222');
    });

    it('throws NotFoundException when no proxy session exists', async () => {
      mockRedis.get.mockResolvedValue(null);
      const { service } = await buildService();

      await expect(service.initiateCall(TRIP_ID, 'rider')).rejects.toThrow(NotFoundException);
    });

    it('throws 429 when call rate limit exceeded', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      mockRedis.incr.mockResolvedValue(4); // exceeds CALL_MAX_PER_MINUTE = 3
      const { service } = await buildService();

      const err = await service.initiateCall(TRIP_ID, 'rider').catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
    });

    it('publishes call.started audit log', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      const { service } = await buildService();

      await service.initiateCall(TRIP_ID, 'rider');

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'proxy:audit',
        expect.stringContaining('call.started'),
      );
    });
  });

  describe('webhook handlers', () => {
    describe('handleSmsWebhook', () => {
      it('publishes sms.failed for failed MessageStatus', async () => {
        const { service } = await buildService({ tripId: TRIP_ID });

        await service.handleSmsWebhook({
          SessionSid: SESSION_SID,
          ParticipantSid: RIDER_P_SID,
          Body: 'test',
          MessageStatus: 'failed',
        });

        expect(mockRedis.publish).toHaveBeenCalledWith(
          'proxy:audit',
          expect.stringContaining('sms.failed'),
        );
      });

      it('publishes sms.sent for delivered MessageStatus', async () => {
        const { service } = await buildService({ tripId: TRIP_ID });

        await service.handleSmsWebhook({
          SessionSid: SESSION_SID,
          ParticipantSid: RIDER_P_SID,
          Body: 'hi',
          MessageStatus: 'delivered',
        });

        expect(mockRedis.publish).toHaveBeenCalledWith(
          'proxy:audit',
          expect.stringContaining('sms.sent'),
        );
      });
    });

    describe('handleCallWebhook', () => {
      it('publishes call.completed for completed CallStatus', async () => {
        const { service } = await buildService({ tripId: TRIP_ID });

        await service.handleCallWebhook({
          SessionSid: SESSION_SID,
          ParticipantSid: RIDER_P_SID,
          CallStatus: 'completed',
        });

        expect(mockRedis.publish).toHaveBeenCalledWith(
          'proxy:audit',
          expect.stringContaining('call.completed'),
        );
      });

      it('publishes call.failed for no-answer CallStatus', async () => {
        const { service } = await buildService({ tripId: TRIP_ID });

        await service.handleCallWebhook({
          SessionSid: SESSION_SID,
          ParticipantSid: DRIVER_P_SID,
          CallStatus: 'no-answer',
        });

        expect(mockRedis.publish).toHaveBeenCalledWith(
          'proxy:audit',
          expect.stringContaining('call.failed'),
        );
      });
    });

    describe('handleSessionExpiredWebhook', () => {
      it('marks session expired in DB and clears Redis', async () => {
        const { service, prisma } = await buildService({ tripId: TRIP_ID, twilioSessionSid: SESSION_SID });

        await service.handleSessionExpiredWebhook({ SessionSid: SESSION_SID });

        expect(mockRedis.del).toHaveBeenCalledWith(`proxy:session:trip:${TRIP_ID}`);
        expect(prisma.proxySession.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { twilioSessionSid: SESSION_SID },
            data: expect.objectContaining({ status: 'expired' }),
          }),
        );
      });

      it('publishes session.expired audit log', async () => {
        const { service } = await buildService({ tripId: TRIP_ID, twilioSessionSid: SESSION_SID });

        await service.handleSessionExpiredWebhook({ SessionSid: SESSION_SID });

        expect(mockRedis.publish).toHaveBeenCalledWith(
          'proxy:audit',
          expect.stringContaining('session.expired'),
        );
      });

      it('is a no-op when session record not found in DB', async () => {
        const { service, prisma } = await buildService(null);

        await expect(
          service.handleSessionExpiredWebhook({ SessionSid: 'KS_UNKNOWN' }),
        ).resolves.toBeUndefined();
        expect(prisma.proxySession.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  describe('rate limiting', () => {
    it('allows SMS exactly at the limit (count = 5)', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      mockRedis.incr.mockResolvedValue(5);
      const { service } = await buildService();

      await expect(service.sendMaskedSms(TRIP_ID, 'rider', 'ok')).resolves.toBeUndefined();
    });

    it('blocks SMS one over the limit (count = 6)', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      mockRedis.incr.mockResolvedValue(6);
      const { service } = await buildService();

      const err = await service.sendMaskedSms(TRIP_ID, 'rider', 'spam').catch((e) => e);
      expect((err as HttpException).getStatus()).toBe(429);
    });

    it('allows calls exactly at the limit (count = 3)', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      mockRedis.incr.mockResolvedValue(3);
      const { service } = await buildService();

      await expect(service.initiateCall(TRIP_ID, 'rider')).resolves.toBeDefined();
    });

    it('blocks calls one over the limit (count = 4)', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      mockRedis.incr.mockResolvedValue(4);
      const { service } = await buildService();

      const err = await service.initiateCall(TRIP_ID, 'rider').catch((e) => e);
      expect((err as HttpException).getStatus()).toBe(429);
    });

    it('sets expire TTL on first increment (count = 1)', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      mockRedis.incr.mockResolvedValue(1);
      const { service } = await buildService();

      await service.sendMaskedSms(TRIP_ID, 'rider', 'first');

      expect(mockRedis.expire).toHaveBeenCalledWith(expect.stringContaining('sms_rate'), 60);
    });

    it('does not reset TTL on subsequent increments (count = 2)', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      mockRedis.incr.mockResolvedValue(2);
      const { service } = await buildService();

      await service.sendMaskedSms(TRIP_ID, 'rider', 'second');

      expect(mockRedis.expire).not.toHaveBeenCalled();
    });
  });

  describe('scheduleExpiry', () => {
    it('updates Redis key with new TTL', async () => {
      mockRedis.get.mockResolvedValue(sampleSessionJson);
      const { service } = await buildService();

      await service.scheduleExpiry(TRIP_ID, new Date());

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `proxy:session:trip:${TRIP_ID}`,
        expect.any(Number),
        expect.any(String),
      );
    });

    it('is a no-op when no session in Redis', async () => {
      mockRedis.get.mockResolvedValue(null);
      const { service } = await buildService();

      await service.scheduleExpiry(TRIP_ID, new Date());

      expect(mockRedis.setex).not.toHaveBeenCalled();
    });
  });
});
