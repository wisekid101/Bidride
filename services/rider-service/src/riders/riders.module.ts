import { Module } from '@nestjs/common';
import { RidersController } from './riders.controller';
import { RidersService } from './riders.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ secret: config.get('JWT_SECRET') }),
      inject: [ConfigService],
    }),
  ],
  controllers: [RidersController],
  providers: [RidersService],
})
export class RidersModule {}
