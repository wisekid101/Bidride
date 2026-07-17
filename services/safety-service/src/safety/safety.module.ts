import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SafetyService } from './safety.service';
import { SafetyController } from './safety.controller';
import { SafetyPublicController } from './safety-public.controller';
import { SafetyJwtGuard } from './safety-jwt.guard';
import { RouteMonitorService } from './route-monitor.service';
import { RouteService } from './route.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ secret: config.get('JWT_SECRET') }),
      inject: [ConfigService],
    }),
  ],
  controllers: [SafetyController, SafetyPublicController],
  providers: [SafetyService, RouteMonitorService, RouteService, PrismaService, SafetyJwtGuard],
  exports: [SafetyService, RouteService],
})
export class SafetyModule {}
