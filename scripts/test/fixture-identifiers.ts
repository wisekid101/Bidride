/**
 * BidRide — reserved integration-test fixture identifiers.
 *
 * Every integration suite runs against the same `bidride_test` database. When
 * Turbo executes those suites in parallel, two suites that happen to pick the
 * same fixture phone number will delete or overwrite each other's rows, which
 * surfaces as an unrelated-looking failure in whichever suite loses the race
 * (observed: `Foreign key constraint violated: payout_requests_driver_id_fkey`
 * when one suite's cleanup removed a driver another suite owned).
 *
 * Numbers are `+1999555Bnnn`, where B is a per-suite block digit. Allocate a
 * NEW block digit for a new suite; never reuse one. Literals are written out in
 * full rather than generated, so a duplicate scan across the repo works:
 *
 *   grep -rhoE "'\+1999555[0-9]{4}'" --include='*.integration.spec.ts' services \
 *     | sort | uniq -d          # must print nothing
 *
 * Block allocation
 *   0  trip-service
 *   1  auth-service                  (this file)
 *   2  safety-service                (this file)
 *   3  — free
 *   4  — free
 *   5  — free
 *   6  driver-service
 *   7  payment-service / payout-submission
 *   8  payment-service / payout-allocation
 *   9  payment-service / wallet-earning
 *
 * trip, driver and payment still declare their (already unique) numbers inline;
 * migrating them to this file is a follow-up. Until then, this list is the
 * record of what is taken — check it before choosing a block.
 */

/** auth-service — block 1. */
export const AUTH_FIXTURE_PHONES = {
  otp: '+19995551001',
  rateLimit: '+19995551002',
  ttl: '+19995551003',
  owner: '+19995551004',
  other: '+19995551005',
} as const;

/** safety-service — block 2. */
export const SAFETY_FIXTURE_PHONES = {
  rider: '+19995552001',
  driver: '+19995552002',
  trustedContact: '+19995552003',
} as const;
