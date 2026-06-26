import { Module } from '@nestjs/common';
import { MarketplaceAdminController } from './marketplace.controller';

@Module({
  controllers: [MarketplaceAdminController],
})
export class MarketplaceAdminModule {}
