/**
 * BidRide — integration-test environment guard.
 *
 * Integration suites must never report success without having run. Before this
 * guard existed, a missing TEST_DATABASE_URL turned whole suites into
 * `describe.skip` (payment-service) or silently fell back to a hardcoded
 * connection string (trip-service). Both look identical to a passing run.
 *
 * Loaded from each service's jest.integration.json via `setupFiles`. It:
 *   1. loads the repo-root .env, so `pnpm turbo run test:int` works with no
 *      manual exports (a real environment variable always wins — dotenv never
 *      overwrites one that is already set, so CI keeps full control);
 *   2. hard-fails with an actionable message if a required variable is still
 *      missing, so misconfiguration is loud instead of green.
 *
 * Usage (per service, declaring exactly what that suite needs):
 *   require('../../../scripts/test/require-integration-env')(['TEST_DATABASE_URL']);
 */
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');

const ROOT = resolve(__dirname, '../..');

module.exports = function requireIntegrationEnv(required) {
  const rootEnv = resolve(ROOT, '.env');
  if (existsSync(rootEnv)) {
    require('dotenv').config({ path: rootEnv });
  }

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length === 0) return;

  const lines = [
    '',
    '  Integration tests cannot run — required configuration is missing:',
    ...missing.map((k) => `    • ${k}`),
    '',
    '  These suites talk to a real PostgreSQL/Redis. Running them without',
    '  configuration would skip silently and report a false pass, so this is',
    '  a hard failure instead.',
    '',
    '  Fix: start the local stack and make sure the values are set.',
    '    pnpm dev:up',
    `    (they are defined in ${rootEnv})`,
    '',
  ];
  throw new Error(lines.join('\n'));
};
