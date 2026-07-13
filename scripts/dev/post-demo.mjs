#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// BidRide DEVELOPMENT-ONLY post-demo readiness check.
//
// After the final acceptance-flow step, an idle simulator app can be evicted by
// the OS (backgrounded by the XCUITest teardown, then reclaimed under memory
// pressure) and drift to Springboard. This script re-foregrounds BOTH apps via
// `simctl openurl` (stopApp:false semantics — never a kill), confirms each Expo
// Go process is running AND has a live dev-proxy connection, confirms there is no
// active trip, and prints a readiness summary.
//
// It changes NOTHING in the product: no background execution, no socket/GPS/
// trip-state behavior, no full-stack restart. Idempotent — safe if the app is
// already foregrounded. If an app cannot be foregrounded/connected it is reported
// and the process exits non-zero (never a silent pass).
//
// Usage: node scripts/dev/post-demo.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveSimulators, databaseUrl } from '../lib/env.mjs';

const DEV_PROXY_PORT = 8080;
const RIDER_METRO_PORT = 8081;
const DRIVER_METRO_PORT = 8082;

// Trip states that mean a ride is still in flight (must be absent post-demo).
export const ACTIVE_TRIP_STATES = ['searching', 'accepted', 'driver_arrived', 'in_progress'];

// ── PURE (unit-tested) ───────────────────────────────────────────────────────

/**
 * PURE: extract the host PID of Expo Go from `simctl spawn <udid> launchctl list`.
 * launchctl lists a not-running service with a '-' PID → returns null (so a merely
 * installed-but-closed app is correctly reported as not running).
 */
export function expoPidFromLaunchctl(output) {
  for (const line of String(output || '').split('\n')) {
    if (line.includes('host.exp.Exponent')) {
      const pid = line.trim().split(/\s+/)[0];
      if (/^\d+$/.test(pid)) return pid;
    }
  }
  return null;
}

/** PURE: is the app's host PID among those holding an established dev-proxy connection? */
export function isPidConnected(establishedPids, pid) {
  return Boolean(pid) && establishedPids.map(String).includes(String(pid));
}

/** PURE: does any trip row represent a still-active trip? */
export function hasActiveTrip(statuses, activeStates = ACTIVE_TRIP_STATES) {
  return statuses.some((s) => activeStates.includes(String(s).trim()));
}

/** PURE: build the readiness summary lines from resolved facts. */
export function summaryLines({ rider, driver, activeTrip }) {
  const app = (ok) => (ok ? 'foregrounded and connected' : 'NOT READY');
  return [
    `- Rider app: ${app(rider.running && rider.connected)}`,
    `- Driver app: ${app(driver.running && driver.connected)}`,
    `- Active trip: ${activeTrip ? 'PRESENT (unexpected)' : 'none'}`,
    `- Stack: ${rider.connected && driver.connected ? 'healthy' : 'degraded'}`,
    `- Demo complete`,
  ];
}

// ── impure probes ──────────────────────────────────────────────────────────────

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

function establishedPids(port) {
  const out = sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:ESTABLISHED', '-t']);
  return out ? [...new Set(out.split('\n').filter(Boolean))] : [];
}

function expoHostPid(udid) {
  return expoPidFromLaunchctl(sh('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list']));
}

function foreground(udid, metroPort) {
  // stopApp:false semantics — re-foreground WITHOUT killing (idempotent).
  sh('xcrun', ['simctl', 'openurl', udid, `exp://127.0.0.1:${metroPort}`]);
}

function activeTripPresent() {
  const list = ACTIVE_TRIP_STATES.map((s) => `'${s}'`).join(',');
  const out = sh('psql', [databaseUrl(), '-A', '-t', '-c',
    `select count(*) from trips where status in (${list})`]);
  return Number(out || '0') > 0;
}

async function checkApp(label, udid, metroPort) {
  foreground(udid, metroPort);
  const deadline = Date.now() + 30_000;
  let running = false;
  let connected = false;
  while (Date.now() < deadline) {
    const pid = expoHostPid(udid);
    running = Boolean(pid);
    connected = isPidConnected(establishedPids(DEV_PROXY_PORT), pid);
    if (running && connected) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { label, running, connected };
}

async function main() {
  const { driver, rider } = resolveSimulators();
  console.log('Post-demo readiness — re-foregrounding both simulator apps…\n');

  const riderState = await checkApp('Rider', rider, RIDER_METRO_PORT);
  const driverState = await checkApp('Driver', driver, DRIVER_METRO_PORT);
  const activeTrip = activeTripPresent();

  console.log('──────────── READINESS ────────────');
  for (const line of summaryLines({ rider: riderState, driver: driverState, activeTrip })) {
    console.log(line);
  }
  console.log('────────────────────────────────────');

  const problems = [];
  for (const s of [riderState, driverState]) {
    if (!s.running) problems.push(`${s.label} app is NOT running (could not be foregrounded)`);
    else if (!s.connected) problems.push(`${s.label} app is running but has NO dev-proxy connection`);
  }
  if (activeTrip) problems.push('An active trip still exists (expected none post-demo)');

  if (problems.length) {
    console.error('\nNOT READY:');
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`post-demo error: ${e.message}`);
    process.exit(1);
  });
}
