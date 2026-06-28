/**
 * Dev-only seed: places an active fraud alert on the demo rider and demo driver.
 *
 * Usage:  pnpm db:seed:fraud
 *
 * After running, open the admin fraud page and clear the alert to verify
 * the end-to-end workflow. Once cleared, the rider/driver can create trips again.
 */
import { PrismaClient } from '../generated/client';

const prisma = new PrismaClient();

async function main() {
  const riderUser = await prisma.user.findUnique({ where: { phone: '+15551234567' } });
  const driverUser = await prisma.user.findUnique({ where: { phone: '+15559876543' } });

  if (!riderUser || !driverUser) {
    console.error('Demo users not found. Run pnpm db:seed first.');
    process.exit(1);
  }

  const riderAlert = await prisma.fraudAlert.create({
    data: {
      userId: riderUser.id,
      userRole: 'rider',
      fraudProbability: 94.5,
      triggerSignals: {
        linkedAccounts: 4,
        deviceFingerprints: 7,
        fraudFlagCount: 1,
        disputeCount: 2,
        accountAgeDays: 30,
        totalTrips: 3,
      },
      status: 'pending',
    },
  });

  const driverAlert = await prisma.fraudAlert.create({
    data: {
      userId: driverUser.id,
      userRole: 'driver',
      fraudProbability: 91.2,
      triggerSignals: {
        linkedAccounts: 2,
        deviceFingerprints: 5,
        fraudFlagCount: 0,
        disputeCount: 1,
        accountAgeDays: 60,
        totalTrips: 47,
      },
      status: 'pending',
    },
  });

  console.log('\n=== FRAUD ALERT SEED ===');
  console.log(`Rider alert created:  ${riderAlert.id}  (user: ${riderUser.email})`);
  console.log(`Driver alert created: ${driverAlert.id}  (user: ${driverUser.email})`);
  console.log('\nBoth accounts now have an active fraud hold.');
  console.log('Go to admin /fraud to review. Clear an alert to release the hold.');
  console.log('========================\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
