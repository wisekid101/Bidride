import { useDriverStore } from '../store/driver.store';
import { api } from '../api/client';

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useDriverStore.setState({
    accessToken: 'driver-test-token',
    isAuthenticated: true,
    refreshToken: null,
    userId: null,
    isOnline: false,
    shiftStartedAt: null,
    todayEarnings: { takeHome: 0, trips: 0, hoursOnline: 0, floorSupplements: 0 },
  });
});

const HOLD_BODY = {
  code: 'ACCOUNT_UNDER_REVIEW',
  message: 'Your account is under safety review. Please contact support.',
};

describe('driver api client — ACCOUNT_UNDER_REVIEW fraud hold', () => {
  it('exposes err.code === ACCOUNT_UNDER_REVIEW on 403 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => HOLD_BODY,
    });

    let caughtCode: string | undefined;
    try {
      await api.post('/bids/bid-123/accept');
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
      await api.post('/bids/bid-123/accept');
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
      await api.post('/bids/bid-123/accept');
    } catch (err: any) {
      caughtStatus = err.status;
    }

    expect(caughtStatus).toBe(403);
  });

  it('still reads nested error.code format for backwards compatibility', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'BID_ALREADY_CLAIMED', message: 'Claimed.' } }),
    });

    let caughtCode: string | undefined;
    try {
      await api.post('/bids/bid-123/accept');
    } catch (err: any) {
      caughtCode = err.code;
    }

    expect(caughtCode).toBe('BID_ALREADY_CLAIMED');
  });
});
