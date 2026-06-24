import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminSessionGuard } from './admin-session.guard';
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
        secret: config.get('ADMIN_JWT_SECRET', config.get('JWT_SECRET')),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminSessionGuard, PrismaService],
  exports: [AdminAuthService, AdminSessionGuard],
})
export class AdminAuthModule {}
