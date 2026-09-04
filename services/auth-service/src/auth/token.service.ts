import { Injectable, Inject, Optional, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '@bidride/database/generated/client';
import { REDIS_CLIENT } from '../redis/redis.module';
import { authMetrics } from '../observability/auth-metrics';
import { KmsJwtSigner } from './kms-jwt-signer';
import { JWT_RSA_SIGNER } from './jwt-signer.provider';

const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * SEC-RS256-B2: the RS256 path assembles claims itself, so the access-token TTL
 * has to be stated explicitly here. It MUST stay equal to the JwtModule's
 * signOptions.expiresIn ('15m') so switching algorithm never changes lifetime.
 */
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface JwtPayload {
  sub: string;
  role: UserRole;
  jti: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    // SEC-RS256-B2: present ONLY when JWT_SIGNING_ALG=RS256. Optional so the
    // default deployment (and every existing test/module wiring) resolves without
    // it and keeps signing HS256 exactly as before.
    @Optional() @Inject(JWT_RSA_SIGNER) private readonly rsaSigner?: KmsJwtSigner,
  ) {}

  async issueTokenPair(userId: string, role: UserRole): Promise<TokenPair> {
    const jti = uuidv4();

    // B8A: stamp standard claims. iss/aud let every verifier reject foreign or
    // mis-targeted tokens; iat/exp are added by JwtService (exp via module's
    // expiresIn). Refresh tokens (opaque UUID in Redis) are unchanged.
    // SEC-RS256-B2: when an RS256 signer is configured the same claims are signed
    // in KMS instead — identical payload, identical iss/aud/exp, plus a header kid.
    // Any KMS failure propagates; there is deliberately no HS256 fallback, since a
    // failure-triggered algorithm downgrade would be an attack primitive.
    const claims = { sub: userId, role, jti };
    const accessToken = this.rsaSigner
      ? await this.rsaSigner.sign(claims, {
          issuer: 'bidride-auth',
          audience: 'bidride-user',
          expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
        })
      : this.jwt.sign(claims, { issuer: 'bidride-auth', audience: 'bidride-user' });

    const refreshToken = uuidv4();
    const refreshKey = `refresh:${userId}:${refreshToken}`;
    await this.redis.setex(
      refreshKey,
      REFRESH_TTL_SECONDS,
      JSON.stringify({ jti, role }),
    );

    // A refresh key in Redis IS a live session, so the gauge tracks that set.
    // rotateTokenPair revokes then issues, keeping the count flat, which is
    // correct — a rotation is the same session, not a new one.
    authMetrics.activeSessions.inc();

    return { accessToken, refreshToken };
  }

  async rotateTokenPair(userId: string, incomingRefreshToken: string): Promise<TokenPair> {
    const refreshKey = `refresh:${userId}:${incomingRefreshToken}`;
    const raw = await this.redis.get(refreshKey);

    if (!raw) {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_EXPIRED',
        message: 'Refresh token expired or invalid.',
      });
    }

    const { role } = JSON.parse(raw) as { jti: string; role: UserRole };

    await this.redis.del(refreshKey);

    return this.issueTokenPair(userId, role);
  }

  async revokeRefreshToken(userId: string, refreshToken: string): Promise<void> {
    const refreshKey = `refresh:${userId}:${refreshToken}`;
    // Decrement only when a key was actually removed. `del` returns the number
    // deleted, so a logout with an already-expired token does not drive the
    // gauge negative.
    const removed = await this.redis.del(refreshKey);
    if (removed > 0) authMetrics.activeSessions.dec({}, removed);
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    const pattern = `refresh:${userId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      const removed = await this.redis.del(...keys);
      if (removed > 0) authMetrics.activeSessions.dec({}, removed);
    }
  }
}
