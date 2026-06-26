export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: boolean;
  shouldRetry: (err: Error, attempt: number) => boolean;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
  totalDurationMs: number;
}

const DEFAULTS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 10_000,
  factor: 2,
  jitter: true,
  shouldRetry: () => true,
};

function computeDelay(attempt: number, opts: RetryOptions): number {
  const exponential = opts.initialDelayMs * Math.pow(opts.factor, attempt - 1);
  const capped = Math.min(exponential, opts.maxDelayMs);
  return opts.jitter ? capped * (0.5 + Math.random() * 0.5) : capped;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts?: Partial<RetryOptions>,
): Promise<RetryResult<T>> {
  const options = { ...DEFAULTS, ...opts };
  const startedAt = Date.now();
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      const value = await fn();
      return { value, attempts: attempt, totalDurationMs: Date.now() - startedAt };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt >= options.maxAttempts || !options.shouldRetry(lastError, attempt)) {
        break;
      }

      await sleep(computeDelay(attempt, options));
    }
  }

  throw lastError;
}

export async function retryWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  opts?: Partial<RetryOptions>,
): Promise<RetryResult<T>> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs),
  );
  return Promise.race([retry(fn, opts), timeout]);
}
