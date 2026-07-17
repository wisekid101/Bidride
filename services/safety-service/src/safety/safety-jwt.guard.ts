import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface SafetyJwtPayload {
  sub: string;
  role: string;
}

/**
 * Verifies the rider/driver access token (Bearer) and attaches the decoded
 * payload as req.user. Uses the JwtModule already registered in SafetyModule
 * (secret = JWT_SECRET). Rider/driver-facing safety routes are guarded by this.
 */
@Injectable()
export class SafetyJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing bearer token.');
    try {
      const payload = this.jwt.verify<SafetyJwtPayload>(token);
      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
  }
}
