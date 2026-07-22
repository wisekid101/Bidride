import { useDriverStore } from '../store/driver.store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';
const REQUEST_TIMEOUT_MS = 15000;

// A single in-flight refresh is shared across concurrent 401s so parallel
// requests never trigger a refresh storm (which could rotate the refresh token
// out from under each other) or a redirect storm.
let refreshPromise: Promise<boolean> | null = null;

export class ApiError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = opts.code;
    this.status = opts.status;
  }
}

// Maps a thrown value to an ApiError: an aborted operation (our timeout fired)
// becomes TIMEOUT; anything else that isn't already an ApiError becomes NETWORK.
function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if ((err as Error)?.name === 'AbortError') {
    return new ApiError('The request timed out. Please check your connection and try again.', { code: 'TIMEOUT' });
  }
  return new ApiError('Network error. Please check your connection and try again.', { code: 'NETWORK' });
}

type ErrorBody = { error?: { message?: string; code?: string }; message?: string; code?: string };

async function request<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const { accessToken } = useDriverStore.getState();

  // One AbortController + timer guards the WHOLE operation — the fetch, the
  // response headers, the body stream, and JSON parsing — so a server that
  // sends headers and then stalls mid-body still aborts with a TIMEOUT. The
  // timer is cleared exactly once via the idempotent `clear()` (never leaked,
  // never duplicated).
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );
  const clear = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  try {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...options.headers,
        },
      });
    } catch (err) {
      throw toApiError(err);
    }

    if (response.status === 401) {
      // The original response is fully received; stop this request's clock so
      // the timer can't fire a stray abort during the refresh + retry cycle.
      clear();
      // Attempt exactly one refresh + retry cycle (isRetry guards against loops).
      if (!isRetry) {
        const refreshed = await refreshAccessToken();
        if (refreshed) return await request<T>(path, options, true);
      }
      // Refresh failed (or the retry still 401'd): force a clean, one-time expiry.
      useDriverStore.getState().setSessionExpired(true);
      await useDriverStore.getState().clearTokens();
      throw new ApiError('Your session expired. Please sign in again.', { code: 'SESSION_EXPIRED', status: 401 });
    }

    if (!response.ok) {
      // Body read is still under the timer; a stalled error body aborts → TIMEOUT.
      let error: ErrorBody = {};
      try {
        error = (await response.json()) as ErrorBody;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw toApiError(err);
        // A missing/invalid error body is fine — fall back to the HTTP status.
      }
      throw new ApiError(
        error?.error?.message ?? error?.message ?? 'Something went wrong. Please try again.',
        { code: error?.error?.code ?? error?.code, status: response.status },
      );
    }

    if (response.status === 204) return undefined as T;

    // Success body read is still under the timer; a mid-body stall aborts →
    // TIMEOUT. Genuine parse errors propagate unchanged (no contract change).
    try {
      return (await response.json()) as T;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw toApiError(err);
      throw err;
    }
  } finally {
    clear();
  }
}

function refreshAccessToken(): Promise<boolean> {
  // Coalesce concurrent refreshes into one shared promise.
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function doRefresh(): Promise<boolean> {
  const { accessToken, refreshToken, userId, setTokens } = useDriverStore.getState();
  if (!refreshToken || !userId) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;
    const data = await response.json() as { access_token: string; refresh_token: string };
    await setTokens(data.access_token, data.refresh_token, userId);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
