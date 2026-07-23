/**
 * SB2A Batch 2 — Zero Tolerance grandfather migration (Founder decision D2).
 *
 * Existing APPROVED drivers are grandfathered: they are NOT sent back through
 * onboarding. This script backfills an immutable ZeroToleranceAcceptance row
 * (source = 'grandfather') for every approved driver that has no acceptance yet,
 * and sets the denormalized Driver.zeroToleranceAcceptedVersion so the resolver
 * treats them as covered.
 *
 * Idempotent: safe to re-run. It never overwrites a genuine 'mobile' acceptance
 * and never creates a duplicate row (guarded by the unique (driver, version)).
 *
 * Requires an active ZeroTolerancePolicy to exist (the version to attach to).
 * Run AFTER the initial policy is published, with `ts-node`:
 *   ts-node prisma/grandfather-zero-tolerance.ts
 */
import { PrismaClient } from '../generated/client';

export interface GrandfatherPolicy {
  version: string;
  contentHash: string;
}

// Minimal structural type so this is unit-testable with a mocked client.
export interface GrandfatherPrisma {
  driver: {
    findMany: (args: any) => Promise<Array<{ id: string }>>;
    update: (args: any) => Promise<unknown>;
  };
  zeroToleranceAcceptance: {
    findUnique: (args: any) => Promise<unknown | null>;
    create: (args: any) => Promise<unknown>;
  };
}

export async function grandfatherApprovedDrivers(
  prisma: GrandfatherPrisma,
  policy: GrandfatherPolicy,
): Promise<{ scanned: number; created: number }> {
  // Only APPROVED drivers who have not already accepted some version.
  const drivers = await prisma.driver.findMany({
    where: { status: 'approved', zeroToleranceAcceptedVersion: null },
    select: { id: true },
  });

  let created = 0;
  for (const d of drivers) {
    // Never create a duplicate acceptance for this (driver, version).
    const existing = await prisma.zeroToleranceAcceptance.findUnique({
      where: { driverId_policyVersion: { driverId: d.id, policyVersion: policy.version } },
    });
    if (!existing) {
      await prisma.zeroToleranceAcceptance.create({
        data: {
          driverId: d.id,
          policyVersion: policy.version,
          policyContentHash: policy.contentHash,
          source: 'grandfather',
        },
      });
      created++;
    }
    // Denormalized cache so the resolver sees them as covered.
    await prisma.driver.update({
      where: { id: d.id },
      data: { zeroToleranceAcceptedVersion: policy.version },
    });
  }

  return { scanned: drivers.length, created };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const policy = await prisma.zeroTolerancePolicy.findFirst({
      where: { isActive: true },
      orderBy: { effectiveAt: 'desc' },
    });
    if (!policy) {
      throw new Error(
        'No active ZeroTolerancePolicy found. Publish the initial policy before grandfathering.',
      );
    }
    const result = await grandfatherApprovedDrivers(prisma as unknown as GrandfatherPrisma, {
      version: policy.version,
      contentHash: policy.contentHash,
    });
    // eslint-disable-next-line no-console
    console.log(
      `Grandfather complete: scanned ${result.scanned} approved driver(s), created ${result.created} acceptance row(s) for policy ${policy.version}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked directly (not when imported by the spec).
if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
