import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DriversAdminController } from './drivers-admin.controller';
import { DriversAdminService } from './drivers-admin.service';

@Module({
  // Local JwtModule registration: service tokens are signed per-call with the
  // shared JWT_SECRET (driver-service verifies), not the admin session secret.
  imports: [JwtModule.register({})],
  controllers: [DriversAdminController],
  providers: [DriversAdminService],
})
export class DriversAdminModule {}
