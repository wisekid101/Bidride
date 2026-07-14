// Tests for the harness's process-selection logic. Run: node --test scripts/dev
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHolders, isRepoCwd, PROTECTED_PORTS } from '../../lib/proc.mjs';

const REPO = '/Users/someone/bidride';

test('classifyHolders keeps only repo-cwd processes as ours', () => {
  const holders = [
    { pid: '101', cwd: `${REPO}/services/trip-service` },
    { pid: '102', cwd: '/Applications/SomeOtherApp' },
    { pid: '103', cwd: `${REPO}/apps/admin` },
    { pid: '104', cwd: '' }, // unknown cwd → treated as foreign (never killed)
  ];
  const { ours, foreign } = classifyHolders(holders, REPO);
  assert.deepEqual(ours.map((h) => h.pid), ['101', '103']);
  assert.deepEqual(foreign.map((h) => h.pid), ['102', '104']);
});

test('a foreign process sharing a port is never classified as ours', () => {
  const { ours, foreign } = classifyHolders(
    [{ pid: '200', cwd: '/opt/homebrew/var/postgres' }],
    REPO,
  );
  assert.equal(ours.length, 0);
  assert.equal(foreign.length, 1);
});

test('isRepoCwd rejects empty/undefined/foreign cwds', () => {
  assert.equal(isRepoCwd(`${REPO}/x`, REPO), true);
  assert.equal(isRepoCwd('/other', REPO), false);
  assert.equal(isRepoCwd('', REPO), false);
  assert.equal(isRepoCwd(undefined, REPO), false);
});

test('Postgres and Redis ports are protected (never managed)', () => {
  assert.equal(PROTECTED_PORTS.has(5432), true);
  assert.equal(PROTECTED_PORTS.has(6379), true);
});
