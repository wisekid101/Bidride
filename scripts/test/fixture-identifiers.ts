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
 *   3  airport-service
 *   4  cross-service E2E             (this file)
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

/**
 * Cross-service end-to-end suites — block 4.
 *
 * E2E scenarios compose several services against the same bidride_test
 * database, so they must not reuse any single service's block: a service suite
 * cleaning up by phone would delete an E2E fixture mid-scenario, and vice
 * versa. One sub-range per scenario keeps concurrent scenarios independent too.
 */
export const E2E_FIXTURE_PHONES = {
  /** E2 — standard (non-bid) ride happy path. */
  standardRide: {
    rider: '+19995554001',
    driver: '+19995554002',
  },
} as const;

/**
 * Non-phone identifiers owned by the E2E suites. Vendor-shaped ids are
 * deliberately marked so a real vendor could never mistake them for its own,
 * and so cleanup can scope on the prefix.
 */
export const E2E_FIXTURE_IDS = {
  /** Prefix for every Stripe-shaped identifier minted by the vendor stub. */
  stripePrefix: 'e2e_test',
  /** Prefix for correlation / idempotency keys written by E2E scenarios. */
  correlationPrefix: 'e2e-standard-ride',
} as const;
