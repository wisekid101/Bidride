import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BidsController } from './bids.controller';
import { BidsService } from './bids.service';
import { DispatchService } from '../trips/dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { JwtStrategy } from '../trips/jwt.strategy';

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
  controllers: [BidsController],
  providers: [BidsService, DispatchService, PrismaService, JwtStrategy],
  exports: [BidsService],
})
export class BidsModule {}
