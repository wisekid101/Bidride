import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from './token.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: true,
      secretOrKey: config.getOrThrow('JWT_SECRET'),
      // B8A: pin algorithm + require issuer/audience. ignoreExpiration stays true
      // (the refresh flow proves identity from an expired access token) — the
      // opaque refresh token itself (Redis) is unchanged.
      algorithms: ['HS256'],
      issuer: 'bidride-auth',
      audience: 'bidride-user',
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException('Invalid token payload.');
    }
    return payload;
  }
}
