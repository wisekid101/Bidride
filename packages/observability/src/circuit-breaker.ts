export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMax: number;
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt: number | null;
  totalRequests: number;
  rejectedRequests: number;
}

export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker '${name}' is OPEN — rejecting request`);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreaker<T = unknown> {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureAt: number | null = null;
  private halfOpenAttempts = 0;
  private totalRequests = 0;
  private rejectedRequests = 0;

  private readonly opts: CircuitBreakerOptions;

  constructor(opts: Partial<CircuitBreakerOptions> & { name: string }) {
    this.opts = {
      failureThreshold: opts.failureThreshold ?? 5,
      resetTimeoutMs: opts.resetTimeoutMs ?? 30_000,
      halfOpenMax: opts.halfOpenMax ?? 1,
      name: opts.name,
    };
  }

  async execute(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    if (this.state === 'open') {
      const elapsed = Date.now() - (this.lastFailureAt ?? 0);
      if (elapsed >= this.opts.resetTimeoutMs) {
        this.state = 'half_open';
        this.halfOpenAttempts = 0;
      } else {
        this.rejectedRequests++;
        throw new CircuitBreakerOpenError(this.opts.name);
      }
    }

    if (this.state === 'half_open' && this.halfOpenAttempts >= this.opts.halfOpenMax) {
      this.rejectedRequests++;
      throw new CircuitBreakerOpenError(this.opts.name);
    }

    if (this.state === 'half_open') {
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.successes++;
    if (this.state === 'half_open') {
      this.state = 'closed';
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureAt = Date.now();
    if (this.state === 'half_open' || this.failures >= this.opts.failureThreshold) {
      this.state = 'open';
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureAt: this.lastFailureAt,
      totalRequests: this.totalRequests,
      rejectedRequests: this.rejectedRequests,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureAt = null;
    this.halfOpenAttempts = 0;
    this.totalRequests = 0;
    this.rejectedRequests = 0;
  }
}
