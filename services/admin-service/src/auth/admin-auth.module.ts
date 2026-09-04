import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminSessionGuard } from './admin-session.guard';
import { adminJwtRsaSignerProvider } from './jwt-signer.provider';
import { AuditModule } from '../audit/audit.module';
import { PrismaService } from '../prisma/prisma.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    AuditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        // B8A: keep the ADMIN_JWT_SECRET→JWT_SECRET fallback, but fail startup if
        // neither is configured (getOrThrow), never silently continue.
        secret: config.get<string>('ADMIN_JWT_SECRET') ?? config.getOrThrow<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    AdminSessionGuard,
    PrismaService,
    // SEC-RS256-B2: null unless JWT_SIGNING_ALG=RS256, in which case it validates
    // the KMS admin key against JWT_ADMIN_PUBLIC_KEYS before the app finishes boot.
    adminJwtRsaSignerProvider,
  ],
  exports: [AdminAuthService, AdminSessionGuard],
})
export class AdminAuthModule {}
