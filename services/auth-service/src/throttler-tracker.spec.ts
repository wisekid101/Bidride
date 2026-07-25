import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule, ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { throttlerClientIp } from './throttler-tracker';

/**
 * S0-B3B1 — proves the throttling client-IP resolver:
 *  (a) extracts the ALB-appended (rightmost) X-Forwarded-For entry,
 *  (b) ignores spoofable left-side entries,
 *  (c) falls back to req.ip when there is no forwarding header,
 *  (d) affects ONLY the throttle bucket — req.ip is left unchanged, so audit
 *      logging and driver zero-tolerance compliance IP recording are unaffected.
 */

describe('throttlerClientIp (unit)', () => {
  it('takes the rightmost X-Forwarded-For entry (the ALB-appended real client)', () => {
    expect(
      throttlerClientIp({ headers: { 'x-forwarded-for': '203.0.113.9' }, ip: '10.0.0.1' }),
    ).toBe('203.0.113.9');
  });

  it('ignores spoofed left-side entries, trusting only the rightmost', () => {
    expect(
      throttlerClientIp({
        headers: { 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 203.0.113.9' },
        ip: '10.0.0.1',
      }),
    ).toBe('203.0.113.9');
  });

  it('trims surrounding whitespace on the resolved entry', () => {
    expect(
      throttlerClientIp({ headers: { 'x-forwarded-for': ' 1.1.1.1 ,  203.0.113.9  ' }, ip: '10.0.0.1' }),
    ).toBe('203.0.113.9');
  });

  it('handles the array header form (last header value, then rightmost entry)', () => {
    expect(
      throttlerClientIp({
        headers: { 'x-forwarded-for': ['1.1.1.1', '2.2.2.2, 203.0.113.9'] },
        ip: '10.0.0.1',
      }),
    ).toBe('203.0.113.9');
  });

  it('falls back to req.ip when there is no X-Forwarded-For', () => {
    expect(throttlerClientIp({ headers: {}, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });

  it('falls back to req.ip when X-Forwarded-For is empty/blank', () => {
    expect(throttlerClientIp({ headers: { 'x-forwarded-for': '   ' }, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });
});

@Controller('t')
class SampleController {
  @Get('tight')
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  tight() {
    return 'ok';
  }

  @Get('whoami')
  who(@Req() req: any) {
    return { reqIp: req.ip };
  }
}

describe('S0-B3B1 e2e — buckets keyed by resolved client IP; req.ip untouched', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SampleController],
      imports: [
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60_000, limit: 2, getTracker: throttlerClientIp },
        ]),
      ],
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

  const hit = (path: string, xff?: string) =>
    fetch(`${base}${path}`, xff ? { headers: { 'x-forwarded-for': xff } } : {}).then((r) => r.status);

  it('gives two distinct clients separate buckets, and 429s the one that exceeds', async () => {
    expect(await hit('/t/tight', '1.1.1.1')).toBe(200); // client A #1
    expect(await hit('/t/tight', '1.1.1.1')).toBe(200); // client A #2 (limit=2)
    expect(await hit('/t/tight', '1.1.1.1')).toBe(429); // client A exceeds → 429
    expect(await hit('/t/tight', '2.2.2.2')).toBe(200); // client B unaffected
  });

  it('prevents a spoofed left-side X-Forwarded-For from escaping the real-client bucket', async () => {
    expect(await hit('/t/tight', '5.5.5.5')).toBe(200);
    expect(await hit('/t/tight', '5.5.5.5')).toBe(200);
    // Attacker prepends junk, but the rightmost (trusted) entry is still 5.5.5.5,
    // so it maps to the SAME bucket and is blocked — cannot mint a fresh budget.
    expect(await hit('/t/tight', '9.9.9.9, 5.5.5.5')).toBe(429);
  });

  it('does NOT change req.ip (audit/compliance consumers see the socket IP, not XFF)', async () => {
    const res = await fetch(`${base}/t/whoami`, { headers: { 'x-forwarded-for': '203.0.113.7' } });
    const body = (await res.json()) as { reqIp: string };
    // trust proxy is NOT set, so req.ip stays the loopback socket peer — the
    // forwarded value influences throttling ONLY, never req.ip.
    expect(body.reqIp).not.toBe('203.0.113.7');
  });
});
