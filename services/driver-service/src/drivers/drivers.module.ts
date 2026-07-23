import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { CheckrService } from './checkr.service';
import { DriverActivationService } from './driver-activation.service';
import { CheckrWebhookController } from './checkr.webhook.controller';
import { ZeroToleranceController } from './zero-tolerance.controller';
import { ZeroToleranceService } from './zero-tolerance.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [DriversController, CheckrWebhookController, ZeroToleranceController],
  providers: [DriversService, CheckrService, DriverActivationService, ZeroToleranceService],
})
export class DriversModule {}
