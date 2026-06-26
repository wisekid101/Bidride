import { CircuitBreaker, CircuitBreakerOpenError } from '../circuit-breaker';

const fail = () => Promise.reject(new Error('service error'));
const succeed = () => Promise.resolve('ok');

describe('CircuitBreaker', () => {
  describe('closed state (normal operation)', () => {
    it('starts in closed state', () => {
      const cb = new CircuitBreaker({ name: 'test' });
      expect(cb.getState()).toBe('closed');
    });

    it('passes through successful calls', async () => {
      const cb = new CircuitBreaker({ name: 'test' });
      const result = await cb.execute(succeed);
      expect(result).toBe('ok');
    });

    it('increments success count on each success', async () => {
      const cb = new CircuitBreaker({ name: 'test' });
      await cb.execute(succeed);
      await cb.execute(succeed);
      expect(cb.getStats().successes).toBe(2);
    });
  });

  describe('opening on failure threshold', () => {
    it('stays closed below failure threshold', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 5 });
      for (let i = 0; i < 4; i++) {
        await expect(cb.execute(fail)).rejects.toThrow('service error');
      }
      expect(cb.getState()).toBe('closed');
    });

    it('opens after reaching failure threshold', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3 });
      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(fail)).rejects.toThrow();
      }
      expect(cb.getState()).toBe('open');
    });

    it('throws CircuitBreakerOpenError when open', async () => {
      const cb = new CircuitBreaker({ name: 'svc', failureThreshold: 1 });
      await expect(cb.execute(fail)).rejects.toThrow();
      await expect(cb.execute(succeed)).rejects.toThrow(CircuitBreakerOpenError);
    });

    it('increments rejected request count when open', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1 });
      await expect(cb.execute(fail)).rejects.toThrow();
      await expect(cb.execute(succeed)).rejects.toThrow(CircuitBreakerOpenError);
      expect(cb.getStats().rejectedRequests).toBe(1);
    });
  });

  describe('half-open state (recovery probe)', () => {
    it('transitions to half_open after reset timeout', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 0 });
      await expect(cb.execute(fail)).rejects.toThrow();
      expect(cb.getState()).toBe('open');

      // With resetTimeoutMs=0 the next call should probe in half-open
      await cb.execute(succeed);
      expect(cb.getState()).toBe('closed');
    });

    it('re-opens if probe fails in half-open', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 0 });
      await expect(cb.execute(fail)).rejects.toThrow();
      // Allow transition to half-open (resetTimeoutMs=0)
      await expect(cb.execute(fail)).rejects.toThrow('service error');
      expect(cb.getState()).toBe('open');
    });

    it('closes fully after successful half-open probe', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 0 });
      await expect(cb.execute(fail)).rejects.toThrow();
      await cb.execute(succeed); // half-open probe succeeds
      expect(cb.getState()).toBe('closed');
      expect(cb.getStats().failures).toBe(0); // reset on close
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1 });
      await expect(cb.execute(fail)).rejects.toThrow();
      cb.reset();
      expect(cb.getState()).toBe('closed');
      expect(cb.getStats().failures).toBe(0);
      expect(cb.getStats().totalRequests).toBe(0);
    });
  });

  describe('getStats', () => {
    it('tracks total requests across all calls', async () => {
      const cb = new CircuitBreaker({ name: 'test', failureThreshold: 10 });
      await cb.execute(succeed);
      await expect(cb.execute(fail)).rejects.toThrow();
      expect(cb.getStats().totalRequests).toBe(2);
    });
  });
});
