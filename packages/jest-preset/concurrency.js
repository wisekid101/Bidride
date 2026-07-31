'use strict';

/**
 * RAM-aware concurrency resolver for the BidRide test fleet.
 *
 * WHY MEMORY-DERIVED, NOT CPU-DERIVED:
 * `pnpm test` fans out across 16 workspaces through Turborepo (default
 * concurrency = 10), and each workspace spawns its own Jest worker pool
 * (default maxWorkers = cores - 1). Multiplying two CPU-derived dials
 * together is exactly what produced the OOM crashes this package exists
 * to fix: on the reference 8GB/8-core dev machine, CPU count says "you
 * have 8 cores, use ~7 workers per package" while 10 packages run in
 * parallel -- which asks the OS to schedule ~70 concurrent Jest workers
 * on a box with 8GB of RAM. Cores are abundant on that machine; RAM is
 * the binding constraint. So instead of asking "how many cores do I
 * have," this resolver asks "how many transpile-only Jest workers can
 * actually fit in memory at once, after reserving headroom for the OS,
 * editor, Claude Code, and Electron overhead" -- and only then folds in
 * CPU count as an upper bound (no point scheduling more workers than
 * cores that exist).
 */

const os = require('node:os');

const GB = 1024 ** 3;
const RESERVE_GB = 3; // OS + editor + Claude Code + Electron headroom
const PER_WORKER_GB = 1; // measured peak per transpile-only jest worker, with margin
const MAX_JEST_WORKERS = 4; // diminishing returns past this per package

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Parses an environment variable override. Returns the positive integer
 * value if valid, or null if the override is unset, non-numeric,
 * non-integer, or not positive -- in which case callers must fall back
 * to the computed value.
 */
function parsePositiveIntEnv(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return null;
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function cpuCount() {
  if (typeof os.availableParallelism === 'function') {
    return os.availableParallelism();
  }
  return os.cpus()?.length ?? 1;
}

function workerBudget() {
  const memBudget = Math.floor((os.totalmem() / GB - RESERVE_GB) / PER_WORKER_GB);
  return clamp(Math.min(memBudget, cpuCount()), 2, 32);
}

function jestWorkers() {
  const override = parsePositiveIntEnv(process.env.BIDRIDE_JEST_WORKERS);
  if (override !== null) {
    return override;
  }
  return clamp(Math.floor(Math.sqrt(workerBudget())), 1, MAX_JEST_WORKERS);
}

function turboConcurrency() {
  const override = parsePositiveIntEnv(process.env.TURBO_CONCURRENCY);
  if (override !== null) {
    return override;
  }
  return clamp(Math.floor(workerBudget() / jestWorkers()), 1, cpuCount());
}

function describeEnvironment() {
  const totalMemGB = Math.round(os.totalmem() / GB);
  const cpus = cpuCount();
  const budget = workerBudget();
  const turbo = turboConcurrency();
  const jest = jestWorkers();
  return `${totalMemGB}GB RAM / ${cpus} cpus -> budget ${budget} workers -> turbo concurrency ${turbo} x jest maxWorkers ${jest}`;
}

module.exports = {
  cpuCount,
  workerBudget,
  jestWorkers,
  turboConcurrency,
  describeEnvironment,
};
