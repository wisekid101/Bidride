#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// BidRide DEVELOPMENT-ONLY one-command stack startup (acceptance-demo harness).
//
// Order: pre-flight foreign-port check → repo-scoped shutdown → dev-proxy →
// backend services (incl. ai-service in its default shadow posture) → admin
// portal → both Expo Metros → set both simulators to Newark → load Expo Go →
// readiness report.
//
// SAFETY: if a managed port is held by a process OUTSIDE this repo, it STOPS
// with a clear message instead of killing it. It never blanket-kills node and
// never touches PostgreSQL/Redis. Portable: resolves the repo root, simulators,
// and log dir dynamically — no machine-specific paths. No secrets printed.
//
// Starts DETACHED processes and exits; they keep running. Stop with:
//   node scripts/dev/stack-down.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { openSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT, resolveSimulators } from '../lib/env.mjs';
import { holdersOnPort, classifyHolders } from '../lib/proc.mjs';
import { stackDown, MANAGED_PORTS } from './stack-down.mjs';
import { LOG_DIR } from './runtime.mjs';

mkdirSync(LOG_DIR, { recursive: true });

const NEWARK = '40.7357,-74.1724';
const RIDER_METRO_PORT = 8081;
const DRIVER_METRO_PORT = 8082;

const SERVICES = [
  { name: 'auth', filter: '@bidride/auth-service', port: 3001 },
  { name: 'trip', filter: '@bidride/trip-service', port: 3002 },
  { name: 'driver', filter: '@bidride/driver-service', port: 3003 },
  { name: 'rider', filter: '@bidride/rider-service', port: 3004 },
  { name: 'pricing', filter: '@bidride/pricing-service', port: 3005 },
  { name: 'safety', filter: '@bidride/safety-service', port: 3006 },
  { name: 'payment', filter: '@bidride/payment-service', port: 3007 },
  { name: 'notification', filter: '@bidride/notification-service', port: 3008 },
  { name: 'trust', filter: '@bidride/trust-service', port: 3009 },
  { name: 'airport', filter: '@bidride/airport-service', port: 3010 },
  { name: 'admin-service', filter: '@bidride/admin-service', port: 3011 },
  { name: 'ai-service', filter: '@bidride/ai-service', port: 3012 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logFd = (name) => openSync(join(LOG_DIR, `${name}.log`), 'a');

function startDetached(name, cmd, args, opts = {}) {
  const fd = logFd(name);
  const child = spawn(cmd, args, {
    cwd: opts.cwd || REPO_ROOT,
    env: { ...process.env, ...(opts.env || {}) },
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
}

function portUp(port) {
  try {
    execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

async function waitForPort(port, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (portUp(port)) return true;
    await sleep(1000);
  }
  console.log(`  ✗ ${label} (:${port}) did NOT come up within ${timeoutMs / 1000}s — see ${join(LOG_DIR, label + '.log')}`);
  return false;
}

function simctl(args) {
  try {
    return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' }).trim();
  } catch (e) {
    return `ERR:${e.message}`;
  }
}

/** Abort (without killing anything) if a managed port is held by a foreign process. */
function assertNoForeignCollisions() {
  const collisions = [];
  for (const port of MANAGED_PORTS) {
    const { foreign } = classifyHolders(holdersOnPort(port), REPO_ROOT);
    for (const f of foreign) collisions.push({ port, pid: f.pid, cwd: f.cwd });
  }
  if (collisions.length) {
    console.error('Port collision with processes OUTSIDE this repo — refusing to kill them:');
    for (const c of collisions) console.error(`  :${c.port} held by pid ${c.pid} (${c.cwd || 'unknown cwd'})`);
    console.error('Stop those processes yourself (or free the ports), then re-run.');
    process.exit(2);
  }
}

async function main() {
  console.log(`BidRide dev stack — logs in ${LOG_DIR}\n`);

  // 0. Refuse to proceed if an unrelated process holds one of our ports.
  assertNoForeignCollisions();

  // 1. Clean slate (repo-scoped only — never foreign, never Postgres/Redis).
  stackDown({ quiet: false });
  console.log('');

  const { driver, rider } = resolveSimulators();

  console.log('Starting dev-proxy (:8080)…');
  startDetached('dev-proxy', 'node', ['scripts/dev-proxy.js']);

  console.log('Starting backend services (nest --watch)…');
  for (const s of SERVICES) startDetached(s.name, 'pnpm', ['--filter', s.filter, 'dev']);

  console.log('Starting admin portal (:3000)…');
  startDetached('admin', 'pnpm', ['--filter', '@bidride/admin', 'dev']);

  console.log('Starting Expo Metros…');
  startDetached('metro-rider', 'npx', ['expo', 'start', '--port', String(RIDER_METRO_PORT)], {
    cwd: join(REPO_ROOT, 'apps/rider-app'),
    env: { EXPO_OFFLINE: '1' },
  });
  startDetached('metro-driver', 'npx', ['expo', 'start', '--port', String(DRIVER_METRO_PORT)], {
    cwd: join(REPO_ROOT, 'apps/driver-app'),
    env: { EXPO_OFFLINE: '1' },
  });

  console.log('\nWaiting for ports…');
  const results = [];
  results.push(['dev-proxy', await waitForPort(8080, 'dev-proxy', 30_000)]);
  for (const s of SERVICES) results.push([s.name, await waitForPort(s.port, s.name)]);
  results.push(['portal', await waitForPort(3000, 'admin', 120_000)]);
  results.push(['metro-rider', await waitForPort(RIDER_METRO_PORT, 'metro-rider', 60_000)]);
  results.push(['metro-driver', await waitForPort(DRIVER_METRO_PORT, 'metro-driver', 60_000)]);

  console.log('\nSimulators:');
  console.log(`  driver ${driver.slice(0, 8)}… · rider ${rider.slice(0, 8)}…`);
  simctl(['location', rider, 'set', NEWARK]);
  simctl(['location', driver, 'set', NEWARK]);
  console.log(`  both simulators set to Newark (${NEWARK})`);
  simctl(['openurl', rider, `exp://127.0.0.1:${RIDER_METRO_PORT}`]);
  simctl(['openurl', driver, `exp://127.0.0.1:${DRIVER_METRO_PORT}`]);
  console.log('  Expo Go opened on both simulators');

  console.log('\n──────────── READINESS REPORT ────────────');
  for (const [name, ok] of results) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  const allUp = results.every(([, ok]) => ok);
  console.log('──────────────────────────────────────────');
  console.log(allUp ? 'Infra READY.' : 'Infra came up with GAPS — check the ✗ logs above.');
  console.log('\nNEXT (manual, cannot be verified pre-login):');
  console.log('  • Driver sim: log in and toggle Online → the driver socket + heartbeat then exist.');
  console.log('  • Verify:  node scripts/dev/readiness.mjs');
  console.log('  • Portal:  http://localhost:3000');
  console.log(`  • Logs:    ${LOG_DIR}`);
  console.log('  • Stop:    node scripts/dev/stack-down.mjs');
}

main().catch((e) => {
  console.error(`stack-up error: ${e.message}`);
  process.exit(1);
});
