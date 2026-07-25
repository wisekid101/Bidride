import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  ThrottlerModule,
  ThrottlerGuard,
  Throttle,
  SkipThrottle,
} from '@nestjs/throttler';

/**
 * S0-B3A — HTTP-level proof that activating ThrottlerModule via a single global
 * APP_GUARD actually enforces rate limiting (returns HTTP 429), that per-route
 * @Throttle overrides are honored, that @SkipThrottle endpoints are never
 * throttled, and — critically — that the guard executes EXACTLY ONCE per request.
 *
 * The wiring here mirrors exactly what B3A applies to the real services:
 *   imports:   ThrottlerModule.forRoot([...])
 *   providers: { provide: APP_GUARD, useClass: ThrottlerGuard }
 *
 * `CorrectlyWiredController` = the B3A end state (global guard only).
 * `DoubleGuardedController`  = the pre-B3A conflict (global guard + a redundant
 *   controller-level ThrottlerGuard) — kept here to PROVE the double-count that
 *   B3A removes, so the "exactly once" guarantee is demonstrated, not asserted.
 */

const WINDOW_MS = 60_000;

// Module default limit = 5 (like the real per-service module defaults).
@Controller('t')
class CorrectlyWiredController {
  @Get('default')
  def() {
    return 'ok';
  }

  @Get('tight')
  @Throttle({ default: { limit: 2, ttl: WINDOW_MS } })
  tight() {
    return 'ok';
  }

  @Get('skip')
  @SkipThrottle()
  skip() {
    return 'ok';
  }
}

// Redundant controller-level ThrottlerGuard IN ADDITION to the global APP_GUARD.
@Controller('dup')
@UseGuards(ThrottlerGuard)
class DoubleGuardedController {
  @Get('tight')
  @Throttle({ default: { limit: 2, ttl: WINDOW_MS } })
  tight() {
    return 'ok';
  }
}

describe('S0-B3A — global ThrottlerGuard activation (HTTP 429 enforcement)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CorrectlyWiredController, DoubleGuardedController],
      imports: [
        ThrottlerModule.forRoot([{ name: 'default', ttl: WINDOW_MS, limit: 5 }]),
      ],
      // The exact B3A activation: one global guard execution per request.
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    const { port } = app.getHttpServer().address();
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const status = (path: string) => fetch(`${base}${path}`).then((r) => r.status);

  it('under the limit succeeds, then over the limit returns HTTP 429 (module default = 5)', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await status('/t/default')).toBe(200);
    }
    expect(await status('/t/default')).toBe(429);
  });

  it('honors a per-route @Throttle override AND proves exactly-once counting (limit = 2 ⇒ 2 pass, 3rd blocked)', async () => {
    // With a single guard execution, exactly `limit` requests pass before 429.
    // If the guard ran twice, only the 1st would pass (see double-guard test).
    expect(await status('/t/tight')).toBe(200); // hit 1
    expect(await status('/t/tight')).toBe(200); // hit 2 (still within limit=2)
    expect(await status('/t/tight')).toBe(429); // hit 3 → blocked
  });

  it('never throttles a @SkipThrottle endpoint, even far beyond the limit', async () => {
    for (let i = 0; i < 12; i++) {
      expect(await status('/t/skip')).toBe(200);
    }
  });

  it('REGRESSION GUARD: a redundant controller-level ThrottlerGuard double-counts (limit = 2 ⇒ only 1 passes)', async () => {
    // Demonstrates precisely why B3A removes the controller-level guard: the guard
    // runs twice, so each request consumes 2 of the budget → 2nd request is 429.
    expect(await status('/dup/tight')).toBe(200); // one request consumes 2 hits
    expect(await status('/dup/tight')).toBe(429); // second would be hit 3-4 → blocked
  });
});
