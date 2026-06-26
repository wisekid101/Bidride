import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { UserTicketController, AdminTicketController, AdminSupportStatsController } from './support.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [UserTicketController, AdminTicketController, AdminSupportStatsController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
