// Tests for the post-demo readiness check's pure logic. Run: node --test scripts/dev
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expoPidFromLaunchctl,
  isPidConnected,
  hasActiveTrip,
  summaryLines,
  ACTIVE_TRIP_STATES,
} from '../post-demo.mjs';

test('expoPidFromLaunchctl extracts the host PID of a running Expo Go', () => {
  const out = [
    'PID\tStatus\tLabel',
    '78595\t0\tUIKitApplication:host.exp.Exponent[8112][rb-legacy]',
    '123\t0\tcom.apple.something',
  ].join('\n');
  assert.equal(expoPidFromLaunchctl(out), '78595');
});

test('expoPidFromLaunchctl returns null when Expo Go is installed but not running', () => {
  // launchctl shows a not-running service with a '-' PID.
  const out = '-\t0\tUIKitApplication:host.exp.Exponent[0][rb-legacy]';
  assert.equal(expoPidFromLaunchctl(out), null);
});

test('expoPidFromLaunchctl returns null when Expo Go is absent / empty output', () => {
  assert.equal(expoPidFromLaunchctl('123\t0\tcom.apple.other'), null);
  assert.equal(expoPidFromLaunchctl(''), null);
  assert.equal(expoPidFromLaunchctl(undefined), null);
});

test('isPidConnected requires the pid to hold an established connection', () => {
  assert.equal(isPidConnected(['78595', '87758'], '78595'), true);
  assert.equal(isPidConnected(['78595', '87758'], 87758), true); // numeric pid tolerated
  assert.equal(isPidConnected(['78595'], '99999'), false);
  assert.equal(isPidConnected([], '78595'), false);
  assert.equal(isPidConnected(['78595'], null), false); // not running → never "connected"
});

test('hasActiveTrip is true only for in-flight states', () => {
  assert.equal(hasActiveTrip(['completed', 'cancelled']), false);
  assert.equal(hasActiveTrip([]), false);
  for (const s of ACTIVE_TRIP_STATES) {
    assert.equal(hasActiveTrip(['completed', s]), true, `${s} should count as active`);
  }
  assert.equal(hasActiveTrip([' in_progress ']), true); // trimmed
});

test('summaryLines reports readiness only when running AND connected', () => {
  const ready = summaryLines({
    rider: { running: true, connected: true },
    driver: { running: true, connected: true },
    activeTrip: false,
  });
  assert.match(ready[0], /Rider app: foregrounded and connected/);
  assert.match(ready[1], /Driver app: foregrounded and connected/);
  assert.match(ready[2], /Active trip: none/);
  assert.match(ready[3], /Stack: healthy/);

  const degraded = summaryLines({
    rider: { running: true, connected: false },
    driver: { running: false, connected: false },
    activeTrip: true,
  });
  assert.match(degraded[0], /Rider app: NOT READY/);
  assert.match(degraded[1], /Driver app: NOT READY/);
  assert.match(degraded[2], /Active trip: PRESENT/);
  assert.match(degraded[3], /Stack: degraded/);
});
