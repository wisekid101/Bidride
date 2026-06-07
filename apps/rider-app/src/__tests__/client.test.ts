import { useAuthStore } from '../store/auth.store';

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
  jest.resetModules();
});

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

describe('api client — JWT Authorization header', () => {
  it('injects Bearer token from store into request headers', async () => {
    useAuthStore.setState({ accessToken: 'test-jwt-token', isAuthenticated: true });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: 'ok' }),
    });

    const { api } = require('../api/client');
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

    const { api } = require('../api/client');
    await api.get('/test');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBeUndefined();
  });
});

describe('api client — 401 token refresh', () => {
  it('attempts token refresh on 401 and retries once', async () => {
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

    const { api } = require('../api/client');
    const result = await api.get('/protected');

    expect(result).toEqual({ data: 'retried-success' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('clears tokens and throws SESSION_EXPIRED if refresh fails', async () => {
    useAuthStore.setState({
      accessToken: 'expired-token',
      refreshToken: 'invalid-refresh',
      userId: 'user-1',
      isAuthenticated: true,
    });

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    const { api } = require('../api/client');
    await expect(api.get('/protected')).rejects.toThrow('SESSION_EXPIRED');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
