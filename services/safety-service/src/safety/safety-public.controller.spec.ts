import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SafetyPublicController } from './safety-public.controller';
import { SafetyJwtGuard } from './safety-jwt.guard';
import { SafetyService } from './safety.service';

describe('SafetyPublicController', () => {
  const safety = {
    initiateSos: jest.fn().mockResolvedValue({ sosId: 's1', countdownSeconds: 5 }),
    confirmSos: jest.fn().mockResolvedValue({ confirmed: true }),
    cancelSos: jest.fn().mockResolvedValue({ cancelled: true }),
    triggerPanic: jest.fn().mockResolvedValue({ triggered: true }),
    storeRecordingAudio: jest.fn().mockResolvedValue({ stored: true }),
  };
  let controller: SafetyPublicController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      controllers: [SafetyPublicController],
      providers: [{ provide: SafetyService, useValue: safety }],
    })
      .overrideGuard(SafetyJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(SafetyPublicController);
  });

  const req = { user: { sub: 'user-1', role: 'rider' } } as any;

  it('initiate passes token userId (never the body) to the service', async () => {
    await controller.initiate(req, { tripId: 't1', gpsLat: 1, gpsLng: 2 } as any);
    expect(safety.initiateSos).toHaveBeenCalledWith('t1', 'user-1', 'button_tap', 1, 2);
  });

  it('confirm uses the sos id param + token userId', async () => {
    await controller.confirm(req, 's1');
    expect(safety.confirmSos).toHaveBeenCalledWith('s1', 'user-1');
  });

  it('cancel uses the sos id param + token userId', async () => {
    await controller.cancel(req, 's1');
    expect(safety.cancelSos).toHaveBeenCalledWith('s1', 'user-1');
  });

  it('panic passes token userId + role, defaults gps to 0', async () => {
    await controller.panic(req, { tripId: 't1' } as any);
    expect(safety.triggerPanic).toHaveBeenCalledWith('t1', 'user-1', 'rider', 0, 0);
  });

  it('storeAudio forwards to the service with token userId', async () => {
    await controller.storeAudio(req, 's1', { audioBase64: 'AAA', durationSeconds: 5 } as any);
    expect(safety.storeRecordingAudio).toHaveBeenCalledWith('s1', 'user-1', 'AAA', 5);
  });
});

describe('SafetyJwtGuard', () => {
  const jwt = { verify: jest.fn() } as unknown as JwtService;
  const guard = new SafetyJwtGuard(jwt);

  // B8C: the guard now decodes the token header to resolve its verification key
  // BEFORE calling jwt.verify, so a stub token string no longer reaches the
  // mock — the resolver rejects it as `Unsupported JWT algorithm: none`. The
  // fixture therefore needs a real HS256 header; the payload and signature stay
  // irrelevant because jwt.verify itself is mocked.
  const HS256_TOKEN = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.e30.sig`;

  beforeEach(() => {
    // clearAllMocks lives in the controller describe above, not this one, so
    // call counts would otherwise leak between these tests.
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'safety-guard-test-secret'; // the HS256 path fails closed without it
  });

  const ctx = (authorization?: string) => ({
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  }) as any;

  it('rejects a missing bearer token', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(UnauthorizedException);
  });

  it('rejects an invalid token', () => {
    (jwt.verify as jest.Mock).mockImplementation(() => { throw new Error('bad'); });
    expect(() => guard.canActivate(ctx('Bearer bad'))).toThrow(UnauthorizedException);
  });

  it('accepts a valid token and attaches req.user', () => {
    (jwt.verify as jest.Mock).mockReturnValue({ sub: 'u1', role: 'rider' });
    const req: any = { headers: { authorization: `Bearer ${HS256_TOKEN}` } };
    const c = { switchToHttp: () => ({ getRequest: () => req }) } as any;
    expect(guard.canActivate(c)).toBe(true);
    expect(req.user).toEqual({ sub: 'u1', role: 'rider' });
  });

  it('verifies with the resolved HS256 key, issuer and audience', () => {
    // The contract the resolver exists to enforce: exactly one algorithm, the
    // key that algorithm implies, and our issuer/audience.
    (jwt.verify as jest.Mock).mockReturnValue({ sub: 'u1', role: 'rider' });

    guard.canActivate(ctx(`Bearer ${HS256_TOKEN}`));

    expect(jwt.verify).toHaveBeenCalledWith(HS256_TOKEN, {
      secret: 'safety-guard-test-secret',
      algorithms: ['HS256'],
      issuer: 'bidride-auth',
      audience: 'bidride-user',
    });
  });

  it('rejects a token whose header names an unsupported algorithm', () => {
    // alg:none is the classic forgery attempt; the resolver refuses it before
    // jwt.verify is ever reached.
    const noneToken = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.e30.`;
    (jwt.verify as jest.Mock).mockReturnValue({ sub: 'attacker' });

    expect(() => guard.canActivate(ctx(`Bearer ${noneToken}`))).toThrow(UnauthorizedException);
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  it('rejects an RS256 token with no matching kid', () => {
    const rs = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'unknown' })).toString('base64url')}.e30.sig`;

    expect(() => guard.canActivate(ctx(`Bearer ${rs}`))).toThrow(UnauthorizedException);
    expect(jwt.verify).not.toHaveBeenCalled();
  });
});
