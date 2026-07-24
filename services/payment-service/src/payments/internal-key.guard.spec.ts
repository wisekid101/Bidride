import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InternalKeyGuard } from './internal-key.guard';

function ctx(headers: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('InternalKeyGuard (payment-service)', () => {
  const guard = new InternalKeyGuard();
  const ORIGINAL_KEY = process.env.INTERNAL_SERVICE_KEY;
  const ORIGINAL_ENV = process.env.NODE_ENV;

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.INTERNAL_SERVICE_KEY;
    else process.env.INTERNAL_SERVICE_KEY = ORIGINAL_KEY;
    process.env.NODE_ENV = ORIGINAL_ENV;
  });

  describe('when INTERNAL_SERVICE_KEY is configured (deployed posture)', () => {
    beforeEach(() => {
      process.env.INTERNAL_SERVICE_KEY = 'super-secret-internal-key';
      process.env.NODE_ENV = 'production';
    });

    it('rejects an unauthenticated request (no x-internal-key header)', () => {
      expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
    });

    it('rejects an invalid internal key', () => {
      expect(() => guard.canActivate(ctx({ 'x-internal-key': 'wrong-key' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a wrong-length key (constant-time path returns false)', () => {
      expect(() => guard.canActivate(ctx({ 'x-internal-key': 'short' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('accepts the correct internal key', () => {
      expect(guard.canActivate(ctx({ 'x-internal-key': 'super-secret-internal-key' }))).toBe(true);
    });
  });

  describe('when INTERNAL_SERVICE_KEY is absent', () => {
    beforeEach(() => {
      delete process.env.INTERNAL_SERVICE_KEY;
    });

    it('allows keyless in development', () => {
      process.env.NODE_ENV = 'development';
      expect(guard.canActivate(ctx({}))).toBe(true);
    });

    it('allows keyless in test', () => {
      process.env.NODE_ENV = 'test';
      expect(guard.canActivate(ctx({}))).toBe(true);
    });

    it('FAILS CLOSED in production (no key configured)', () => {
      process.env.NODE_ENV = 'production';
      expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
    });

    it('FAILS CLOSED for any unrecognized NODE_ENV (e.g. staging/alpha)', () => {
      process.env.NODE_ENV = 'alpha';
      expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
    });
  });
});
