import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FcmService } from './fcm.service';
import { NotificationService } from './notification.service';

@Module({
  imports: [ConfigModule],
  providers: [FcmService, NotificationService],
  exports: [FcmService, NotificationService],
})
export class NotificationsModule {}
