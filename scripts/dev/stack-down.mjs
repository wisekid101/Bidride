#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// BidiRide DEVELOPMENT-ONLY stack shutdown.
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
import { holdersOnPort, classifyHolders, isAlive, kill, pgidOf, repoDevProcs, PROTECTED_PORTS } from '../lib/proc.mjs';
import { LOG_DIR } from './runtime.mjs';

// Ports this harness manages. PROTECTED_PORTS (5432/6379) are deliberately absent.
export const MANAGED_PORTS = [
  3000, // admin portal (Next)
  3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, 3011, 3012, // backend services
  8080, // dev-proxy
  8081, 8082, // Metro (rider / driver)
];

export function stackDown({ quiet = false, clean = false } = {}) {
  const log = quiet ? () => {} : (m) => console.log(m);
  log('Stopping repo-scoped dev processes (Postgres/Redis never touched):');

  const selfPid = process.pid;
  const selfPgid = pgidOf(selfPid);

  // Discover port holders: report foreign collisions, collect ours.
  const ourHolders = [];
  for (const port of MANAGED_PORTS) {
    if (PROTECTED_PORTS.has(port)) continue; // defensive: never manage infra ports
    const { ours, foreign } = classifyHolders(holdersOnPort(port), REPO_ROOT);
    for (const h of ours) ourHolders.push({ ...h, port });
    for (const f of foreign) {
      log(`  port ${port}: pid ${f.pid} is NOT under this repo — leaving it alone`);
    }
  }

  // Terminate whole PROCESS GROUPS, not just the port listener. `nest start
  // --watch` spawns pnpm -> nest/tsc -> app as one detached group; killing only
  // the port holder orphans the pnpm parent and the tsc watcher (which holds
  // thousands of node_modules file descriptors), leaking them across every
  // restart. Kill the group of every repo-owned port holder PLUS every managed
  // dev process found by the unique '@bidride/' signature (pnpm parents, Metro,
  // portal) so the entire tree dies and no watcher survives. Our own group is
  // never touched; Postgres/Redis/foreign processes never match.
  const targetPids = new Set();
  const pgids = new Set();
  for (const h of ourHolders) {
    targetPids.add(h.pid);
    const g = pgidOf(h.pid);
    if (g) pgids.add(g);
  }
  for (const p of repoDevProcs(selfPid)) {
    targetPids.add(p.pid);
    if (p.pgid) pgids.add(p.pgid);
  }
  if (selfPgid) pgids.delete(selfPgid);

  if (pgids.size === 0) {
    log('  nothing to stop.');
  } else {
    for (const g of pgids) kill(`-${g}`, '-TERM'); // negative pgid => whole group
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && [...targetPids].some((pid) => isAlive(pid))) {
      // brief spin so graceful shutdown can complete before SIGKILL
    }
    for (const g of pgids) kill(`-${g}`, '-9'); // force any survivors
    const stillOurs = MANAGED_PORTS.filter(
      (p) => classifyHolders(holdersOnPort(p), REPO_ROOT).ours.length > 0,
    );
    const orphans = repoDevProcs(selfPid);
    log(`  stopped ${pgids.size} managed process group(s).`);
    if (stillOurs.length || orphans.length) {
      log(`  WARNING: still present — ports(ours): ${stillOurs.join(', ') || 'none'}; managed procs: ${orphans.length}`);
    } else {
      log('  all managed ports clear; no orphaned watchers.');
    }
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
