#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// BidiRide DEVELOPMENT-ONLY iOS Simulator GPS harness
//
// Drives simulated CoreLocation on the rider/driver simulators via the official
// `xcrun simctl location` interface. Development/acceptance use only. It contains
// NO production logic and does NOT modify any ride, payment, pricing, dispatch,
// safety, or GPS business rule — it only feeds the OS location the driver app's
// existing expo-location watch already consumes.
//
// Trip coordinates are read from the dev DB with a read-only SELECT. Simulators
// are resolved portably (env DRIVER_UDID/RIDER_UDID or auto-detected booted
// devices). No secrets are printed.
//
// NOTE: `simctl location start` interpolates a STRAIGHT LINE between waypoints —
// it does NOT represent real road routing. That is acceptable for this harness.
//
// Commands:
//   newark                         both sims → downtown Newark
//   pickup          --trip <id>    driver sim → trip pickup
//   drive           --trip <id>    interpolate driver pickup→dropoff (visible movement)
//   dropoff         --trip <id>    driver sim → exact dropoff (End Trip radius)
//   await-at-dropoff --trip <id>   BLOCK until the backend-ingested driver location
//                                  is within the completion radius (Fix 6 readiness gate)
//   coords          --trip <id>    print resolved coordinates
//   clear                          stop simulation on both sims
//
// Options: --driver <udid> --rider <udid> --pickup lat,lng --dropoff lat,lng
//          --speed <m/s> --interval <s> --radius <miles> --timeout <s>
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { databaseUrl, resolveSimulators } from '../lib/env.mjs';

const NEWARK = { lat: 40.7357, lng: -74.1724 };
const DROPOFF_RADIUS_MILES = 0.2; // mirrors server DROPOFF_LOCK_RADIUS_MILES (enforcement stays server-side)

function parseArgs(argv) {
  const [, , command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[(i += 1)] : 'true';
      opts[key] = val;
    }
  }
  return { command, opts };
}

