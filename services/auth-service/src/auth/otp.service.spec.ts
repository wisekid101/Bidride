import { OtpService } from './otp.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';

const mockRedis = {
  incr: jest.fn(),
  expire: jest.fn(),
  setex: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  ttl: jest.fn().mockResolvedValue(240),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'NODE_ENV') return 'development';
    return null;
  }),
  getOrThrow: jest.fn(),
} as unknown as ConfigService;

const service = new OtpService(mockRedis as any, mockConfig);

describe('OtpService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('sendOtp', () => {
    it('sends OTP and stores in Redis', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.setex.mockResolvedValue('OK');

      await service.sendOtp('+12015551234');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'otp:+12015551234',
        300,
        expect.stringMatching(/"code":"\d{6}"/),
      );
    });

    it('throws rate limit error on 4th request within window', async () => {
      mockRedis.incr.mockResolvedValue(4);

      await expect(service.sendOtp('+12015551234')).rejects.toThrow(BadRequestException);
    });

    it('allows up to 3 OTP sends', async () => {
      mockRedis.incr.mockResolvedValue(3);
      mockRedis.setex.mockResolvedValue('OK');

      await expect(service.sendOtp('+12015551234')).resolves.not.toThrow();
    });
  });

  describe('verifyOtp', () => {
    it('verifies correct OTP and deletes from Redis', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ code: '123456', attempts: 0 }));
      mockRedis.del.mockResolvedValue(1);

      const result = await service.verifyOtp('+12015551234', '123456');
      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('otp:+12015551234');
    });

    it('throws on incorrect OTP and increments attempts', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ code: '123456', attempts: 0 }));
      mockRedis.setex.mockResolvedValue('OK');

      await expect(service.verifyOtp('+12015551234', '999999')).rejects.toThrow(BadRequestException);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'otp:+12015551234',
        expect.any(Number),
        expect.stringMatching(/"attempts":1/),
      );
    });

    it('throws on expired OTP (Redis returns null)', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.verifyOtp('+12015551234', '123456')).rejects.toThrow(BadRequestException);
    });

    it('locks after 5 failed attempts', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ code: '123456', attempts: 5 }));
      mockRedis.del.mockResolvedValue(1);

      await expect(service.verifyOtp('+12015551234', '999999')).rejects.toThrow(BadRequestException);
      expect(mockRedis.del).toHaveBeenCalled(); // Deletes OTP to force new request
    });
  });
});
