import { useAuthStore } from '../store/auth.store';
import { api } from '../api/client';

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ accessToken: 'test-token', isAuthenticated: true, refreshToken: null, userId: null });
});

const HOLD_BODY = {
  code: 'ACCOUNT_UNDER_REVIEW',
  message: 'Your account is under safety review. Please contact support.',
};

describe('api client — ACCOUNT_UNDER_REVIEW fraud hold', () => {
  it('exposes err.code === ACCOUNT_UNDER_REVIEW on 403 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => HOLD_BODY,
    });

    let caughtCode: string | undefined;
    try {
      await api.post('/trips', {});
    } catch (err: any) {
      caughtCode = err.code;
    }

    expect(caughtCode).toBe('ACCOUNT_UNDER_REVIEW');
  });

  it('exposes the user-safe message on err.message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => HOLD_BODY,
    });

    let caughtMessage: string | undefined;
    try {
      await api.post('/trips', {});
    } catch (err: any) {
      caughtMessage = err.message;
    }

    expect(caughtMessage).toBe('Your account is under safety review. Please contact support.');
  });

  it('exposes err.status === 403', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => HOLD_BODY,
    });

    let caughtStatus: number | undefined;
    try {
      await api.post('/trips', {});
    } catch (err: any) {
      caughtStatus = err.status;
    }

    expect(caughtStatus).toBe(403);
  });

  it('still reads nested error.code format for backwards compatibility', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'SOME_OTHER_ERROR', message: 'Some error' } }),
    });

    let caughtCode: string | undefined;
    try {
      await api.post('/trips', {});
    } catch (err: any) {
      caughtCode = err.code;
    }

    expect(caughtCode).toBe('SOME_OTHER_ERROR');
  });
});
