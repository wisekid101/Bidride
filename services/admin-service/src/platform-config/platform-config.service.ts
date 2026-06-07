import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database';
import { createVerify } from 'crypto';

// Sensitive keys that require a signed JWT from the Founder to update
const FOUNDER_ONLY_KEYS = ['earnings_floor_formula'];

@Injectable()
export class PlatformConfigService {
  private prisma = new PrismaClient();

  async getAll() {
    const configs = await this.prisma.platformConfig.findMany();
    // Never expose earnings_floor_formula to non-founder requests — filter in controller layer
    return configs;
  }

  async get(key: string) {
    const config = await this.prisma.platformConfig.findUnique({ where: { key } });
    if (!config) throw new NotFoundException(`Config key '${key}' not found`);
    return config;
  }

  async update(key: string, value: unknown, adminRole: string, founderSignature?: string) {
    if (FOUNDER_ONLY_KEYS.includes(key)) {
      if (adminRole !== 'founder') {
        throw new ForbiddenException('Only the Founder can modify this configuration');
      }

      // Verify the signed JWT authorizing this specific change
      if (!founderSignature) {
        throw new BadRequestException('Founder signature required for this configuration change');
      }

      const isValid = this.verifyFounderSignature(founderSignature, key, value);
      if (!isValid) {
        throw new ForbiddenException('Invalid founder signature for this configuration change');
      }
    }

    const existing = await this.prisma.platformConfig.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException(`Config key '${key}' not found`);

    const updated = await this.prisma.platformConfig.update({
      where: { key },
      data: { value: value as any, changedAt: new Date() },
    });

    return updated;
  }

  private verifyFounderSignature(signature: string, key: string, value: unknown): boolean {
    const publicKey = process.env.FOUNDER_SIGNING_PUBLIC_KEY;
    if (!publicKey) {
      // In dev mode, skip signature verification
      return process.env.NODE_ENV === 'development';
    }

    try {
      const verifier = createVerify('SHA256');
      verifier.update(JSON.stringify({ key, value }));
      return verifier.verify(publicKey, signature, 'base64');
    } catch {
      return false;
    }
  }
}
