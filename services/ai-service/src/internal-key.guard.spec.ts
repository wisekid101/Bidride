import { UnauthorizedException } from '@nestjs/common';
import { InternalKeyGuard } from './internal-key.guard';

const guard = new InternalKeyGuard();

const ctxWithHeaders = (headers: Record<string, string>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as any;

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env.INTERNAL_SERVICE_KEY = ORIGINAL_ENV.INTERNAL_SERVICE_KEY;
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  if (ORIGINAL_ENV.INTERNAL_SERVICE_KEY === undefined) delete process.env.INTERNAL_SERVICE_KEY;
  if (ORIGINAL_ENV.NODE_ENV === undefined) delete process.env.NODE_ENV;
});

describe('InternalKeyGuard — deployed environments fail CLOSED', () => {
  it('rejects every request when the key is missing in production', () => {
    delete process.env.INTERNAL_SERVICE_KEY;
    process.env.NODE_ENV = 'production';

    expect(() => guard.canActivate(ctxWithHeaders({}))).toThrow(UnauthorizedException);
  });

  it('rejects even requests presenting a header when no key is configured in production', () => {
    delete process.env.INTERNAL_SERVICE_KEY;
    process.env.NODE_ENV = 'production';

    expect(() => guard.canActivate(ctxWithHeaders({ 'x-internal-key': 'anything' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('staging fails closed too — keyless is never a deployed posture', () => {
    delete process.env.INTERNAL_SERVICE_KEY;
    process.env.NODE_ENV = 'staging';

    expect(() => guard.canActivate(ctxWithHeaders({}))).toThrow(UnauthorizedException);
  });

  it('an unset NODE_ENV fails closed — keyless requires explicit development/test', () => {
    delete process.env.INTERNAL_SERVICE_KEY;
    delete process.env.NODE_ENV;

    expect(() => guard.canActivate(ctxWithHeaders({}))).toThrow(UnauthorizedException);
  });
});

describe('InternalKeyGuard — key enforcement', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_KEY = 'secret-key';
  });

  it('rejects a missing header', () => {
    expect(() => guard.canActivate(ctxWithHeaders({}))).toThrow(UnauthorizedException);
  });

  it('rejects a wrong key', () => {
    expect(() => guard.canActivate(ctxWithHeaders({ 'x-internal-key': 'wrong' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts the correct key', () => {
    expect(guard.canActivate(ctxWithHeaders({ 'x-internal-key': 'secret-key' }))).toBe(true);
  });
});

describe('InternalKeyGuard — development posture', () => {
  it('allows requests without a configured key outside production (with the bootstrap warning)', () => {
    delete process.env.INTERNAL_SERVICE_KEY;
    process.env.NODE_ENV = 'development';

    expect(guard.canActivate(ctxWithHeaders({}))).toBe(true);
  });
});
