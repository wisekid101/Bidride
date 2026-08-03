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
      // B8A-F1: this guard protects the user-domain support-ticket routes, so it
      // must enforce the same contract as the other user verifiers — require our
      // issuer + the user audience (rejecting admin-audience tokens).
      // B8C: resolve the key per token — HS256⇒JWT_SECRET, RS256⇒keyset PEM by kid.
      // Without this the support routes would reject every RS256 user token the
      // moment issuance flips, while the rest of the fleet accepted them.
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
