import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AirportService } from './airport.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [AirportService, PrismaService],
  exports: [AirportService],
})
export class AirportModule {}
