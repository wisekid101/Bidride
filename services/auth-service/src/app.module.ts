import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { RedisModule } from './redis/redis.module';
import { WebSocketEventGateway } from './websocket/websocket.gateway';
import { PrismaService } from './prisma/prisma.service';
import { ObservabilityModule } from './observability/observability.module';

@Module({
  controllers: [HealthController],
  providers: [WebSocketEventGateway, PrismaService],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60000, limit: 300 },
    ]),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    RedisModule,
    AuthModule,
    ObservabilityModule,
  ],
})
export class AppModule {}
