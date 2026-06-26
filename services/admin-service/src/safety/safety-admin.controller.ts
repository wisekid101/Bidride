import { Controller, Get, Query, Param, Post } from '@nestjs/common';
import { SosStatus } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';

@Controller('admin/safety')
export class SafetyAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('sos')
  async getSosQueue(@Query('status') status?: string) {
    const statusFilter = status && Object.values(SosStatus).includes(status as SosStatus)
      ? (status as SosStatus)
      : undefined;

    return this.prisma.sosEvent.findMany({
      where: statusFilter ? { status: statusFilter } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        tripId: true,
        initiatedByRole: true,
        status: true,
        createdAt: true,
        gpsLat: true,
        gpsLng: true,
        adminAssignedId: true,
        resolvedAt: true,
        slaMet: true,
        recordingId: true,
      },
    });
  }

  @Post('sos/:id/assign')
  async assignSos(@Param('id') id: string) {
    return this.prisma.sosEvent.update({
      where: { id },
      data: { adminAssignedId: id }, // Mark as assigned to self — real auth would use adminId from JWT
    });
  }

  @Get('panic')
  async getPanicQueue(@Query('status') status?: string) {
    return this.prisma.panicEvent.findMany({
      where: status === 'active' ? { adminAssignedId: null } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        tripId: true,
        initiatedByRole: true,
        createdAt: true,
        adminAssignedId: true,
      },
    });
  }

  @Get('deviations')
  async getDeviationAlerts(
    @Query('riskLevel') riskLevel?: string,
    @Query('limit') limit = '50',
  ) {
    return this.prisma.routeDeviationEvent.findMany({
      where: riskLevel ? { riskLevel } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit, 10) || 50, 200),
      select: {
        id: true,
        tripId: true,
        type: true,
        riskLevel: true,
        deviationMiles: true,
        elapsedMin: true,
        expectedMin: true,
        escalated: true,
        escalationType: true,
        resolvedAt: true,
        createdAt: true,
      },
    });
  }
}
