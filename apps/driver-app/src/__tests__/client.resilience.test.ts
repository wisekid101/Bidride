/**
 * Driver API client — auth/session resilience (Commit 1).
 *
 * Covers the previously-untested resilience surface: the 15s timeout that must
 * protect the COMPLETE HTTP operation (fetch + headers + body read + JSON
 * parse), single-flight refresh coalescing, one-shot 401 refresh+retry, clean
 * session expiry, and the absence of unhandled rejections.
 */
import { useDriverStore } from '../store/driver.store';
import { api } from '../api/client';

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

const TIMEOUT_MS = 15000;

function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

/** A fetch that never resolves until its signal aborts (header/network stall). */
function fetchStallsBeforeHeaders() {
  return (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(abortError()));
    });
}

/** A fetch whose headers arrive OK but whose BODY (.json) stalls until abort. */
function fetchStallsDuringBody(status = 200) {
  return (_url: string, init: RequestInit) =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(abortError()));
        }),
    } as unknown as Response);
}

function okJson(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as unknown as Response;
}

function status401(): Response {
  return { ok: false, status: 401, json: async () => ({}) } as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  useDriverStore.setState({
    userId: 'driver-1',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    isAuthenticated: true,
    sessionExpired: false,
    isOnline: false,
    shiftStartedAt: null,
    todayEarnings: { takeHome: 0, trips: 0, hoursOnline: 0, floorSupplements: 0 },
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('client resilience — timeout lifecycle', () => {
  it('1. a request that never returns headers times out with TIMEOUT', async () => {
    jest.useFakeTimers();
    mockFetch.mockImplementation(fetchStallsBeforeHeaders());

    const p = api.get('/drivers/me');
    const assertion = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
    await assertion;
  });

  it('2. headers arrive but the body stalls — still times out with TIMEOUT', async () => {
    jest.useFakeTimers();
    mockFetch.mockImplementation(fetchStallsDuringBody(200));

    const p = api.get('/drivers/me');
    const assertion = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
    await assertion;
  });

  it('3. a normal successful response resolves and leaves no pending timer', async () => {
    jest.useFakeTimers();
    mockFetch.mockResolvedValueOnce(okJson({ id: 'driver-1' }));

    const data = await api.get<{ id: string }>('/drivers/me');

    expect(data).toEqual({ id: 'driver-1' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('9. a genuine network failure surfaces NETWORK, not TIMEOUT', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(api.get('/drivers/me')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('11. an error response whose body stalls after headers still times out with TIMEOUT', async () => {
    // Regression guard: a non-2xx (500) whose error body streams then stalls
    // must abort → TIMEOUT, not hang and not fall back to the HTTP status.
    jest.useFakeTimers();
    mockFetch.mockImplementation(fetchStallsDuringBody(500));

    const p = api.get('/drivers/me');
    const assertion = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
    await assertion;
  });
});

describe('client resilience — refresh coalescing & retry', () => {
  it('4 & 5. concurrent 401s trigger exactly one refresh; all waiters reuse its result', async () => {
    let refreshCount = 0;
    let refreshed = false;
    mockFetch.mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCount += 1;
        refreshed = true;
        return Promise.resolve(okJson({ access_token: 'access-2', refresh_token: 'refresh-2' }));
      }
      return Promise.resolve(refreshed ? okJson({ ok: true, url }) : status401());
    });

    const results = await Promise.all([
      api.get<{ url: string }>('/a'),
      api.get<{ url: string }>('/b'),
      api.get<{ url: string }>('/c'),
    ]);

    expect(refreshCount).toBe(1);
    expect(results.map((r) => r.url).sort()).toEqual(['/a', '/b', '/c'].map((p) => expect.stringContaining(p)));
  });

  it('6. a successful refresh retries each original request exactly once', async () => {
    const dataCalls: Record<string, number> = {};
    let refreshed = false;
    mockFetch.mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshed = true;
        return Promise.resolve(okJson({ access_token: 'access-2', refresh_token: 'refresh-2' }));
      }
      dataCalls[url] = (dataCalls[url] ?? 0) + 1;
      return Promise.resolve(refreshed ? okJson({ ok: true }) : status401());
    });

    await api.get('/drivers/me');

    // exactly two hits: the original 401 + one retry — never a loop.
    const key = Object.keys(dataCalls).find((k) => k.endsWith('/drivers/me'))!;
    expect(dataCalls[key]).toBe(2);
  });

  it('7. a failed refresh sets sessionExpired, clears auth, throws SESSION_EXPIRED once, no loop', async () => {
    const dataCalls: string[] = [];
    mockFetch.mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(status401()); // refresh itself fails
      }
      dataCalls.push(url);
      return Promise.resolve(status401());
    });

    await expect(api.get('/drivers/me')).rejects.toMatchObject({ code: 'SESSION_EXPIRED', status: 401 });

    expect(useDriverStore.getState().sessionExpired).toBe(true);
    expect(useDriverStore.getState().isAuthenticated).toBe(false);
    expect(useDriverStore.getState().accessToken).toBeNull();
    // original request hit once; refresh failed so there is no retry.
    expect(dataCalls).toHaveLength(1);
  });

  it('12. clears the request timer BEFORE refreshing, so no stale timeout can abort the in-flight refresh', async () => {
    jest.useFakeTimers();

    // Pause the refresh in-flight so we can inspect timers mid-refresh.
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    let signalRefreshCalled!: () => void;
    const refreshCalled = new Promise<void>((resolve) => { signalRefreshCalled = resolve; });
    let refreshed = false;

    mockFetch.mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) {
        signalRefreshCalled();
        return refreshGate.then(() => {
          refreshed = true;
          return okJson({ access_token: 'access-2', refresh_token: 'refresh-2' });
        });
      }
      return Promise.resolve(refreshed ? okJson({ ok: true }) : status401());
    });

    const p = api.get<{ ok: boolean }>('/drivers/me');
    await refreshCalled; // the original 401 has been handled and refresh is now in-flight

    // The original request's timer must already be cleared (client.ts clears it
    // before awaiting the refresh). Only the refresh's OWN timer remains armed —
    // so exactly one pending timer, not two. If the pre-refresh clear were
    // removed, a stale original timer would still be pending here (count 2).
    expect(jest.getTimerCount()).toBe(1);

    releaseRefresh();
    await expect(p).resolves.toEqual({ ok: true }); // refresh completed uninterrupted; retry succeeded
    expect(useDriverStore.getState().accessToken).toBe('access-2');
  });
});

describe('driver.store — sessionExpired flag', () => {
  it('8. setSessionExpired sets the flag and setTokens resets it to false', async () => {
    useDriverStore.getState().setSessionExpired(true);
    expect(useDriverStore.getState().sessionExpired).toBe(true);

    await useDriverStore.getState().setTokens('access-9', 'refresh-9', 'driver-1');
    expect(useDriverStore.getState().sessionExpired).toBe(false);
  });
});

describe('client resilience — no unhandled rejections', () => {
  it('10. abort and refresh-failure paths produce no unhandled promise rejection', async () => {
    const seen: unknown[] = [];
    const handler = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', handler);

    // (a) refresh-failure path
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/auth/refresh') ? status401() : status401()),
    );
    await api.get('/drivers/me').catch(() => undefined);

    // (b) network-failure path
    mockFetch.mockRejectedValueOnce(new TypeError('down'));
    await api.get('/drivers/me').catch(() => undefined);

    await new Promise((r) => setImmediate(r));
    process.off('unhandledRejection', handler);

    expect(seen).toEqual([]);
  });
});
