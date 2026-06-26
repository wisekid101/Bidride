import { retry, retryWithTimeout } from '../retry';

// All tests use initialDelayMs: 0 + jitter: false so no timers are needed
describe('retry', () => {
  describe('success on first attempt', () => {
    it('returns the value and attempt count 1', async () => {
      const result = await retry(() => Promise.resolve(42));
      expect(result.value).toBe(42);
      expect(result.attempts).toBe(1);
    });
  });

  describe('success after transient failures', () => {
    it('succeeds on 2nd attempt', async () => {
      let calls = 0;
      const fn = () => {
        calls++;
        if (calls < 2) return Promise.reject(new Error('transient'));
        return Promise.resolve('done');
      };
      const result = await retry(fn, { initialDelayMs: 0, jitter: false });
      expect(result.value).toBe('done');
      expect(result.attempts).toBe(2);
    });

    it('succeeds on 3rd attempt with default max 3', async () => {
      let calls = 0;
      const fn = () => {
        calls++;
        if (calls < 3) return Promise.reject(new Error('transient'));
        return Promise.resolve('final');
      };
      const result = await retry(fn, { initialDelayMs: 0, jitter: false });
      expect(result.value).toBe('final');
      expect(result.attempts).toBe(3);
    });
  });

  describe('exhausts all attempts', () => {
    it('throws the last error after maxAttempts', async () => {
      const fn = () => Promise.reject(new Error('always fails'));
      await expect(
        retry(fn, { maxAttempts: 3, initialDelayMs: 0, jitter: false }),
      ).rejects.toThrow('always fails');
    });

    it('calls fn exactly maxAttempts times', async () => {
      let calls = 0;
      const fn = () => { calls++; return Promise.reject(new Error('fail')); };
      await retry(fn, { maxAttempts: 4, initialDelayMs: 0, jitter: false }).catch(() => {});
      expect(calls).toBe(4);
    });
  });

  describe('shouldRetry predicate', () => {
    it('stops immediately when shouldRetry returns false', async () => {
      let calls = 0;
      const fn = () => { calls++; return Promise.reject(new Error('non-retriable')); };
      await retry(fn, {
        maxAttempts: 5,
        initialDelayMs: 0,
        jitter: false,
        shouldRetry: (err) => !err.message.includes('non-retriable'),
      }).catch(() => {});
      expect(calls).toBe(1);
    });

    it('continues retrying when shouldRetry returns true', async () => {
      let calls = 0;
      const fn = () => { calls++; return Promise.reject(new Error('retriable')); };
      await retry(fn, {
        maxAttempts: 3,
        initialDelayMs: 0,
        jitter: false,
        shouldRetry: () => true,
      }).catch(() => {});
      expect(calls).toBe(3);
    });
  });

  describe('retryWithTimeout', () => {
    it('rejects with timeout error when timeout is shorter than operation', async () => {
      // Never resolves, but we unref the timer so it doesn't hold the event loop
      const slowFn = () => new Promise<string>((_resolve, _reject) => {
        const t = setTimeout(() => {}, 60_000);
        if (t && typeof (t as NodeJS.Timeout).unref === 'function') (t as NodeJS.Timeout).unref();
      });
      await expect(
        retryWithTimeout(slowFn, 50, { maxAttempts: 1, initialDelayMs: 0, jitter: false }),
      ).rejects.toThrow(/timed out/i);
    }, 1000);
  });
});
