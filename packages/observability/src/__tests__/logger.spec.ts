import { BidRideLogger, redact } from '../logger';
import { withCorrelation } from '../correlation';

describe('redact', () => {
  it('redacts known sensitive keys', () => {
    const result = redact({ password: 'secret123', name: 'Alice' }) as any;
    expect(result.password).toBe('[REDACTED]');
    expect(result.name).toBe('Alice');
  });

  it('redacts deeply nested sensitive keys', () => {
    const result = redact({ user: { token: 'abc', email: 'a@b.com' } }) as any;
    expect(result.user.token).toBe('[REDACTED]');
    expect(result.user.email).toBe('a@b.com');
  });

  it('handles arrays', () => {
    const result = redact([{ password: 'x' }, { name: 'Bob' }]) as any[];
    expect(result[0].password).toBe('[REDACTED]');
    expect(result[1].name).toBe('Bob');
  });

  it('redacts apiKey and webhookSecret', () => {
    const result = redact({ apiKey: 'key', webhookSecret: 'sec' }) as any;
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.webhookSecret).toBe('[REDACTED]');
  });

  it('leaves primitive values intact', () => {
    expect(redact('hello')).toBe('hello');
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });
});

describe('BidRideLogger', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => jest.restoreAllMocks());

  it('writes info to stdout as JSON', () => {
    const logger = new BidRideLogger('TestService');
    logger.info('hello world');
    expect(stdoutSpy).toHaveBeenCalled();
    const written = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(written.level).toBe('info');
    expect(written.message).toBe('hello world');
    expect(written.context).toBe('TestService');
  });

  it('writes error to stderr', () => {
    const logger = new BidRideLogger('TestService');
    logger.error('something failed', new Error('boom'));
    expect(stderrSpy).toHaveBeenCalled();
    const written = JSON.parse(stderrSpy.mock.calls[0][0]);
    expect(written.level).toBe('error');
    expect(written.errorMessage).toBe('boom');
  });

  it('writes warn to stderr', () => {
    const logger = new BidRideLogger('TestService');
    logger.warn('be careful');
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('suppresses debug logs when minLevel is info', () => {
    const logger = new BidRideLogger('TestService', 'info');
    logger.debug('should be suppressed');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('emits debug logs when minLevel is debug', () => {
    const logger = new BidRideLogger('TestService', 'debug');
    logger.debug('visible');
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('includes correlationId from AsyncLocalStorage context', () => {
    const logger = new BidRideLogger('TestService');
    withCorrelation('corr-abc', () => {
      logger.info('tracked request');
    });
    const written = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(written.correlationId).toBe('corr-abc');
  });

  it('redacts sensitive fields in meta', () => {
    const logger = new BidRideLogger('TestService');
    logger.info('auth event', { password: 'hunter2', userId: 'u1' });
    const written = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(written.password).toBe('[REDACTED]');
    expect(written.userId).toBe('u1');
  });

  it('includes timestamp in ISO format', () => {
    const logger = new BidRideLogger('TestService');
    logger.info('ts test');
    const written = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(new Date(written.timestamp).toISOString()).toBe(written.timestamp);
  });

  it('child logger includes parent:child context', () => {
    const parent = new BidRideLogger('Parent');
    const child = parent.child('Child');
    child.info('from child');
    const written = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(written.context).toBe('Parent:Child');
  });
});
