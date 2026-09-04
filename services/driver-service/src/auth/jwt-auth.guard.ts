import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { resolveUserJwtVerification } from '../user-jwt-verification';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();

    try {
      // B8A: require issuer/audience so only bidride-user tokens pass.
      // B8C: resolve the key per token — HS256⇒JWT_SECRET, RS256⇒keyset PEM by kid.
      const token = auth.slice(7);
      const { verifyKey, algorithm } = resolveUserJwtVerification(token);
      const payload = this.jwt.verify(token, {
        secret: verifyKey,
        algorithms: [algorithm],
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
