// Shared, portable helpers for the DEV-ONLY acceptance harness.
// Everything resolves relative to the repository — no machine-specific absolute
// paths — so the scripts work from any clone location. No secrets are printed.

import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// scripts/lib/env.mjs → repo root is two levels up.
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Directory for dev artifacts (screenshots, logs). Gitignored; created on demand. */
export function artifactsDir() {
  const dir = process.env.BIDRIDE_ARTIFACTS_DIR || resolve(REPO_ROOT, '.dev-artifacts');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Read-only dev DATABASE_URL from packages/database/.env (relative to repo). */
export function databaseUrl() {
  const envPath = resolve(REPO_ROOT, 'packages/database/.env');
  const m = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL not found in packages/database/.env');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

/** Founder portal password from .env.founder.local (repo-relative, gitignored). Never logged. */
export function founderPassword() {
  const envPath = resolve(REPO_ROOT, '.env.founder.local');
  if (!existsSync(envPath)) {
    throw new Error('.env.founder.local not found at repo root (needed for portal capture)');
  }
  const m = readFileSync(envPath, 'utf8').match(/^FOUNDER_PASSWORD=(.+)$/m);
  if (!m) throw new Error('FOUNDER_PASSWORD not set in .env.founder.local');
  return m[1].trim();
}

function bootedDevices() {
  // Returns [{ name, udid }] for currently-booted simulators.
  const out = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available'], { encoding: 'utf8' });
  const devices = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s+(.+?)\s+\(([0-9A-F-]{36})\)\s+\(Booted\)/i);
    if (m) devices.push({ name: m[1].trim(), udid: m[2] });
  }
  return devices;
}

/**
 * Resolve the driver + rider simulator UDIDs portably:
 *   1. env DRIVER_UDID / RIDER_UDID if set;
 *   2. else auto-detect booted devices by name (iPhone 17 Pro → driver, iPhone 17 → rider);
 *   3. else fall back to the first two booted devices.
 * Throws a clear error if two simulators can't be resolved.
 */
export function resolveSimulators() {
  let driver = process.env.DRIVER_UDID;
  let rider = process.env.RIDER_UDID;
  if (driver && rider) return { driver, rider };

  const booted = bootedDevices();
  if (!driver) {
    driver = booted.find((d) => /iphone.*pro/i.test(d.name))?.udid;
  }
  if (!rider) {
    rider = booted.find((d) => /iphone/i.test(d.name) && !/pro/i.test(d.name))?.udid;
  }
  // Fallback: first two distinct booted devices.
  if (!driver || !rider) {
    const ids = booted.map((d) => d.udid);
    driver = driver || ids[0];
    rider = rider || ids.find((id) => id !== driver);
  }
  if (!driver || !rider || driver === rider) {
    throw new Error(
      'Could not resolve two booted simulators. Boot a driver + rider simulator, ' +
      'or set DRIVER_UDID and RIDER_UDID.',
    );
  }
  return { driver, rider };
}
