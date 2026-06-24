import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProxyService } from './proxy.service';
import { ProxyController } from './proxy.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [ConfigModule],
  controllers: [ProxyController],
  providers: [ProxyService, PrismaService],
  exports: [ProxyService],
})
export class ProxyModule {}
