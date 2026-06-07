import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '@bidride/database/generated/client';
import { REDIS_CLIENT } from '../redis/redis.module';

const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

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
  ) {}

  async issueTokenPair(userId: string, role: UserRole): Promise<TokenPair> {
    const jti = uuidv4();

    const accessToken = this.jwt.sign({ sub: userId, role, jti });

    const refreshToken = uuidv4();
    const refreshKey = `refresh:${userId}:${refreshToken}`;
    await this.redis.setex(
      refreshKey,
      REFRESH_TTL_SECONDS,
      JSON.stringify({ jti, role }),
    );

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
    await this.redis.del(refreshKey);
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    const pattern = `refresh:${userId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  verifyAccessToken(token: string): JwtPayload {
    try {
      return this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_EXPIRED',
        message: 'Access token expired or invalid.',
      });
    }
  }
}
