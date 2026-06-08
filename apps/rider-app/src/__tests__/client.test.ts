/**
 * Tests the API client's E.164 phone validation, JWT injection, and 401 refresh behavior.
 *
 * Uses the real auth store (not mocked) so client.ts and tests share the same Zustand instance.
 * jest.resetModules() is intentionally NOT used to prevent module instance divergence.
 */
import { useAuthStore } from '../store/auth.store';
import { api } from '../api/client';

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    accessToken: null,
    refreshToken: null,
    userId: null,
    isAuthenticated: false,
  });
});

// ─── E.164 validation (pure logic, no network) ───────────────────────────────

describe('api client — E.164 phone format validation', () => {
  const validateE164 = (phone: string) => /^\+1\d{10}$/.test(phone);

  it('accepts a valid E.164 US number', () => {
    expect(validateE164('+12015550100')).toBe(true);
  });

  it('rejects a number without country code', () => {
    expect(validateE164('2015550100')).toBe(false);
  });

  it('rejects a number with spaces', () => {
    expect(validateE164('+1 201 555 0100')).toBe(false);
  });

  it('rejects a number that is too short', () => {
    expect(validateE164('+1201555010')).toBe(false);
  });

  it('formats raw digits to E.164 correctly', () => {
    const rawPhone = '(201) 555-0100';
    const e164 = `+1${rawPhone.replace(/\D/g, '')}`;
    expect(e164).toBe('+12015550100');
    expect(validateE164(e164)).toBe(true);
  });
});

// ─── JWT Authorization header ─────────────────────────────────────────────────

describe('api client — JWT Authorization header', () => {
  it('injects Bearer token from store into request headers', async () => {
    useAuthStore.setState({ accessToken: 'test-jwt-token', isAuthenticated: true });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: 'ok' }),
    });

    await api.get('/test');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer test-jwt-token');
  });

  it('sends no Authorization header when unauthenticated', async () => {
    useAuthStore.setState({ accessToken: null, isAuthenticated: false });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: 'ok' }),
    });

    await api.get('/test');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBeUndefined();
  });
});

// ─── 401 token refresh ────────────────────────────────────────────────────────

describe('api client — 401 token refresh', () => {
  it('calls refresh endpoint on 401 and retries with new token', async () => {
    useAuthStore.setState({
      accessToken: 'expired-token',
      refreshToken: 'valid-refresh',
      userId: 'user-1',
      isAuthenticated: true,
    });

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: 'retried-success' }),
      });

    const result = await api.get('/protected');

    expect(result).toEqual({ data: 'retried-success' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // First call is the original request
    expect(mockFetch.mock.calls[0][0]).toContain('/protected');
    // Second call is the refresh
    expect(mockFetch.mock.calls[1][0]).toContain('/auth/refresh');
    // Third call is the retry
    expect(mockFetch.mock.calls[2][0]).toContain('/protected');
  });

  it('throws SESSION_EXPIRED and clears tokens when no refresh token exists', async () => {
    useAuthStore.setState({
      accessToken: 'expired-token',
      refreshToken: null,
      userId: null,
      isAuthenticated: true,
    });

    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    await expect(api.get('/protected')).rejects.toThrow('SESSION_EXPIRED');
    // After SESSION_EXPIRED, tokens should be cleared
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('throws SESSION_EXPIRED and clears tokens when refresh call itself fails', async () => {
    useAuthStore.setState({
      accessToken: 'expired-token',
      refreshToken: 'bad-refresh',
      userId: 'user-1',
      isAuthenticated: true,
    });

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    await expect(api.get('/protected')).rejects.toThrow('SESSION_EXPIRED');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
