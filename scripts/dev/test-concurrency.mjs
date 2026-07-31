#!/usr/bin/env node
'use strict';

/**
 * CLI wrapper around the RAM-aware concurrency resolver in
 * packages/jest-preset/concurrency.js (a CommonJS module owned by a
 * separate workstream this sprint).
 *
 * WHY THIS EXISTS: `pnpm test` fans out across every workspace through
 * Turborepo (default concurrency = 10), and each workspace spawns its own
 * Jest worker pool (default maxWorkers = cores - 1). Multiplying two
 * CPU-derived dials together is what OOM-crashed an 8GB dev machine. The
 * resolver computes RAM-safe values instead; this script exposes them to
 * the shell/CI and, via --run, drives `pnpm test` itself so a bare
 * `pnpm test` is safe by default without depending on shell command
 * substitution (which doesn't exist in cmd.exe / PowerShell).
 *
 * Usage:
 *   node scripts/dev/test-concurrency.mjs --turbo      # prints turboConcurrency()
 *   node scripts/dev/test-concurrency.mjs --jest        # prints jestWorkers()
 *   node scripts/dev/test-concurrency.mjs --describe    # prints describeEnvironment() (default, no args)
 *   node scripts/dev/test-concurrency.mjs --run         # spawns `turbo run test` with the resolved bounds
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Contract with the parallel jest-preset workstream: this module is
// CommonJS and exports { cpuCount, workerBudget, jestWorkers,
// turboConcurrency, describeEnvironment }. It honors BIDRIDE_JEST_WORKERS
// and TURBO_CONCURRENCY env overrides internally.
const CONCURRENCY_MODULE_PATH = path.resolve(
  __dirname,
  '../../packages/jest-preset/concurrency.js',
);

function loadResolver() {
  try {
    return require(CONCURRENCY_MODULE_PATH);
  } catch (err) {
    console.error(
      `test-concurrency: could not load resolver at ${CONCURRENCY_MODULE_PATH}`,
    );
    console.error(`  ${err.message}`);
    process.exit(1);
  }
}

function printValue(mode) {
  const { turboConcurrency, jestWorkers, describeEnvironment } = loadResolver();
  switch (mode) {
    case '--turbo':
      console.log(String(turboConcurrency()));
      return;
    case '--jest':
      console.log(String(jestWorkers()));
      return;
    case '--describe':
    case undefined:
      console.log(describeEnvironment());
      return;
    default:
      console.error(`test-concurrency: unknown argument "${mode}"`);
      console.error('Usage: test-concurrency.mjs [--turbo|--jest|--describe|--run]');
      process.exit(1);
  }
}

// Resolves bounded values in this one Node process and spawns turbo with
// them as literal argv entries (an array, never an interpolated shell
// string), so there is no shell command-substitution dependency and no
// argument-injection surface.
function runBounded(task = 'test') {
  const { turboConcurrency, jestWorkers, describeEnvironment } = loadResolver();
  const turbo = turboConcurrency();
  const jest = jestWorkers();
  console.error(`test-concurrency: ${describeEnvironment()}`);
  // Only the `test` task takes a jest passthrough. `typecheck` runs tsc, which
  // would reject --maxWorkers as an unknown option. typecheck still needs the
  // turbo bound: Phase 1 gave every package a second tsc project (tsconfig.spec.json),
  // so an unbounded `turbo run typecheck` is the same OOM shape as the old `pnpm test`.
  const passthrough = task === 'test' ? ['--', `--maxWorkers=${jest}`] : [];
  const result = spawnSync(
    'turbo',
    ['run', task, `--concurrency=${turbo}`, ...passthrough],
    {
      stdio: 'inherit',
      // turbo is a .cmd shim on Windows; PATH-based spawn without a shell
      // won't resolve it there. POSIX platforms don't need this.
      shell: process.platform === 'win32',
    },
  );
  if (result.error) {
    console.error(`test-concurrency: failed to spawn turbo: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

const arg = process.argv[2];
if (arg === '--run') {
  runBounded('test');
} else if (arg === '--run-typecheck') {
  runBounded('typecheck');
} else {
  printValue(arg);
}
