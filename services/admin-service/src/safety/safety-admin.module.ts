import { Module } from '@nestjs/common';
import { SafetyAdminController } from './safety-admin.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [SafetyAdminController],
  providers: [PrismaService],
})
export class SafetyAdminModule {}
