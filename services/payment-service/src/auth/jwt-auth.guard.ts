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
      // B8A: pin algorithm + require issuer/audience so only bidride-user tokens pass.
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
