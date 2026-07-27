#!/usr/bin/env node
/**
 * BidRide — one-command local setup (Phase P1).  `pnpm dev:setup`
 *
 * NOT `pnpm setup`: pnpm >= 9 has a built-in `setup` command (configures
 * PNPM_HOME in your shell rc) that shadows a package.json script of that name.
 *
 * Idempotent: copies .env.example -> .env (if absent), starts the local
 * dependency stack, waits for Postgres/Redis to be healthy, then runs Prisma
 * migrate + seed. Touches nothing outside the local machine.
 */
import { execSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const COMPOSE = 'docker compose -f docker-compose.dev.yml';
const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });
const step = (m) => console.log(`\n\x1b[36m▶ ${m}\x1b[0m`);

// Reads one key out of the root .env. Prisma loads the .env nearest its schema
// (packages/database/.env), which on an older machine can still point at a
// pre-Docker local Postgres. Passing the value explicitly in the child env wins:
// dotenv never overwrites a variable that is already set.
function rootEnv(key) {
  const line = readFileSync(resolve(root, '.env'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
}

function ensureDocker() {
  try { execSync('docker info', { stdio: 'ignore' }); }
  catch { console.error('\x1b[31m✗ Docker is not running. Start Docker Desktop and retry.\x1b[0m'); process.exit(1); }
}

function ensureEnv() {
  const env = resolve(root, '.env');
  if (existsSync(env)) { console.log('  .env already exists — leaving it untouched'); return; }
  copyFileSync(resolve(root, '.env.example'), env);
  console.log('  created .env from .env.example');
}

function waitForPostgres() {
  for (let i = 1; i <= 30; i++) {
    try {
      execSync(`${COMPOSE} exec -T postgres pg_isready -U bidride -d bidride`, { cwd: root, stdio: 'ignore' });
      console.log('  postgres ready'); return;
    } catch { process.stdout.write(`  waiting for postgres (${i}/30)\r`); execSync('sleep 2'); }
  }
  console.error('\x1b[31m✗ postgres did not become ready\x1b[0m'); process.exit(1);
}

console.log('\x1b[1mBidRide local setup\x1b[0m');
ensureDocker();
step('Preparing .env'); ensureEnv();
step('Starting local stack (postgres, redis, minio, localstack, mailhog)'); run(`${COMPOSE} up -d`);
step('Waiting for Postgres'); waitForPostgres();
const dbEnv = { ...process.env, DATABASE_URL: rootEnv('DATABASE_URL') };
step('Running database migrations'); run('pnpm db:migrate', { env: dbEnv });
step('Seeding database'); run('pnpm db:seed', { env: dbEnv });

console.log(`
\x1b[32m✓ Local platform ready.\x1b[0m

  Start the backend:   pnpm dev:backend
  Start everything:    pnpm dev
  Prisma Studio:       pnpm db:studio
  MinIO console:       http://localhost:9001   (bidride_dev / bidride_dev_secret)
  MailHog (OTP/email): http://localhost:8025
  Stop the stack:      docker compose -f docker-compose.dev.yml down
`);
