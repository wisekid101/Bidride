import { Module } from '@nestjs/common';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';
import { PrismaService } from '../prisma/prisma.service';
import { InternalKeyGuard } from '../internal-key.guard';

@Module({
  controllers: [RetentionController],
  providers: [RetentionService, PrismaService, InternalKeyGuard],
  exports: [RetentionService],
})
export class RetentionModule {}
