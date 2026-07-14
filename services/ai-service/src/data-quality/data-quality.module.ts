import { Module } from '@nestjs/common';
import { DataQualityController } from './data-quality.controller';
import { DataQualityService } from './data-quality.service';
import { PrismaService } from '../prisma/prisma.service';
import { InternalKeyGuard } from '../internal-key.guard';
import { QualityModule } from '../quality/quality.module';

@Module({
  imports: [QualityModule],
  controllers: [DataQualityController],
  providers: [DataQualityService, PrismaService, InternalKeyGuard],
  exports: [DataQualityService],
})
export class DataQualityModule {}
