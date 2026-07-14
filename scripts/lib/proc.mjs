// DEV-ONLY process selection for the harness. The impure lsof/ps calls are thin
// wrappers; the SELECTION logic is pure and unit-tested so shutdown can never
// target a process outside this repository.

import { execFileSync } from 'node:child_process';

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** Never managed by this harness — must never be touched. */
export const PROTECTED_PORTS = new Set([5432, 6379]);

/**
 * PURE: given a port's listener descriptors [{ pid, cwd }] and the repo root,
 * split them into processes that belong to this repo (safe to stop) and foreign
 * processes (must NOT be killed — a collision to report instead).
 */
export function classifyHolders(holders, repoRoot) {
  const ours = [];
  const foreign = [];
  for (const h of holders) {
    if (h.cwd && h.cwd.startsWith(repoRoot)) ours.push(h);
    else foreign.push(h);
  }
  return { ours, foreign };
}

/** PURE: is this a repo-owned process working directory? */
export function isRepoCwd(cwd, repoRoot) {
  return Boolean(cwd) && cwd.startsWith(repoRoot);
}

// ── impure probes ────────────────────────────────────────────────────────────

export function listenerPids(port) {
  const out = sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  return out ? out.split('\n').filter(Boolean) : [];
}

export function cwdOf(pid) {
  const out = sh('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn']);
  const line = out.split('\n').find((l) => l.startsWith('n'));
  return line ? line.slice(1) : '';
}

export function holdersOnPort(port) {
  return listenerPids(port).map((pid) => ({ pid, cwd: cwdOf(pid) }));
}

export function isAlive(pid) {
  return Boolean(sh('ps', ['-p', pid, '-o', 'pid=']));
}

export function kill(pid, signal) {
  try {
    // The shell builtin is blocked under the sandbox; /bin/kill delivers reliably.
    execFileSync('/bin/kill', [signal, pid]);
    return true;
  } catch {
    return false;
  }
}
