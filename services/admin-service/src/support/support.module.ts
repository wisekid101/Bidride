import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SupportService } from './support.service';
import { UserTicketController, AdminTicketController, AdminSupportStatsController } from './support.controller';
import { AuditModule } from '../audit/audit.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  imports: [
    AuditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [UserTicketController, AdminTicketController, AdminSupportStatsController],
  providers: [SupportService, JwtAuthGuard],
  exports: [SupportService],
})
export class SupportModule {}
