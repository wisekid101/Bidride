import { Module } from '@nestjs/common';
import { PlatformConfigController } from './platform-config.controller';
import { PlatformConfigService } from './platform-config.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [PlatformConfigController],
  providers: [PlatformConfigService, PrismaService],
})
export class PlatformConfigModule {}
