import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

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
    const token = this.jwt.sign(
      { sub: admin.id, email: admin.email, role: admin.adminRole },
      { expiresIn: ttl },
    );

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
    return this.jwt.verify<AdminTokenPayload>(token);
  }
}
