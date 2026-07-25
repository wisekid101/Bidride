import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from './token.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow('JWT_SECRET'),
      // B8A: pin algorithm + require our issuer/audience so foreign, alg-swapped,
      // or mis-targeted tokens are rejected.
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
