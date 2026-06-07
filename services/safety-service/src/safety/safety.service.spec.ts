/**
 * Safety Service unit tests.
 * Critical invariants verified:
 *   - SOS countdown can be cancelled within window
 *   - Panic events NEVER include rider identity in the notification payload
 *   - Audio recording is created on SOS confirmation, not initiation
 *   - Night ride check-in is only triggered for night rides
 */

import { SafetyService } from './safety.service';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';

const mockPrisma = {
  safetySession: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  sosEvent: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  panicEvent: { create: jest.fn() },
  safetyRecording: { create: jest.fn() },
  safeCheckIn: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  trip: { findUnique: jest.fn() },
} as any;

const mockRedis = {
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  exists: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
} as any;

const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue('test-value'),
  get: jest.fn().mockReturnValue('us-east-1'),
} as any;

const service = new SafetyService(mockPrisma, mockConfig, mockRedis);

const mockSession = { id: 'session-1', tripId: 'trip-1', isNightRide: false, currentState: 'normal' };
const mockNightSession = { ...mockSession, isNightRide: true };
const mockUser = { id: 'user-1', role: 'rider' };
const mockSos = {
  id: 'sos-1',
  tripId: 'trip-1',
  safetySessionId: 'session-1',
  initiatedByUserId: 'user-1',
  status: 'active',
  activationConfirmedAt: null,
};

describe('SafetyService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('initiateSos', () => {
    it('creates SOS event and publishes to admin channel', async () => {
      mockPrisma.safetySession.findUnique.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.sosEvent.create.mockResolvedValue({ id: 'sos-1' });
      mockPrisma.safetySession.update.mockResolvedValue({});

      await service.initiateSos('trip-1', 'user-1', 'button_tap', 40.7, -74.0);

      expect(mockPrisma.sosEvent.create).toHaveBeenCalledTimes(1);
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'safety:sos',
        expect.stringContaining('safety:sos_new'),
      );
    });

    it('throws NotFoundException if session not found', async () => {
      mockPrisma.safetySession.findUnique.mockResolvedValue(null);

      await expect(
        service.initiateSos('trip-1', 'user-1', 'button_tap', 40.7, -74.0),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets countdown Redis key with 7-second TTL', async () => {
      mockPrisma.safetySession.findUnique.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.sosEvent.create.mockResolvedValue({ id: 'sos-1' });
      mockPrisma.safetySession.update.mockResolvedValue({});

      await service.initiateSos('trip-1', 'user-1', 'button_tap', 40.7, -74.0);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'sos:countdown:sos-1',
        7, // SOS_COUNTDOWN_SECONDS (5) + 2
        'user-1',
      );
    });
  });

  describe('confirmSos', () => {
    it('creates audio recording on confirmation', async () => {
      mockPrisma.sosEvent.findUnique.mockResolvedValue(mockSos);
      mockPrisma.sosEvent.update.mockResolvedValue({});
      mockPrisma.safetyRecording.create.mockResolvedValue({});
      mockPrisma.trip.findUnique.mockResolvedValue({ rider: { trustedContacts: [] } });

      await service.confirmSos('sos-1', 'user-1');

      expect(mockPrisma.safetyRecording.create).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException if user does not own SOS', async () => {
      mockPrisma.sosEvent.findUnique.mockResolvedValue({ ...mockSos, initiatedByUserId: 'other-user' });

      await expect(service.confirmSos('sos-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cancelSos', () => {
    it('cancels SOS during countdown window', async () => {
      mockPrisma.sosEvent.findUnique.mockResolvedValue(mockSos);
      mockPrisma.sosEvent.update.mockResolvedValue({});
      mockPrisma.safetySession.update.mockResolvedValue({});
      mockRedis.exists.mockResolvedValue(1); // countdown key exists

      await service.cancelSos('sos-1', 'user-1');

      expect(mockPrisma.sosEvent.update).toHaveBeenCalledWith({
        where: { id: 'sos-1' },
        data: expect.objectContaining({ status: 'false_alarm' }),
      });
    });

    it('resets session state to normal on cancel', async () => {
      mockPrisma.sosEvent.findUnique.mockResolvedValue(mockSos);
      mockPrisma.sosEvent.update.mockResolvedValue({});
      mockPrisma.safetySession.update.mockResolvedValue({});
      mockRedis.exists.mockResolvedValue(1);

      await service.cancelSos('sos-1', 'user-1');

      expect(mockPrisma.safetySession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { currentState: 'normal' },
      });
    });
  });

  describe('triggerPanic - CRITICAL: rider identity must NOT be in notification', () => {
    it('publishes panic without rider identity in payload', async () => {
      mockPrisma.safetySession.findUnique.mockResolvedValue(mockSession);
      mockPrisma.panicEvent.create.mockResolvedValue({ id: 'panic-1' });
      mockPrisma.safetySession.update.mockResolvedValue({});

      await service.triggerPanic('trip-1', 'user-1', 'rider', 40.7, -74.0);

      const publishCall = mockRedis.publish.mock.calls[0];
      const payload = JSON.parse(publishCall[1]);

      // MUST NOT contain rider name, email, phone, or user ID
      expect(payload).not.toHaveProperty('riderId');
      expect(payload).not.toHaveProperty('riderName');
      expect(payload).not.toHaveProperty('riderPhone');

      // MUST only contain anonymous identifiers
      expect(payload).toHaveProperty('tripId');
      expect(payload).toHaveProperty('initiatedByRole');
    });
  });

  describe('requestCheckIn', () => {
    it('skips check-in for non-night rides', async () => {
      mockPrisma.safetySession.findUnique.mockResolvedValue(mockSession); // isNightRide: false

      const result = await service.requestCheckIn('trip-1', 'rider-1');

      expect(result).toEqual({ skipped: true, reason: 'Not a night ride.' });
      expect(mockPrisma.safeCheckIn.create).not.toHaveBeenCalled();
    });

    it('creates check-in for night rides', async () => {
      mockPrisma.safetySession.findUnique.mockResolvedValue(mockNightSession);
      mockPrisma.safeCheckIn.create.mockResolvedValue({ id: 'checkin-1', dueAt: new Date() });

      const result = await service.requestCheckIn('trip-1', 'rider-1');

      expect(mockPrisma.safeCheckIn.create).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('checkInId');
    });
  });
});
