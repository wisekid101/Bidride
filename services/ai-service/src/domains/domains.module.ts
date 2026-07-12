import { Module } from '@nestjs/common';
import { DomainsController } from './domains.controller';
import { InternalKeyGuard } from '../internal-key.guard';

@Module({
  controllers: [DomainsController],
  providers: [InternalKeyGuard],
})
export class DomainsModule {}
