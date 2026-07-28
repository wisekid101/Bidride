// Cross-service E2E: real PostgreSQL, real Redis, and a real internal-service
// credential. INTERNAL_SERVICE_KEY is required here (unlike the per-service
// integration suites) because these scenarios run the services with NODE_ENV
// outside {development,test}, which makes the internal-key guard fail closed —
// that is the point: the guard must be genuinely exercised, not bypassed.
require('../../../scripts/test/require-integration-env')([
  'TEST_DATABASE_URL',
  'TEST_REDIS_URL',
  'INTERNAL_SERVICE_KEY',
]);
