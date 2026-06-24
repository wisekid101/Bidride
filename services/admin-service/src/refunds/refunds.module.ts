import { Module } from '@nestjs/common';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [RefundsController],
  providers: [RefundsService, PrismaService],
})
export class RefundsModule {}
