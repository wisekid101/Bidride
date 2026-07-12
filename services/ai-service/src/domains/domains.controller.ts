import { Controller, Get, Param, NotFoundException, UseGuards } from '@nestjs/common';
import { InternalKeyGuard } from '../internal-key.guard';
import { DOMAIN_REGISTRY, getDomain } from './domain-manifest';

@UseGuards(InternalKeyGuard)
@Controller('ai/domains')
export class DomainsController {
  @Get()
  list() {
    return { domains: DOMAIN_REGISTRY };
  }

  @Get(':name')
  get(@Param('name') name: string) {
    const manifest = getDomain(name);
    if (!manifest) throw new NotFoundException(`No manifest for domain "${name}"`);
    return manifest;
  }
}
