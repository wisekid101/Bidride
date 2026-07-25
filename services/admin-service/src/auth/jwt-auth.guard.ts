import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();

    try {
      // B8A-F1: this guard protects the user-domain support-ticket routes, so it
      // must enforce the same contract as the other user verifiers — pin HS256 and
      // require our issuer + the user audience (rejecting admin-audience tokens).
      // The secret is JWT_SECRET, provided fail-closed via the module's
      // config.getOrThrow('JWT_SECRET').
      const payload = this.jwt.verify(auth.slice(7), {
        algorithms: ['HS256'],
        issuer: 'bidride-auth',
        audience: 'bidride-user',
      });
      req.headers['x-user-id'] = payload.sub;
      req.headers['x-user-role'] = payload.role;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
