import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { DriversAdminService } from './drivers-admin.service';

// Any admin role may view drivers; only these roles may change their fate.
const APPROVAL_ROLES = new Set(['founder', 'super_admin', 'driver_approval_admin']);

interface AdminRequest {
  adminUser: { sub: string; role: string };
  url: string;
}

function requireApprovalRole(req: AdminRequest): void {
  if (!APPROVAL_ROLES.has(req.adminUser.role)) {
    throw new ForbiddenException('Driver approval requires the Driver Approval Admin role');
  }
}

@Controller('admin/drivers')
@UseGuards(AdminSessionGuard)
export class DriversAdminController {
  constructor(private readonly drivers: DriversAdminService) {}

  @Get()
  list(@Req() req: AdminRequest) {
    const query = req.url.split('?')[1] ?? '';
    return this.drivers.listDrivers(req.adminUser.sub, req.adminUser.role, query);
  }

  @Get(':driverId')
  detail(@Req() req: AdminRequest, @Param('driverId') driverId: string) {
    return this.drivers.getDriverDetail(req.adminUser.sub, req.adminUser.role, driverId);
  }

  @Post(':driverId/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Req() req: AdminRequest, @Param('driverId') driverId: string, @Body() body: unknown) {
    requireApprovalRole(req);
    return this.drivers.approveDriver(req.adminUser.sub, req.adminUser.role, driverId, body);
  }

  @Post(':driverId/decline')
  @HttpCode(HttpStatus.OK)
  decline(@Req() req: AdminRequest, @Param('driverId') driverId: string, @Body() body: unknown) {
    requireApprovalRole(req);
    return this.drivers.declineDriver(req.adminUser.sub, req.adminUser.role, driverId, body);
  }

  @Post(':driverId/documents/:documentType/review')
  @HttpCode(HttpStatus.OK)
  reviewDocument(
    @Req() req: AdminRequest,
    @Param('driverId') driverId: string,
    @Param('documentType') documentType: string,
    @Body() body: unknown,
  ) {
    requireApprovalRole(req);
    return this.drivers.reviewDocument(
      req.adminUser.sub,
      req.adminUser.role,
      driverId,
      documentType,
      body,
    );
  }
}
