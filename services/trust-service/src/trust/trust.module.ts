import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TrustService } from './trust.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [ConfigModule],
  providers: [TrustService, PrismaService],
  exports: [TrustService],
})
export class TrustModule {}
