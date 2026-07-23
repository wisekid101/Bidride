import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaClient } from '@bidride/database';
import { AcceptZeroToleranceDto } from './dto';

export interface AcceptanceContext {
  appVersion?: string | null;
  ipAddress?: string | null;
}

// SB2A Batch 2 — Zero Tolerance acceptance authority.
//
// - The ZeroToleranceAcceptance table is the immutable, append-only source of
//   truth (one row per driver x policy version, unique-constrained).
// - Driver.zeroToleranceAcceptedVersion is a denormalized cache the onboarding
//   resolver reads; it is written in the SAME transaction as the acceptance row.
// - Acceptance is idempotent: re-accepting the same version is a no-op success.
// - The server is authoritative for the current policy version (D4). Acceptance
//   of a stale version is rejected so the client refetches.
@Injectable()
export class ZeroToleranceService {
  private prisma = new PrismaClient();

  // The current active policy, or null if none has been published yet (in which
  // case the Zero Tolerance gate is inert — see getProfile's fact computation).
  async getActivePolicy() {
    return this.prisma.zeroTolerancePolicy.findFirst({
      where: { isActive: true },
      orderBy: { effectiveAt: 'desc' },
    });
  }

  // Policy the mobile client must render + accept. Includes the minimum app
  // version so the client can enforce the force-update gate (D3).
  async getCurrentPolicy() {
    const policy = await this.getActivePolicy();
    if (!policy) throw new NotFoundException('No active Zero Tolerance policy is published');
    return {
      version: policy.version,
      contentHash: policy.contentHash,
      body: policy.body,
      minAppVersion: policy.minAppVersion,
      effectiveAt: policy.effectiveAt,
    };
  }

  async accept(userId: string, dto: AcceptZeroToleranceDto, ctx: AcceptanceContext = {}) {
    if (!dto.acknowledged) {
      throw new BadRequestException('You must acknowledge the Zero Tolerance policy to accept it');
    }

    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver not found');

    const policy = await this.getActivePolicy();
    if (!policy) throw new NotFoundException('No active Zero Tolerance policy is published');

    // Reject stale-version acceptance — the client must accept the CURRENT
    // version it was shown. Forces a refresh if the policy changed underfoot.
    if (dto.policyVersion !== policy.version) {
      throw new ConflictException('Zero Tolerance policy has changed; please review the current version');
    }

    // Idempotent: if this driver already accepted this version, return success
    // without inserting a second row (exactly-once per policy version).
    const existing = await this.prisma.zeroToleranceAcceptance.findUnique({
      where: { driverId_policyVersion: { driverId: driver.id, policyVersion: policy.version } },
    });
    if (existing) {
      return { success: true, nextStep: 'complete', alreadyAccepted: true };
    }

    // Immutable insert + denormalized cache update in one transaction. A
    // concurrent duplicate loses the unique-constraint race; we translate that
    // into the same idempotent success rather than a 500.
    try {
      await this.prisma.$transaction([
        this.prisma.zeroToleranceAcceptance.create({
          data: {
            driverId: driver.id,
            policyVersion: policy.version,
            policyContentHash: policy.contentHash,
            source: 'mobile',
            appVersion: ctx.appVersion ?? null,
            ipAddress: ctx.ipAddress ?? null,
          },
        }),
        this.prisma.driver.update({
          where: { id: driver.id },
          data: { zeroToleranceAcceptedVersion: policy.version },
        }),
      ]);
    } catch (err: any) {
      // Prisma P2002 = unique constraint violation → a concurrent accept won.
      if (err?.code === 'P2002') {
        // Ensure the denormalized cache reflects the winning row.
        await this.prisma.driver.update({
          where: { id: driver.id },
          data: { zeroToleranceAcceptedVersion: policy.version },
        });
        return { success: true, nextStep: 'complete', alreadyAccepted: true };
      }
      throw err;
    }

    return { success: true, nextStep: 'complete', alreadyAccepted: false };
  }

  // Admin: immutable acceptance history for a driver (newest first).
  async listAcceptances(driverId: string) {
    return this.prisma.zeroToleranceAcceptance.findMany({
      where: { driverId },
      orderBy: { acceptedAt: 'desc' },
      select: {
        policyVersion: true,
        policyContentHash: true,
        source: true,
        appVersion: true,
        acceptedAt: true,
      },
    });
  }
}
