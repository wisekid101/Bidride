import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { NotificationsModule } from './notifications/notifications.module';
import { ProxyModule } from './proxy/proxy.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 200 }]),
    NotificationsModule,
    ProxyModule,
  ],
})
export class AppModule {}
