#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// BidRide DEVELOPMENT-ONLY stack shutdown.
//
// Stops ONLY this repo's dev processes: for every managed port it finds the
// listeners and terminates one ONLY if its working directory is inside this
// repository. It never blanket-kills node/pnpm/Expo/Metro, never touches a
// foreign process that happens to share a port (it reports that instead), and
// never touches PostgreSQL (5432) or Redis (6379). Idempotent: safe to run when
// nothing is up, and safe to run twice.
// ─────────────────────────────────────────────────────────────────────────────

import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from '../lib/env.mjs';
import { holdersOnPort, classifyHolders, isAlive, kill, PROTECTED_PORTS } from '../lib/proc.mjs';
import { LOG_DIR } from './runtime.mjs';

// Ports this harness manages. PROTECTED_PORTS (5432/6379) are deliberately absent.
export const MANAGED_PORTS = [
  3000, // admin portal (Next)
  3001, 3002, 3003, 3004, 3005, 3007, 3008, 3009, 3011, 3012, // backend services
  8080, // dev-proxy
  8081, 8082, // Metro (rider / driver)
];

export function stackDown({ quiet = false, clean = false } = {}) {
  const log = quiet ? () => {} : (m) => console.log(m);
  log('Stopping repo-scoped dev processes (Postgres/Redis never touched):');

  const targets = [];
  for (const port of MANAGED_PORTS) {
    if (PROTECTED_PORTS.has(port)) continue; // defensive: never manage infra ports
    const { ours, foreign } = classifyHolders(holdersOnPort(port), REPO_ROOT);
    for (const h of ours) targets.push({ ...h, port });
    for (const f of foreign) {
      log(`  port ${port}: pid ${f.pid} is NOT under this repo — leaving it alone`);
    }
  }

  if (targets.length === 0) {
    log('  nothing to stop.');
  } else {
    for (const t of targets) kill(t.pid, '-TERM');
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && targets.some((t) => isAlive(t.pid))) {
      // brief spin so graceful shutdown can complete before SIGKILL
    }
    for (const t of targets) {
      if (isAlive(t.pid)) {
        kill(t.pid, '-9');
        log(`  port ${t.port}: pid ${t.pid} force-killed`);
      } else {
        log(`  port ${t.port}: pid ${t.pid} stopped`);
      }
    }
    const stillOurs = MANAGED_PORTS.filter(
      (p) => classifyHolders(holdersOnPort(p), REPO_ROOT).ours.length > 0,
    );
    log(stillOurs.length ? `  WARNING: still listening (ours): ${stillOurs.join(', ')}` : '  all managed ports clear.');
  }

  if (clean) {
    try {
      rmSync(LOG_DIR, { recursive: true, force: true });
      log(`  cleaned runtime logs (${LOG_DIR}).`);
    } catch {
      /* nothing to clean */
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  stackDown({ clean: process.argv.includes('--clean') });
}
