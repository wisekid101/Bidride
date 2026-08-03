import {
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { resolveAdminJwtVerification } from '../admin-jwt-verification';
import { KmsJwtSigner } from './kms-jwt-signer';
import { ADMIN_JWT_RSA_SIGNER } from './jwt-signer.provider';

export interface AdminTokenPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    // SEC-RS256-B2: present ONLY when JWT_SIGNING_ALG=RS256. Optional so the
    // default deployment resolves without it and keeps signing HS256 as before.
    @Optional() @Inject(ADMIN_JWT_RSA_SIGNER) private readonly rsaSigner?: KmsJwtSigner,
  ) {}

  async login(email: string, password: string, ipAddress?: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });

    // Constant-time path: always compare even when admin not found (mitigates timing attacks)
    const hash = admin?.passwordHash ?? '$2b$12$invalidhashplaceholderfortiming000000000000000';
    const valid = await bcrypt.compare(password, hash);

    if (!admin || !admin.isActive || !valid) {
      this.logger.warn(`Failed admin login attempt for email=${email} ip=${ipAddress}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const ttl = parseInt(this.config.get('ADMIN_SESSION_TTL_SECONDS', '28800'));
    // B8A: admin session tokens carry the dedicated admin audience so they are
    // NEVER accepted by user-facing services (which require 'bidride-user').
    // SEC-RS256-B2: when an RS256 signer is configured the same claims are signed
    // in KMS with the ADMIN key instead — identical payload, issuer, audience and
    // TTL, plus a header kid. KMS failures propagate; no HS256 fallback, because a
    // failure-induced algorithm downgrade would be an attack primitive.
    const claims = { sub: admin.id, email: admin.email, role: admin.adminRole };
    const token = this.rsaSigner
      ? await this.rsaSigner.sign(claims, {
          issuer: 'bidride-auth',
          audience: 'bidride-admin',
          expiresInSeconds: ttl,
        })
      : this.jwt.sign(claims, {
          expiresIn: ttl,
          issuer: 'bidride-auth',
          audience: 'bidride-admin',
        });

    await Promise.all([
      this.prisma.adminUser.update({
        where: { id: admin.id },
        data: { lastLoginAt: new Date() },
      }),
      this.audit.createLog({
        adminId: admin.id,
        action: 'admin.login',
        targetType: 'admin_session',
        targetId: admin.id,
        metadata: { email: admin.email, role: admin.adminRole, ip: ipAddress },
        ipAddress,
      }),
    ]);

    return {
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.adminRole,
      },
    };
  }

  async logout(adminId: string, adminEmail: string, ipAddress?: string): Promise<void> {
    await this.audit.createLog({
      adminId,
      action: 'admin.logout',
      targetType: 'admin_session',
      targetId: adminId,
      metadata: { email: adminEmail, ip: ipAddress },
      ipAddress,
    });
  }

  verifyToken(token: string): AdminTokenPayload {
    // B8A: require the admin issuer/audience so a user token can never be
    // replayed as an admin session.
    // SEC-RS256-B1: resolve the key per token from the ADMIN trust domain —
    // HS256⇒ADMIN_JWT_SECRET/JWT_SECRET, RS256⇒JWT_ADMIN_PUBLIC_KEYS PEM by kid.
    // The admin keyset is deliberately separate from JWT_PUBLIC_KEYS, so a
    // user-domain key can never authenticate an admin session.
    const { verifyKey, algorithm } = resolveAdminJwtVerification(token);
    return this.jwt.verify<AdminTokenPayload>(token, {
      secret: verifyKey,
      algorithms: [algorithm],
      issuer: 'bidride-auth',
      audience: 'bidride-admin',
    });
  }
}
