import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [WalletService, PrismaService],
  exports: [WalletService],
})
export class WalletModule {}
