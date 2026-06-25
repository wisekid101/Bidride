import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GeocodingService } from './geocoding.service';
import { GeocodingController } from './geocoding.controller';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [ConfigModule, RedisModule],
  controllers: [GeocodingController],
  providers: [GeocodingService],
  exports: [GeocodingService],
})
export class GeocodingModule {}
