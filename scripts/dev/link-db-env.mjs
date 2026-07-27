#!/usr/bin/env node
/**
 * BidRide — link packages/database/.env -> ../../.env  (Phase P1).
 * Runs automatically from the root `postinstall`, so a clean clone behaves
 * like an established machine with no manual steps.
 *
 * WHY THIS EXISTS
 * The Prisma CLI loads the `.env` nearest the schema — it searches
 * packages/database/ and packages/database/prisma/, but does NOT walk up to
 * the monorepo root. So `prisma migrate status` run from that package finds no
 * DATABASE_URL and fails schema validation, even though the root .env defines
 * it. Copying the value into a second file would fix that but re-creates the
 * drift this replaced (a stale package .env once pointed Prisma at a
 * pre-Docker Homebrew database). A symlink keeps exactly ONE definition of
 * DATABASE_URL — the root .env — while putting it where Prisma looks.
 *
 * Notes:
 *  - .env stays gitignored. Nothing here commits or reads secret values.
 *  - A real environment variable always beats the .env file (dotenv never
 *    overwrites an already-set var), so CI — which exports DATABASE_URL
 *    directly — is unaffected either way.
 *  - Never fails the install: every problem is a warning and exit 0.
 */
import { existsSync, lstatSync, readlinkSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const linkPath = resolve(root, 'packages/database/.env');
const TARGET = '../../.env'; // relative → survives clone to any path

const warn = (m) => console.warn(`\x1b[33m[link-db-env] ${m}\x1b[0m`);

try {
  if (existsSync(resolve(root, 'packages/database')) === false) {
    // Nothing to link against (e.g. partial checkout) — silently skip.
    process.exit(0);
  }

  const stat = (() => {
    try { return lstatSync(linkPath); } catch { return null; }
  })();

  if (stat?.isSymbolicLink()) {
    const current = readlinkSync(linkPath);
    if (current === TARGET) process.exit(0); // already correct — silent no-op
    warn(`packages/database/.env points at "${current}", expected "${TARGET}". Leaving it alone.`);
    process.exit(0);
  }

  if (stat?.isFile()) {
    // A real file here is the drift case. It may hold a developer's own
    // values, so we never delete it — we tell them what to do instead.
    warn('packages/database/.env is a regular file, not a link to the root .env.');
    warn('This can point Prisma at the wrong database. To adopt the shared setup:');
    warn('  rm packages/database/.env && pnpm install');
    process.exit(0);
  }

  symlinkSync(TARGET, linkPath);
  console.log('[link-db-env] linked packages/database/.env -> ../../.env');

  if (!existsSync(resolve(root, '.env'))) {
    warn('root .env does not exist yet — run `pnpm dev:setup` to create it.');
  }
} catch (err) {
  // Windows without developer mode cannot create symlinks. Degrade loudly.
  warn(`could not create the link (${err.code ?? err.message}).`);
  warn('Set DATABASE_URL in your environment, or run Prisma from the repo root.');
}

process.exit(0);
