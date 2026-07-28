/**
 * E2E service lifecycle — starts the principal services as real OS processes on
 * test-only ports, waits for readiness, and guarantees teardown.
 *
 * Process selection and port-holder classification reuse the repository's
 * existing dev harness primitives (scripts/lib/proc.mjs) rather than
 * duplicating them: PROTECTED_PORTS keeps infrastructure ports untouchable and
 * classifyHolders distinguishes a repo-owned process from a foreign one, so a
 * port collision is reported instead of something else being killed.
 */
import { spawn, ChildProcess, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { openSync, closeSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO_ROOT = resolve(__dirname, '../../../..');
const LOG_DIR = join(REPO_ROOT, '.dev-artifacts', 'e2e-logs');
const VENDOR_PRELOAD = join(__dirname, 'vendor-boundary.cjs');

/** Test-only ports: dev port + 900, deliberately outside the dev harness's MANAGED_PORTS. */
export const E2E_PORTS = { pricing: 3905, payment: 3907, trip: 3902 } as const;

/** Never touched, mirroring scripts/lib/proc.mjs. */
const PROTECTED_PORTS = new Set([5432, 6379]);

/** A loopback port nothing listens on — services outside the scenario resolve here. */
export const DEAD_PORT = 3999;

export const E2E_JWT_SECRET = 'e2e-standard-ride-jwt-secret';

export interface ServiceHandle {
  name: string;
  port: number;
  child: ChildProcess;
  logPath: string;
}

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function listenerPids(port: number): string[] {
  const out = sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  return out ? out.split('\n').filter(Boolean) : [];
}

function cwdOf(pid: string): string {
  const out = sh('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn']);
  const line = out.split('\n').find((l) => l.startsWith('n'));
  return line ? line.slice(1) : '';
}

/**
 * Refuse to run if a test port is occupied. A repo-owned holder is reported
 * distinctly from a foreign one — neither is killed, because silently taking a
 * port from a developer's running stack is worse than failing.
 */
export function assertPortsFree(): void {
  const collisions: string[] = [];
  for (const [name, port] of Object.entries(E2E_PORTS)) {
    if (PROTECTED_PORTS.has(port)) throw new Error(`refusing to manage protected port ${port}`);
    for (const pid of listenerPids(port)) {
      const cwd = cwdOf(pid);
      const owner = cwd && cwd.startsWith(REPO_ROOT) ? 'this repo' : 'a foreign process';
      collisions.push(`  :${port} (${name}) held by pid ${pid} — ${owner}${cwd ? ` at ${cwd}` : ''}`);
    }
  }
  if (collisions.length) {
    throw new Error(
      `\n  E2E test ports are not free:\n${collisions.join('\n')}\n` +
        '  Stop whatever holds them and re-run. The harness never kills a process it did not start.\n',
    );
  }
}

async function portOpen(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((res) => {
    const sock = createConnection({ host: '127.0.0.1', port });
    const done = (ok: boolean) => {
      sock.destroy();
      res(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** Poll /health until the service answers, or fail with its log tail attached. */
async function waitForReady(h: ServiceHandle, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (h.child.exitCode !== null) {
      throw new Error(
        `${h.name} exited with code ${h.child.exitCode} before becoming ready.\n${tailLog(h)}`,
      );
    }
    if (await portOpen(h.port)) {
      try {
        const r = await fetch(`http://127.0.0.1:${h.port}/health`);
        if (r.ok) return;
      } catch {
        /* not up yet */
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`${h.name} did not become ready on :${h.port} within ${timeoutMs}ms.\n${tailLog(h)}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export function tailLog(h: ServiceHandle, lines = 40): string {
  if (!existsSync(h.logPath)) return `  (no log at ${h.logPath})`;
  const text = readFileSync(h.logPath, 'utf8').split('\n');
  return `  ── ${h.name} log tail ──\n` + text.slice(-lines).map((l) => `  ${l}`).join('\n');
}

/**
 * Environment shared by every spawned service.
 *
 * NODE_ENV is deliberately NOT 'development' or 'test': those two values make
 * the internal-key guard fail open. Using 'e2e' forces the guard closed so the
 * cross-service call must present a real credential.
 */
function baseEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'e2e',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    REDIS_URL: process.env.TEST_REDIS_URL,
    JWT_SECRET: E2E_JWT_SECRET,
    INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY,
    // Sever every vendor boundary inside the child process.
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${VENDOR_PRELOAD}`.trim(),
    E2E_STRIPE_PREFIX: 'e2e_test',
    // Services outside this scenario resolve to a closed loopback port, so
    // their fire-and-forget calls fail fast and deterministically.
    AI_SERVICE_URL: `http://127.0.0.1:${DEAD_PORT}`,
    TRUST_SERVICE_URL: `http://127.0.0.1:${DEAD_PORT}`,
    SAFETY_SERVICE_URL: `http://127.0.0.1:${DEAD_PORT}`,
    NOTIFICATION_SERVICE_URL: `http://127.0.0.1:${DEAD_PORT}`,
  };
}

function startOne(name: string, dir: string, port: number, extra: NodeJS.ProcessEnv): ServiceHandle {
  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = join(LOG_DIR, `${name}.log`);
  rmSync(logPath, { force: true });
  const fd = openSync(logPath, 'a');

  const child = spawn('node', ['dist/main'], {
    cwd: join(REPO_ROOT, 'services', dir),
    env: { ...baseEnv(), ...extra, PORT: String(port) },
    detached: true, // own process group, so teardown can kill the whole tree
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  child.unref();

  return { name, port, child, logPath };
}

/** Build (turbo-cached) then boot the three principal services. */
export async function startPrincipalServices(): Promise<ServiceHandle[]> {
  assertPortsFree();

  execFileSync(
    'pnpm',
    [
      'turbo', 'run', 'build',
      '--filter=@bidride/pricing-service',
      '--filter=@bidride/payment-service',
      '--filter=@bidride/trip-service',
    ],
    { cwd: REPO_ROOT, stdio: 'ignore' },
  );

  const handles = [
    startOne('pricing-service', 'pricing-service', E2E_PORTS.pricing, {}),
    startOne('payment-service', 'payment-service', E2E_PORTS.payment, {
      STRIPE_SECRET_KEY: 'sk_test_e2e_never_used_against_real_stripe',
    }),
    startOne('trip-service', 'trip-service', E2E_PORTS.trip, {
      PRICING_SERVICE_URL: `http://127.0.0.1:${E2E_PORTS.pricing}`,
      PAYMENT_SERVICE_URL: `http://127.0.0.1:${E2E_PORTS.payment}`,
    }),
  ];

  try {
    for (const h of handles) await waitForReady(h);
  } catch (err) {
    await stopServices(handles);
    throw err;
  }
  return handles;
}

/** Kill each service's whole process group, then verify the ports are released. */
export async function stopServices(handles: ServiceHandle[]): Promise<void> {
  for (const h of handles) {
    if (h.child.pid == null) continue;
    for (const sig of ['-TERM', '-KILL'] as const) {
      try {
        process.kill(-h.child.pid, sig === '-TERM' ? 'SIGTERM' : 'SIGKILL');
      } catch {
        /* already gone */
      }
      if (sig === '-TERM') await new Promise((r) => setTimeout(r, 300));
      if (h.child.exitCode !== null || h.child.signalCode !== null) break;
    }
  }

  const deadline = Date.now() + 10_000;
  for (;;) {
    const stillHeld = Object.values(E2E_PORTS).filter((p) => listenerPids(p).length > 0);
    if (stillHeld.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(`E2E ports still held after teardown: ${stillHeld.join(', ')}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** True when every E2E port is free — used by the cleanup assertions. */
export function portsAllFree(): boolean {
  return Object.values(E2E_PORTS).every((p) => listenerPids(p).length === 0);
}
