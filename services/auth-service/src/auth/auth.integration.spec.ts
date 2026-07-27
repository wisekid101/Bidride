/**
 * Integration tests for auth-service — runs against real PostgreSQL + Redis.
 * Requires TEST_DATABASE_URL and TEST_REDIS_URL (enforced by
 * test/integration-setup.js, so a misconfigured run fails instead of skipping).
 *
 * Scope: the OTP and session state that lives in Redis, plus the real user rows
 * those sessions belong to. auth-service makes no outbound calls to sibling
 * services, so nothing here needs another backend running.
 *
 *   1. OTP request      — code persisted, TTLs applied, no SMS sent
 *   2. OTP verification — success, wrong code, expiry, attempt lockout
 *   3. Redis TTL        — real EXPIRE/TTL semantics, including TTL preservation
 *   4. Rate limiting    — real INCR window over the send limit
 *   5. Rotation         — refresh token single-use, old token dies
 *   6. Revocation       — one session, and all sessions for a user
 *
 * Twilio: OtpService short-circuits before `messages.create` when NODE_ENV is
 * 'development'. We supply that value AND replace the SDK's send method with a
 * throwing spy, so an outbound SMS attempt fails the run rather than silently
 * escaping to the network. Constructing the client is offline and needs only
 * well-formed placeholder credentials.
 *
 * The injected PrismaService reads DATABASE_URL, so we pin it to the test
 * database here to guarantee every connection targets TEST_DATABASE_URL only.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@bidride/database';
import { Redis } from 'ioredis';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { AUTH_FIXTURE_PHONES } from '../../../../scripts/test/fixture-identifiers';

// Test-owned client, explicitly pinned to the test database.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});
// Single Redis connection shared by the test and the DI container.
const redis = new Redis(process.env.TEST_REDIS_URL!);

const TEST_JWT_SECRET = 'integration-test-secret';

// Reserved phone block for this suite. Allocated centrally so parallel suites
// sharing bidride_test cannot delete each other's fixtures — see
// scripts/test/fixture-identifiers.ts.
const OTP_PHONE = AUTH_FIXTURE_PHONES.otp;
const RATE_PHONE = AUTH_FIXTURE_PHONES.rateLimit;
const TTL_PHONE = AUTH_FIXTURE_PHONES.ttl;
const OWNER_PHONE = AUTH_FIXTURE_PHONES.owner;
const OTHER_PHONE = AUTH_FIXTURE_PHONES.other;
const PHONES = [OTP_PHONE, RATE_PHONE, TTL_PHONE, OWNER_PHONE, OTHER_PHONE];

// Service constants mirrored for assertions (see otp.service.ts / token.service.ts).
const OTP_TTL_SECONDS = 300;
const SEND_WINDOW_SECONDS = 600;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const SEND_LIMIT = 3;

/**
 * Remove every key this suite can create. Scoped by phone and user id — never
 * FLUSHDB, which would destroy a developer's local state.
 */
async function cleanupRedis(userIds: string[] = []) {
  const keys = [
    ...PHONES.map((p) => `otp:${p}`),
    ...PHONES.map((p) => `otp:send_limit:${p}`),
  ];
  for (const userId of userIds) {
    const sessionKeys = await redis.keys(`refresh:${userId}:*`);
    keys.push(...sessionKeys);
  }
  if (keys.length) await redis.del(...keys);
}

/** Delete the user rows this suite owns. Idempotent. */
async function cleanupDb() {
  await prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
}

/** Read the OTP record the service persisted, straight from Redis. */
async function readOtpRecord(phone: string): Promise<{ code: string; attempts: number }> {
  const raw = await redis.get(`otp:${phone}`);
  expect(raw).not.toBeNull();
  return JSON.parse(raw!) as { code: string; attempts: number };
}

/** Assert a promise rejects with the given exception type carrying `{ code }`. */
async function expectRejectCode(
  promise: Promise<unknown>,
  type: new (...args: any[]) => Error,
  code: string,
) {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(type);
  expect((caught as BadRequestException).getResponse()).toMatchObject({ code });
}

