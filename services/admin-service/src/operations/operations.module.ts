import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, PrismaService],
})
export class OperationsModule {}
