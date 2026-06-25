import { Module } from '@nestjs/common';
import { TrustService } from './trust.service';
import { TrustController } from './trust.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [TrustController],
  providers: [TrustService, PrismaService],
  exports: [TrustService],
})
export class TrustModule {}
