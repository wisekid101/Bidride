import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { EarningsFloorService } from './earnings-floor.service';
import { DispatchService } from './dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ secret: config.get('JWT_SECRET') }),
      inject: [ConfigService],
    }),
  ],
  controllers: [TripsController],
  providers: [TripsService, EarningsFloorService, DispatchService, PrismaService, JwtStrategy],
})
export class TripsModule {}
