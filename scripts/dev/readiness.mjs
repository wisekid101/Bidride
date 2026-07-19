#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// BidiRide DEVELOPMENT-ONLY readiness check.
//
// Verifies the demo stack is healthy AND (once the driver is logged in + Online)
// that the driver socket heartbeat is live. Read-only: TCP port probes + Redis
// GETs; it changes nothing. No secrets printed.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { MANAGED_PORTS } from './stack-down.mjs';

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function portUp(port) {
  return Boolean(sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']));
}

function redis(args) {
  return sh('redis-cli', args);
}

console.log('Ports:');
const labels = {
  3000: 'admin portal', 3001: 'auth', 3002: 'trip', 3003: 'driver', 3004: 'rider',
  3005: 'pricing', 3006: 'safety', 3007: 'payment', 3008: 'notification', 3009: 'trust', 3010: 'airport',
  3011: 'admin-service', 3012: 'ai-service', 8080: 'dev-proxy', 8081: 'metro-rider', 8082: 'metro-driver',
};
for (const p of MANAGED_PORTS) console.log(`  ${portUp(p) ? '✓' : '✗'} :${p} ${labels[p] || ''}`);

console.log('\nInfra (must stay up, not managed by this harness):');
console.log(`  ${portUp(5432) ? '✓' : '✗'} :5432 postgres`);
console.log(`  ${portUp(6379) ? '✓' : '✗'} :6379 redis`);

console.log('\nDriver presence / heartbeat (exists only after a driver goes Online):');
const keys = redis(['--scan', '--pattern', 'driver:*:location']).split('\n').filter(Boolean);
if (keys.length === 0) {
  console.log('  (none) — no driver is currently Online, or heartbeat not yet emitted.');
} else {
  for (const k of keys) {
    const ttl = redis(['ttl', k]);
    console.log(`  ✓ ${k}  ttl=${ttl}s`);
  }
}
const geo = redis(['zcard', 'drivers:geo']);
console.log(`  drivers:geo members: ${geo || '0'}`);
