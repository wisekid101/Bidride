import { PrismaClient, AdminRole, UserRole, DriverStatus, BackgroundCheckStatus, TrustUserRole } from '../generated/client';
import * as bcrypt from 'bcrypt';
import { resolveFounderSeed } from './founder-seed';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding BidRide database...');

  // Platform config — founder-controlled values
  await prisma.platformConfig.upsert({
    where: { key: 'earnings_floor_formula' },
    update: {},
    create: {
      key: 'earnings_floor_formula',
      value: { per_mile: 1.10, per_min: 0.22, base: 2.50 },
      description: 'Driver earnings floor formula. Founder-only write.',
    },
  });

  await prisma.platformConfig.upsert({
    where: { key: 'platform_fee_rate' },
    update: {},
    create: {
      key: 'platform_fee_rate',
      value: { rate: 0.20 },
      description: 'Platform fee rate (20%). Applied to all trips.',
    },
  });

  await prisma.platformConfig.upsert({
    where: { key: 'instant_payout_fee' },
    update: {},
    create: {
      key: 'instant_payout_fee',
      value: { flat: 0.99, min_balance: 10.00, daily_cap: 500.00, hold_hours: 2 },
      description: 'Instant payout fee and constraints.',
    },
  });

  await prisma.platformConfig.upsert({
    where: { key: 'ai_surge_config' },
    update: {},
    create: {
      key: 'ai_surge_config',
      value: {
        requests_per_zone_threshold: 150,
        max_multiplier: 2.5,
        admin_confirm_above: 1.5,
        zone_size_km: 2.0,
      },
      description: 'Surge multiplier config. Admin confirm required above 1.5x.',
    },
  });

  await prisma.platformConfig.upsert({
    where: { key: 'trip_wait_config' },
    update: {},
    create: {
      key: 'trip_wait_config',
      value: {
        free_wait_minutes: 2,
        wait_fee_per_minute: 0.25,
        no_show_minutes: 5,
      },
      description: 'Driver wait time and no-show configuration.',
    },
  });

  await prisma.platformConfig.upsert({
    where: { key: 'safety_config' },
    update: {},
    create: {
      key: 'safety_config',
      value: {
        sos_sla_seconds: 90,
        night_ride_start_hour: 22,
        night_ride_end_hour: 5,
        check_in_response_minutes: 5,
        route_deviation_soft_meters: 400,
        route_deviation_critical_meters: 800,
      },
      description: 'Safety system thresholds. Safety Admin write.',
    },
  });

  await prisma.platformConfig.upsert({
    where: { key: 'bid_config' },
    update: {},
    create: {
      key: 'bid_config',
      value: {
        rider_request_expiry_seconds: 20,
        driver_accept_window_seconds: 15,
        max_counter_rounds: 1,
        min_bid_amount: 5.00,
      },
      description: 'Bidding system configuration.',
    },
  });

  await prisma.platformConfig.upsert({
    where: { key: 'driver_performance_thresholds' },
    update: {},
    create: {
      key: 'driver_performance_thresholds',
      value: {
        good_standing_acceptance_rate: 0.70,
        good_standing_completion_rate: 0.95,
        good_standing_min_rating: 4.5,
      },
      description: 'Good standing thresholds for driver performance.',
    },
  });

  // Initial Founder admin account — SECURITY: no default credential exists.
  // Creation requires FOUNDER_SEED_PASSWORD (dev-only secret, never logged);
  // reruns never overwrite an existing founder password.
  const existingFounder = await prisma.adminUser.findUnique({
    where: { email: 'marq@bidride.com' },
    select: { id: true },
  });
  const founderDecision = resolveFounderSeed(process.env, existingFounder !== null);

  if (founderDecision.action === 'create') {
    const passwordHash = await bcrypt.hash(founderDecision.password, 12);
    const founder = await prisma.adminUser.create({
      data: {
        email: 'marq@bidride.com',
        passwordHash,
        firstName: 'Marq',
        lastName: 'Brown',
        adminRole: AdminRole.founder,
        mfaEnabled: false,
      },
    });
    console.log(`Founder admin created: ${founder.email}`); // email only — never the credential
  } else {
    console.log(`Founder admin seeding: ${founderDecision.action} (${founderDecision.reason})`);
  }

  // Demo rider
  const riderUser = await prisma.user.upsert({
    where: { phone: '+15551234567' },
    update: {},
    create: {
      phone: '+15551234567',
      email: 'demo.rider@bidride.com',
      firstName: 'Alex',
      lastName: 'Demo',
      role: UserRole.rider,
      phoneVerified: true,
      emailVerified: true,
      rider: {
        create: {
          displayName: 'Alex Demo',
          rewardPoints: 0,
        },
      },
    },
  });

  // Demo driver (pre-approved so we can test rides immediately)
  const driverUser = await prisma.user.upsert({
    where: { phone: '+15559876543' },
    update: {},
    create: {
      phone: '+15559876543',
      email: 'demo.driver@bidride.com',
      firstName: 'Jordan',
      lastName: 'Driver',
      role: UserRole.driver,
      phoneVerified: true,
      emailVerified: true,
      driver: {
        create: {
          legalFirstName: 'Jordan',
          legalLastName: 'Driver',
          dateOfBirth: new Date('1990-05-15'),
          homeAddress: '123 Main St, Newark, NJ',
          homeCity: 'Newark',
          homeState: 'NJ',
          homeZip: '07102',
          licenseNumber: 'D123456789',
          licenseState: 'NJ',
          licenseClass: 'D',
          licenseExpiry: new Date('2027-05-15'),
          backgroundCheckStatus: BackgroundCheckStatus.clear,
          status: DriverStatus.approved,
          onboardingStep: 'complete',
          isAvailable: false,
          stripeAccountId: 'acct_demo_driver_001',
          payoutBankVerified: true,
          totalTrips: 47,
          avgRating: 4.92,
          acceptanceRate: 0.95,
          completionRate: 0.98,
          eligibleRideTypes: ['standard', 'priority'],
          vehicles: {
            create: {
              make: 'Toyota',
              model: 'Camry',
              year: 2022,
              color: 'Silver',
              licensePlate: 'BID-RIDE',
              licensePlateState: 'NJ',
              vin: '4T1BF1FK5CU123456',
              vehicleClass: 'standard',
              isActive: true,
              status: 'approved',
              inspectionStatus: 'passed',
              inspectionDate: new Date('2024-01-15'),
              inspectionExpiresAt: new Date('2025-01-15'),
            },
          },
        },
      },
    },
  });

  // Trust scores for demo users
  await prisma.trustScore.upsert({
    where: { userId: riderUser.id },
    update: {},
    create: {
      userId: riderUser.id,
      userRole: TrustUserRole.rider,
      trustScore: 750,
      fraudProbability: 0.02,
      verificationConfidence: 0.95,
      currentBadge: 'verified',
    },
  });

  await prisma.trustScore.upsert({
    where: { userId: driverUser.id },
    update: {},
    create: {
      userId: driverUser.id,
      userRole: TrustUserRole.driver,
      trustScore: 820,
      fraudProbability: 0.01,
      verificationConfidence: 0.98,
      currentBadge: 'trusted',
    },
  });

  console.log(`Demo rider created: ${riderUser.phone} (${riderUser.email})`);
  console.log(`Demo driver created: ${driverUser.phone} (${driverUser.email})`);
  console.log('Platform config seeded: 8 entries');
  console.log('\n=== DEMO ACCOUNTS ===');
  console.log('Rider phone:  +15551234567  (OTP logged to console in dev mode)');
  console.log('Driver phone: +15559876543  (OTP logged to console in dev mode)');
  console.log('Admin email:  marq@bidride.com  (password: the FOUNDER_SEED_PASSWORD you provided — never printed)');
  console.log('========================\n');
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