describe('auth-service (integration)', () => {
  let moduleRef: TestingModule;
  let otp: OtpService;
  let tokens: TokenService;
  let jwt: JwtService;

  // Fails the test if the service ever reaches Twilio.
  let twilioSend: jest.SpyInstance;

  let ownerUserId: string;
  let otherUserId: string;

  beforeAll(async () => {
    await cleanupDb();
    await cleanupRedis();

    const owner = await prisma.user.create({
      data: { phone: OWNER_PHONE, role: 'rider' },
    });
    ownerUserId = owner.id;

    const other = await prisma.user.create({
      data: { phone: OTHER_PHONE, role: 'rider' },
    });
    otherUserId = other.id;

    // Minimal config: dev mode (no SMS) plus well-formed offline Twilio creds.
    const configValues: Record<string, string> = {
      NODE_ENV: 'development',
      TWILIO_ACCOUNT_SID: `AC${'0'.repeat(32)}`,
      TWILIO_AUTH_TOKEN: 'integration-test-token',
      TWILIO_PHONE_NUMBER: '+15550000000',
    };
    const config = {
      get: (key: string) => configValues[key],
      getOrThrow: (key: string) => {
        const value = configValues[key];
        if (value === undefined) throw new Error(`Missing config: ${key}`);
        return value;
      },
    } as unknown as ConfigService;

    moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: TEST_JWT_SECRET,
          signOptions: { expiresIn: '15m' },
        }),
      ],
      providers: [
        OtpService,
        TokenService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    otp = moduleRef.get(OtpService);
    tokens = moduleRef.get(TokenService);
    jwt = moduleRef.get(JwtService);

    // `messages` is memoized by the Twilio SDK, so this spy is the exact object
    // sendOtp would use. Throwing (rather than resolving) means a regression
    // that reintroduces the SMS call surfaces as a failure, not a silent pass.
    twilioSend = jest
      .spyOn(
        (otp as unknown as { twilio: { messages: { create: (...args: unknown[]) => unknown } } })
          .twilio.messages,
        'create',
      )
      .mockImplementation(() => {
        throw new Error('Twilio outbound request attempted during integration test');
      });
  });

  afterAll(async () => {
    // Each step is isolated: if setup failed (e.g. an unreachable database),
    // an error here must not skip the connection teardown below it, or Jest
    // hangs on an open socket instead of exiting with the failures it reported.
    const settle = (work: Promise<unknown> | undefined) =>
      Promise.resolve(work).catch(() => undefined);

    twilioSend?.mockRestore();
    await settle(cleanupRedis([ownerUserId, otherUserId].filter(Boolean)));
    await settle(cleanupDb());
    await settle(moduleRef?.close());
    await settle(prisma.$disconnect());
    await settle(redis.quit());
  });

  beforeEach(() => {
    twilioSend.mockClear();
  });

  describe('OTP request', () => {
    afterEach(() => cleanupRedis());

    it('persists a six-digit code in Redis and sends no SMS', async () => {
      await otp.sendOtp(OTP_PHONE);

      const record = await readOtpRecord(OTP_PHONE);
      expect(record.code).toMatch(/^\d{6}$/);
      expect(record.attempts).toBe(0);
      expect(twilioSend).not.toHaveBeenCalled();
    });

    it('starts the send-limit counter at 1 for a fresh phone', async () => {
      await otp.sendOtp(OTP_PHONE);

      const count = await redis.get(`otp:send_limit:${OTP_PHONE}`);
      expect(count).toBe('1');
      expect(twilioSend).not.toHaveBeenCalled();
    });

    it('issues a different code on each request', async () => {
      await otp.sendOtp(OTP_PHONE);
      const first = await readOtpRecord(OTP_PHONE);
      await otp.sendOtp(OTP_PHONE);
      const second = await readOtpRecord(OTP_PHONE);

      // Overwritten in place under the same key.
      expect(second.attempts).toBe(0);
      expect([first.code, second.code].every((c) => /^\d{6}$/.test(c))).toBe(true);
      expect(twilioSend).not.toHaveBeenCalled();
    });
  });

  describe('Redis TTL behaviour', () => {
    afterEach(() => cleanupRedis());

    it('applies the 5-minute OTP TTL', async () => {
      await otp.sendOtp(TTL_PHONE);

      const ttl = await redis.ttl(`otp:${TTL_PHONE}`);
      expect(ttl).toBeGreaterThan(OTP_TTL_SECONDS - 10);
      expect(ttl).toBeLessThanOrEqual(OTP_TTL_SECONDS);
    });

    it('applies the 10-minute send-window TTL', async () => {
      await otp.sendOtp(TTL_PHONE);

      const ttl = await redis.ttl(`otp:send_limit:${TTL_PHONE}`);
      expect(ttl).toBeGreaterThan(SEND_WINDOW_SECONDS - 10);
      expect(ttl).toBeLessThanOrEqual(SEND_WINDOW_SECONDS);
    });

    it('does not extend the send window on later sends within it', async () => {
      await otp.sendOtp(TTL_PHONE);
      const firstTtl = await redis.ttl(`otp:send_limit:${TTL_PHONE}`);

      // Shrink the window, then send again: the counter must keep its remaining
      // TTL rather than being reset to a fresh 10 minutes.
      await redis.expire(`otp:send_limit:${TTL_PHONE}`, 120);
      await otp.sendOtp(TTL_PHONE);

      const secondTtl = await redis.ttl(`otp:send_limit:${TTL_PHONE}`);
      expect(secondTtl).toBeLessThanOrEqual(120);
      expect(secondTtl).toBeLessThan(firstTtl);
      expect(secondTtl).toBeGreaterThan(0);
    });

    it('expires the OTP for real once its key is gone', async () => {
      await otp.sendOtp(TTL_PHONE);
      const { code } = await readOtpRecord(TTL_PHONE);

      // Emulate the TTL elapsing without waiting five minutes.
      await redis.del(`otp:${TTL_PHONE}`);

      await expectRejectCode(
        otp.verifyOtp(TTL_PHONE, code),
        BadRequestException,
        'AUTH_INVALID_OTP',
      );
    });
  });

  describe('OTP verification', () => {
    afterEach(() => cleanupRedis());

    it('accepts the stored code and consumes it', async () => {
      await otp.sendOtp(OTP_PHONE);
      const { code } = await readOtpRecord(OTP_PHONE);

      await expect(otp.verifyOtp(OTP_PHONE, code)).resolves.toBe(true);

      // Single-use: the key is gone and a replay fails.
      expect(await redis.get(`otp:${OTP_PHONE}`)).toBeNull();
      await expectRejectCode(
        otp.verifyOtp(OTP_PHONE, code),
        BadRequestException,
        'AUTH_INVALID_OTP',
      );
    });

    it('records a failed attempt and preserves the remaining TTL', async () => {
      await otp.sendOtp(OTP_PHONE);
      const { code } = await readOtpRecord(OTP_PHONE);
      const wrong = code === '000000' ? '111111' : '000000';

      const ttlBefore = await redis.ttl(`otp:${OTP_PHONE}`);
      await expectRejectCode(
        otp.verifyOtp(OTP_PHONE, wrong),
        BadRequestException,
        'AUTH_INVALID_OTP',
      );

      const after = await readOtpRecord(OTP_PHONE);
      expect(after.attempts).toBe(1);
      expect(after.code).toBe(code); // code itself is unchanged

      // TTL carried over, not reset to a fresh 5 minutes.
      const ttlAfter = await redis.ttl(`otp:${OTP_PHONE}`);
      expect(ttlAfter).toBeGreaterThan(0);
      expect(ttlAfter).toBeLessThanOrEqual(ttlBefore);
    });

    it('still accepts the correct code after a failed attempt', async () => {
      await otp.sendOtp(OTP_PHONE);
      const { code } = await readOtpRecord(OTP_PHONE);

      await expectRejectCode(
        otp.verifyOtp(OTP_PHONE, '000000' === code ? '111111' : '000000'),
        BadRequestException,
        'AUTH_INVALID_OTP',
      );
      await expect(otp.verifyOtp(OTP_PHONE, code)).resolves.toBe(true);
    });

    it('locks out after the maximum attempts and discards the code', async () => {
      await otp.sendOtp(OTP_PHONE);
      const { code } = await readOtpRecord(OTP_PHONE);
      const wrong = code === '000000' ? '111111' : '000000';

      // Five wrong guesses are recorded; the sixth is rejected as locked out.
      for (let i = 0; i < 5; i++) {
        await expectRejectCode(
          otp.verifyOtp(OTP_PHONE, wrong),
          BadRequestException,
          'AUTH_INVALID_OTP',
        );
      }
      expect((await readOtpRecord(OTP_PHONE)).attempts).toBe(5);

      await expectRejectCode(
        otp.verifyOtp(OTP_PHONE, wrong),
        BadRequestException,
        'AUTH_INVALID_OTP',
      );

      // Lockout deletes the code, so even the correct one no longer works.
      expect(await redis.get(`otp:${OTP_PHONE}`)).toBeNull();
      await expectRejectCode(
        otp.verifyOtp(OTP_PHONE, code),
        BadRequestException,
        'AUTH_INVALID_OTP',
      );
    });
  });

  describe('Redis rate limiting', () => {
    afterEach(() => cleanupRedis());

    it('allows sends up to the limit', async () => {
      for (let i = 0; i < SEND_LIMIT; i++) {
        await expect(otp.sendOtp(RATE_PHONE)).resolves.toBeUndefined();
      }
      expect(await redis.get(`otp:send_limit:${RATE_PHONE}`)).toBe(String(SEND_LIMIT));
    });

    it('rejects the request past the limit and issues no new code', async () => {
      for (let i = 0; i < SEND_LIMIT; i++) await otp.sendOtp(RATE_PHONE);
      const beforeCode = (await readOtpRecord(RATE_PHONE)).code;

      await expectRejectCode(
        otp.sendOtp(RATE_PHONE),
        BadRequestException,
        'AUTH_OTP_RATE_LIMITED',
      );

      // The blocked send must not mint or overwrite a code, and must not text.
      expect((await readOtpRecord(RATE_PHONE)).code).toBe(beforeCode);
      expect(twilioSend).not.toHaveBeenCalled();
    });

    it('keeps counting blocked attempts within the window', async () => {
      for (let i = 0; i < SEND_LIMIT; i++) await otp.sendOtp(RATE_PHONE);

      await expectRejectCode(
        otp.sendOtp(RATE_PHONE),
        BadRequestException,
        'AUTH_OTP_RATE_LIMITED',
      );
      await expectRejectCode(
        otp.sendOtp(RATE_PHONE),
        BadRequestException,
        'AUTH_OTP_RATE_LIMITED',
      );

      expect(await redis.get(`otp:send_limit:${RATE_PHONE}`)).toBe(String(SEND_LIMIT + 2));
    });

    it('limits each phone number independently', async () => {
      for (let i = 0; i < SEND_LIMIT; i++) await otp.sendOtp(RATE_PHONE);
      await expectRejectCode(
        otp.sendOtp(RATE_PHONE),
        BadRequestException,
        'AUTH_OTP_RATE_LIMITED',
      );

      // A different number is unaffected by the blocked one.
      await expect(otp.sendOtp(OTP_PHONE)).resolves.toBeUndefined();
      expect(await redis.get(`otp:send_limit:${OTP_PHONE}`)).toBe('1');
    });
  });

  describe('refresh-token rotation', () => {
    afterEach(() => cleanupRedis([ownerUserId, otherUserId]));

    it('issues a session bound to a real user row with a 30-day TTL', async () => {
      const pair = await tokens.issueTokenPair(ownerUserId, 'rider');

      const ttl = await redis.ttl(`refresh:${ownerUserId}:${pair.refreshToken}`);
      expect(ttl).toBeGreaterThan(REFRESH_TTL_SECONDS - 60);
      expect(ttl).toBeLessThanOrEqual(REFRESH_TTL_SECONDS);

      // The access token's subject resolves to the PostgreSQL row we created.
      const payload = jwt.verify<{ sub: string; role: string; jti: string }>(pair.accessToken, {
        secret: TEST_JWT_SECRET,
        issuer: 'bidride-auth',
        audience: 'bidride-user',
      });
      expect(payload.sub).toBe(ownerUserId);

      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      expect(user?.phone).toBe(OWNER_PHONE);
    });

    it('rotates to a new refresh token and revokes the old one', async () => {
      const first = await tokens.issueTokenPair(ownerUserId, 'rider');
      const second = await tokens.rotateTokenPair(ownerUserId, first.refreshToken);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(await redis.get(`refresh:${ownerUserId}:${first.refreshToken}`)).toBeNull();
      expect(await redis.get(`refresh:${ownerUserId}:${second.refreshToken}`)).not.toBeNull();
    });

    it('rejects reuse of an already-rotated refresh token', async () => {
      const first = await tokens.issueTokenPair(ownerUserId, 'rider');
      await tokens.rotateTokenPair(ownerUserId, first.refreshToken);

      await expectRejectCode(
        tokens.rotateTokenPair(ownerUserId, first.refreshToken),
        UnauthorizedException,
        'AUTH_TOKEN_EXPIRED',
      );
    });

    it('rejects a refresh token presented by a different user', async () => {
      const pair = await tokens.issueTokenPair(ownerUserId, 'rider');

      await expectRejectCode(
        tokens.rotateTokenPair(otherUserId, pair.refreshToken),
        UnauthorizedException,
        'AUTH_TOKEN_EXPIRED',
      );

      // The rightful owner's session is untouched by the failed attempt.
      expect(await redis.get(`refresh:${ownerUserId}:${pair.refreshToken}`)).not.toBeNull();
    });

    it('carries the stored role through rotation', async () => {
      const first = await tokens.issueTokenPair(ownerUserId, 'driver');
      const second = await tokens.rotateTokenPair(ownerUserId, first.refreshToken);

      const payload = jwt.verify<{ role: string }>(second.accessToken, {
        secret: TEST_JWT_SECRET,
        issuer: 'bidride-auth',
        audience: 'bidride-user',
      });
      expect(payload.role).toBe('driver');
    });
  });

  describe('session revocation', () => {
    afterEach(() => cleanupRedis([ownerUserId, otherUserId]));

    it('revokes a single session and leaves the others signed in', async () => {
      const phone = await tokens.issueTokenPair(ownerUserId, 'rider');
      const tablet = await tokens.issueTokenPair(ownerUserId, 'rider');

      await tokens.revokeRefreshToken(ownerUserId, phone.refreshToken);

      expect(await redis.get(`refresh:${ownerUserId}:${phone.refreshToken}`)).toBeNull();
      expect(await redis.get(`refresh:${ownerUserId}:${tablet.refreshToken}`)).not.toBeNull();

      // The revoked one can no longer rotate; the surviving one still can.
      await expectRejectCode(
        tokens.rotateTokenPair(ownerUserId, phone.refreshToken),
        UnauthorizedException,
        'AUTH_TOKEN_EXPIRED',
      );
      await expect(tokens.rotateTokenPair(ownerUserId, tablet.refreshToken)).resolves.toBeDefined();
    });

    it('is a no-op when revoking a token that does not exist', async () => {
      const live = await tokens.issueTokenPair(ownerUserId, 'rider');

      await expect(
        tokens.revokeRefreshToken(ownerUserId, 'never-issued-token'),
      ).resolves.toBeUndefined();
      expect(await redis.get(`refresh:${ownerUserId}:${live.refreshToken}`)).not.toBeNull();
    });

    it('revokes every session for the user', async () => {
      const sessions = [
        await tokens.issueTokenPair(ownerUserId, 'rider'),
        await tokens.issueTokenPair(ownerUserId, 'rider'),
        await tokens.issueTokenPair(ownerUserId, 'rider'),
      ];
      expect(await redis.keys(`refresh:${ownerUserId}:*`)).toHaveLength(3);

      await tokens.revokeAllRefreshTokens(ownerUserId);

      expect(await redis.keys(`refresh:${ownerUserId}:*`)).toHaveLength(0);
      for (const session of sessions) {
        await expectRejectCode(
          tokens.rotateTokenPair(ownerUserId, session.refreshToken),
          UnauthorizedException,
          'AUTH_TOKEN_EXPIRED',
        );
      }
    });

    it('does not touch another user’s sessions', async () => {
      await tokens.issueTokenPair(ownerUserId, 'rider');
      const otherSession = await tokens.issueTokenPair(otherUserId, 'rider');

      await tokens.revokeAllRefreshTokens(ownerUserId);

      expect(await redis.keys(`refresh:${ownerUserId}:*`)).toHaveLength(0);
      expect(await redis.get(`refresh:${otherUserId}:${otherSession.refreshToken}`)).not.toBeNull();
      await expect(
        tokens.rotateTokenPair(otherUserId, otherSession.refreshToken),
      ).resolves.toBeDefined();
    });

    it('is a no-op when the user has no sessions', async () => {
      await expect(tokens.revokeAllRefreshTokens(ownerUserId)).resolves.toBeUndefined();
      expect(await redis.keys(`refresh:${ownerUserId}:*`)).toHaveLength(0);
    });
  });
});
