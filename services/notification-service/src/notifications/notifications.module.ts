import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FcmService } from './fcm.service';
import { NotificationService } from './notification.service';
import { InternalNotificationsController } from './notifications.controller';

@Module({
  imports: [ConfigModule],
  controllers: [InternalNotificationsController],
  providers: [FcmService, NotificationService],
  exports: [FcmService, NotificationService],
})
export class NotificationsModule {}