function parseLatLng(s) {
  const [lat, lng] = String(s).split(',').map((n) => Number(n.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`bad coordinate: ${s}`);
  return { lat, lng };
}

function psql(sql) {
  return execFileSync('psql', [databaseUrl(), '-A', '-t', '-F', ',', '-c', sql], { encoding: 'utf8' }).trim();
}

function tripCoords(tripId) {
  const id = tripId.replace(/'/g, '');
  const out = psql(
    `select pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status from trips where id = '${id}'`,
  );
  if (!out) throw new Error(`trip not found: ${tripId}`);
  const [pLat, pLng, dLat, dLng, status] = out.split(',');
  return {
    pickup: { lat: Number(pLat), lng: Number(pLng) },
    dropoff: { lat: Number(dLat), lng: Number(dLng) },
    status,
  };
}

function driverUserId(tripId) {
  const id = tripId.replace(/'/g, '');
  const out = psql(`select d.user_id from trips t join drivers d on d.id = t.driver_id where t.id = '${id}'`);
  if (!out) throw new Error(`no assigned driver for trip ${tripId}`);
  return out.trim();
}

function resolveCoords(opts) {
  if (opts.pickup || opts.dropoff) {
    return {
      pickup: opts.pickup ? parseLatLng(opts.pickup) : null,
      dropoff: opts.dropoff ? parseLatLng(opts.dropoff) : null,
      status: 'override',
    };
  }
  if (!opts.trip) throw new Error('provide --trip <id> (or --pickup/--dropoff overrides)');
  return tripCoords(opts.trip);
}

function simctl(args) {
  return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });
}

function setLocation(udid, { lat, lng }, label) {
  simctl(['location', udid, 'set', `${lat},${lng}`]);
  console.log(`  set ${label} (${udid.slice(0, 8)}…) → ${lat},${lng}`);
}

function driveLocation(udid, from, to, speed, interval, label) {
  simctl(['location', udid, 'start', `--speed=${speed}`, `--interval=${interval}`, `${from.lat},${from.lng}`, `${to.lat},${to.lng}`]);
  console.log(`  drive ${label} (${udid.slice(0, 8)}…): ${from.lat},${from.lng} → ${to.lat},${to.lng} @ ${speed} m/s (straight line — not road routing)`);
}

function clearLocation(udid, label) {
  try {
    simctl(['location', udid, 'clear']);
    console.log(`  cleared ${label} (${udid.slice(0, 8)}…)`);
  } catch {
    /* no scenario running */
  }
}

function milesBetween(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fix 6 readiness gate. Polls the AUTHORITATIVE dev observation — the driver
 * location the backend actually ingested over the socket, cached in Redis at
 * `driver:{userId}:location` — until it is within the completion radius of the
 * trip's dropoff. Returns only when confirmed; throws on timeout. It NEVER calls
 * the End endpoint; the server's 0.2-mile enforcement is unchanged.
 */
async function awaitAtDropoff(tripId, radiusMiles, timeoutSec) {
  const { dropoff } = tripCoords(tripId);
  const userId = driverUserId(tripId);
  const key = `driver:${userId}:location`;
  const deadline = Date.now() + timeoutSec * 1000;
  let last = null;
  while (Date.now() < deadline) {
    const raw = execFileSync('redis-cli', ['get', key], { encoding: 'utf8' }).trim();
    if (raw) {
      try {
        const fix = JSON.parse(raw);
        const dist = milesBetween({ lat: fix.lat, lng: fix.lng }, dropoff);
        last = dist;
        if (dist <= radiusMiles) {
          console.log(`  ✓ backend-ingested driver location is ${dist.toFixed(3)} mi from dropoff (≤ ${radiusMiles}) — safe to End`);
          return;
        }
      } catch {
        /* malformed fix — keep polling */
      }
    }
    await sleep(1000);
  }
  throw new Error(
    `driver location did not reach the completion radius within ${timeoutSec}s ` +
    `(last observed ${last == null ? 'no fix' : last.toFixed(3) + ' mi'} from dropoff). ` +
    `Ensure the driver sim GPS is at the dropoff and the app is foregrounded.`,
  );
}

async function main() {
  const { command, opts } = parseArgs(process.argv);
  let driver = opts.driver;
  let rider = opts.rider;
  if (!driver || !rider) {
    // Only auto-resolve when a sim is actually needed (not for coords/await).
    if (['newark', 'pickup', 'drive', 'dropoff', 'clear'].includes(command)) {
      const sims = resolveSimulators();
      driver = driver || sims.driver;
      rider = rider || sims.rider;
    }
  }
  const speed = Number(opts.speed || 13);
  const interval = Number(opts.interval || 1);
  const radius = Number(opts.radius || DROPOFF_RADIUS_MILES);
  const timeout = Number(opts.timeout || 30);

  switch (command) {
    case 'newark':
      console.log('Setting both simulators to downtown Newark:');
      setLocation(rider, NEWARK, 'rider');
      setLocation(driver, NEWARK, 'driver');
      break;
    case 'coords': {
      const c = resolveCoords(opts);
      console.log(JSON.stringify({ ...c, dropoffMilesFromPickup: c.pickup && c.dropoff ? Number(milesBetween(c.pickup, c.dropoff).toFixed(3)) : null }, null, 2));
      break;
    }
    case 'pickup': {
      const c = resolveCoords(opts);
      if (!c.pickup) throw new Error('no pickup coordinate resolved');
      console.log('Placing driver simulator at trip pickup:');
      setLocation(driver, c.pickup, 'driver');
      break;
    }
    case 'drive': {
      const c = resolveCoords(opts);
      if (!c.pickup || !c.dropoff) throw new Error('need both pickup and dropoff');
      console.log('Interpolating driver simulator pickup → dropoff:');
      driveLocation(driver, c.pickup, c.dropoff, speed, interval, 'driver');
      console.log(`  (settles at dropoff; ${milesBetween(c.pickup, c.dropoff).toFixed(2)} mi straight-line)`);
      break;
    }
    case 'dropoff': {
      const c = resolveCoords(opts);
      if (!c.dropoff) throw new Error('no dropoff coordinate resolved');
      console.log('Placing driver simulator exactly at dropoff (End Trip radius ≤ 0.2 mi):');
      clearLocation(driver, 'driver');
      setLocation(driver, c.dropoff, 'driver');
      break;
    }
    case 'await-at-dropoff': {
      if (!opts.trip) throw new Error('provide --trip <id>');
      console.log(`Waiting until the backend-ingested driver location is within ${radius} mi of the dropoff (timeout ${timeout}s)…`);
      await awaitAtDropoff(opts.trip, radius, timeout);
      break;
    }
    case 'clear':
      console.log('Clearing simulated location on both simulators:');
      clearLocation(rider, 'rider');
      clearLocation(driver, 'driver');
      break;
    default:
      console.error('Usage: node scripts/sim/gps-harness.mjs <newark|pickup|drive|dropoff|await-at-dropoff|coords|clear> [--trip <id>] [--driver <udid>] [--rider <udid>] [--pickup lat,lng] [--dropoff lat,lng] [--speed <m/s>] [--interval <s>] [--radius <mi>] [--timeout <s>]');
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(`gps-harness error: ${e.message}`);
  process.exit(1);
});
