#!/usr/bin/env node
// DEV-ONLY: log in to the Founder/Admin portal and screenshot the Intelligence
// pages (recommendation inbox + evidence) for acceptance evidence. Read-only.
//
// Portable: resolves the repo root dynamically, imports Playwright via the admin
// app's own dependency, reads the Founder password from .env.founder.local at the
// repo root (gitignored), and writes screenshots to the gitignored artifacts dir.
// The password is never printed.
//
// Usage: node scripts/sim/portal-capture.mjs [--base http://localhost:3000]

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { REPO_ROOT, artifactsDir, founderPassword } from '../lib/env.mjs';

// Use the admin workspace's own Playwright dependency (no absolute vendor path).
const require = createRequire(resolve(REPO_ROOT, 'apps/admin/package.json'));
const { chromium } = require('@playwright/test');

const baseArgIdx = process.argv.indexOf('--base');
const BASE = baseArgIdx > -1 ? process.argv[baseArgIdx + 1] : 'http://localhost:3000';
const OUT = artifactsDir();
const PW = founderPassword();

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
try {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', 'marq@bidride.com');
  await page.fill('input[type="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  console.log('portal login ok');

  await page.goto(`${BASE}/intelligence`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/portal-intelligence.png`, fullPage: true });
  console.log('intelligence overview captured');

  await page.goto(`${BASE}/intelligence/inbox`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/portal-inbox.png`, fullPage: true });
  console.log(`recommendation inbox captured → ${OUT}`);
} finally {
  await browser.close();
}
console.log('DONE');
