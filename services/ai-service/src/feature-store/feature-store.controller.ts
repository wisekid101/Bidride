import { Controller, Get, UseGuards } from '@nestjs/common';
import { InternalKeyGuard } from '../internal-key.guard';
import { FeatureStoreService } from './feature-store.service';

@UseGuards(InternalKeyGuard)
@Controller('ai')
export class FeatureStoreController {
  constructor(private readonly featureStore: FeatureStoreService) {}

  @Get('features')
  features() {
    return this.featureStore.snapshot();
  }
}
