import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { UserTicketController, AdminTicketController } from './support.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [UserTicketController, AdminTicketController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
