import { Module } from '@nestjs/common';
import { PlatformConfigController } from './platform-config.controller';
import { PlatformConfigService } from './platform-config.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ secret: config.get('JWT_SECRET') }),
      inject: [ConfigService],
    }),
  ],
  controllers: [PlatformConfigController],
  providers: [PlatformConfigService, PrismaService],
})
export class PlatformConfigModule {}
