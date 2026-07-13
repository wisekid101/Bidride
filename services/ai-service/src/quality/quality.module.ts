import { Module } from '@nestjs/common';
import { QualityClassService } from './quality-class.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [QualityClassService, PrismaService],
  exports: [QualityClassService],
})
export class QualityModule {}
