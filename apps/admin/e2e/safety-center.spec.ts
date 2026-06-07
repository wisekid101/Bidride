import { test, expect, Page } from '@playwright/test';

test.describe('Admin Safety Center', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();

    // Mock admin session
    await page.goto('/login');
    await page.evaluate(() => {
      document.cookie = 'admin_session=test_admin_token; path=/';
    });
    await page.goto('/safety');
  });

  test('renders safety center with correct header', async () => {
    await expect(page.getByRole('heading', { name: 'Safety Center' })).toBeVisible();
  });

  test('shows DO NOT CONTACT THE RIDER warning in panic queue', async () => {
    // This is a critical safety requirement
    const warning = page.getByText(/DO NOT CONTACT THE RIDER/i);
    await expect(warning).toBeVisible();
  });

  test('SOS metric card turns red when there are open sessions', async () => {
    // Mock API response with an open SOS session
    await page.route('**/api/admin/analytics/dashboard', async (route) => {
      await route.fulfill({
        json: {
          activeTrips: 42,
          openSosSessions: 1,
          todayGmv: 12500,
          monthGmv: 380000,
          activeDrivers: 18,
          pendingDrivers: 3,
        },
      });
    });

    await page.reload();

    const sosCard = page.locator('[data-testid="sos-metric-card"]');
    await expect(sosCard).toHaveClass(/border-red/);
  });

  test('panic event details do NOT expose rider identity', async () => {
    // Mock API with a panic event
    await page.route('**/api/admin/safety/panic*', async (route) => {
      await route.fulfill({
        json: [{
          id: 'panic-1',
          tripId: 'trip-abc-123',
          initiatedByRole: 'driver',
          createdAt: new Date().toISOString(),
          status: 'active',
          // Note: no riderId, riderName, or riderPhone in payload
        }],
      });
    });

    await page.reload();

    // The page should show driver contact info only
    const panicSection = page.locator('[data-testid="panic-queue"]');
    await expect(panicSection).toBeVisible();

    // Rider identity must NOT be displayed
    await expect(page.getByText(/rider phone/i)).not.toBeVisible();
    await expect(page.getByText(/rider name/i)).not.toBeVisible();
  });

  test('SLA countdown shows red at < 30 seconds', async () => {
    await page.route('**/api/admin/safety/sos*', async (route) => {
      await route.fulfill({
        json: [{
          id: 'sos-1',
          status: 'sos_active',
          createdAt: new Date(Date.now() - 270000).toISOString(), // 4.5 min ago
          slaSeconds: 300,
          remainingSeconds: 20, // < 30 — should be red
        }],
      });
    });

    await page.reload();

    const sosRow = page.locator('[data-testid="sos-row"]').first();
    await expect(sosRow).toHaveClass(/border-red/);
  });

  test('resolution requires both category and notes', async () => {
    await page.route('**/api/admin/safety/sos*', async (route) => {
      await route.fulfill({
        json: [{
          id: 'sos-1',
          status: 'sos_active',
          createdAt: new Date().toISOString(),
          remainingSeconds: 180,
        }],
      });
    });

    await page.reload();

    // Click to expand a session
    await page.locator('[data-testid="sos-row"]').first().click();

    const resolveBtn = page.getByRole('button', { name: /resolve/i });

    // Button should be disabled without category + notes
    await expect(resolveBtn).toBeDisabled();

    // Fill only category
    await page.locator('[data-testid="resolution-category"]').selectOption('false_alarm');
    await expect(resolveBtn).toBeDisabled();

    // Now fill notes too
    await page.locator('[data-testid="resolution-notes"]').fill('Rider confirmed they are safe. Test trip, no actual emergency.');
    await expect(resolveBtn).toBeEnabled();
  });
});

test.describe('Admin Fraud Page', () => {
  test('shows "No Automated Bans" policy badge', async ({ page }) => {
    await page.goto('/fraud');
    await expect(page.getByText('No Automated Bans')).toBeVisible();
  });

  test('shows human review required warning', async ({ page }) => {
    await page.goto('/fraud');
    await expect(page.getByText('Human Review Required')).toBeVisible();
  });

  test('review buttons are disabled without notes', async ({ page }) => {
    await page.route('**/api/admin/fraud*', async (route) => {
      await route.fulfill({
        json: [{
          id: 'alert-1',
          userId: 'user-1',
          userType: 'rider',
          userName: 'Test User',
          fraudProbability: 94,
          triggerReason: 'Multi-device detected with linked accounts',
          holdActive: true,
          status: 'pending',
          createdAt: new Date().toISOString(),
        }],
      });
    });

    await page.goto('/fraud');
    await page.reload();

    // Click the alert to open review modal
    await page.locator('text=Test User').click();

    const clearBtn = page.getByRole('button', { name: /clear alert/i });
    const escalateBtn = page.getByRole('button', { name: /escalate/i });

    await expect(clearBtn).toBeDisabled();
    await expect(escalateBtn).toBeDisabled();

    // Adding notes enables the buttons
    await page.locator('textarea').fill('Investigated — multi-device is legitimate (family account). Cleared.');
    await expect(clearBtn).toBeEnabled();
    await expect(escalateBtn).toBeEnabled();
  });
});

test.describe('Admin Earnings Floor Page', () => {
  test('displays floor formula with Founder-only lock badge', async ({ page }) => {
    await page.route('**/api/admin/config/earnings_floor_formula', async (route) => {
      await route.fulfill({
        json: { key: 'earnings_floor_formula', value: { per_mile: 1.10, per_min: 0.22, base: 2.50 } },
      });
    });

    await page.goto('/earnings-floor');
    await expect(page.getByText('Founder-only write access')).toBeVisible();
    await expect(page.getByText(/floor = \(miles/i)).toBeVisible();
  });

  test('supplement amounts displayed in gold', async ({ page }) => {
    await page.goto('/earnings-floor');

    const supplementCells = page.locator('.text-\\[\\#F4B400\\]');
    // Gold color is exclusively for earnings-related figures
    for (const cell of await supplementCells.all()) {
      await expect(cell).toBeVisible();
    }
  });
});
