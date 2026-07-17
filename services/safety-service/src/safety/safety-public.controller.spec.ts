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
    const req: any = { headers: { authorization: 'Bearer good' } };
    const c = { switchToHttp: () => ({ getRequest: () => req }) } as any;
    expect(guard.canActivate(c)).toBe(true);
    expect(req.user).toEqual({ sub: 'u1', role: 'rider' });
  });
});
