import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from './token.service';
import { resolveUserJwtVerification } from './user-jwt-verification';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    // B8A fail-closed: no JWT_SECRET ⇒ construction throws (the HS256 path needs it).
    config.getOrThrow('JWT_SECRET');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // ignoreExpiration stays true (the refresh flow proves identity from an
      // expired access token) — the opaque refresh token itself (Redis) is unchanged.
      ignoreExpiration: true,
      // B8C: resolve the key per token — HS256⇒JWT_SECRET, RS256⇒keyset PEM by kid
      // (strict alg→key mapping; no algorithm-confusion exposure).
      secretOrKeyProvider: (_req, rawJwt, done) => {
        try {
          done(null, resolveUserJwtVerification(rawJwt).verifyKey);
        } catch (err) {
          done(err as Error, undefined);
        }
      },
      // B8A: require issuer/audience.
      algorithms: ['HS256', 'RS256'],
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
