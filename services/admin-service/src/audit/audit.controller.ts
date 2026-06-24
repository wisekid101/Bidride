import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { ComplianceGuard } from '../auth/compliance.guard';

@Controller('admin/audit')
@UseGuards(AdminSessionGuard, ComplianceGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  getAuditLogs(
    @Query('adminId') adminId?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.getAuditLogs({
      adminId,
      action,
      targetType,
      targetId,
      from,
      to,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }
}
