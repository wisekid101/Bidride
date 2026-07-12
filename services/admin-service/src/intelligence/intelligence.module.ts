import { Module } from '@nestjs/common';
import { IntelligenceController } from './intelligence.controller';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { AuditModule } from '../audit/audit.module';
import { FounderGuard } from '../auth/founder.guard';

@Module({
  imports: [AdminAuthModule, AuditModule],
  controllers: [IntelligenceController],
  providers: [FounderGuard],
})
export class IntelligenceModule {}
