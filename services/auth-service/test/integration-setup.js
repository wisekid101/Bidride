// These suites exercise real persistence AND the Redis-backed OTP/session state.
require('../../../scripts/test/require-integration-env')(['TEST_DATABASE_URL', 'TEST_REDIS_URL']);
