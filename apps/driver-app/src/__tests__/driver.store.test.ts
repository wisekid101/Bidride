import * as SecureStore from 'expo-secure-store';
import { useDriverStore } from '../store/driver.store';

const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

beforeEach(() => {
  jest.clearAllMocks();
  useDriverStore.setState({
    accessToken: null,
    refreshToken: null,
    userId: null,
    isAuthenticated: false,
    isOnline: false,
    shiftStartedAt: null,
    todayEarnings: { takeHome: 0, trips: 0, hoursOnline: 0, floorSupplements: 0 },
  });
});

describe('driver.store — SecureStore enforcement', () => {
  it('stores tokens in SecureStore under driver-prefixed keys', async () => {
    await useDriverStore.getState().setTokens('d-access-123', 'd-refresh-456', 'd-user-789');

    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('driver_access_token', 'd-access-123');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('driver_refresh_token', 'd-refresh-456');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('driver_user_id', 'd-user-789');
  });

  it('never uses the same SecureStore keys as rider app', async () => {
    await useDriverStore.getState().setTokens('d-access', 'd-refresh', 'd-user');
    const calls = mockSecureStore.setItemAsync.mock.calls.map(([key]) => key);
    expect(calls).not.toContain('access_token');
    expect(calls).not.toContain('refresh_token');
    expect(calls).not.toContain('user_id');
  });

  it('sets isAuthenticated=true after setTokens', async () => {
    await useDriverStore.getState().setTokens('d-access', 'd-refresh', 'd-user');
    expect(useDriverStore.getState().isAuthenticated).toBe(true);
  });

  it('clears tokens and forces offline on clearTokens', async () => {
    await useDriverStore.getState().setTokens('d-access', 'd-refresh', 'd-user');
    useDriverStore.getState().setOnlineStatus(true);
    await useDriverStore.getState().clearTokens();

    expect(useDriverStore.getState().isAuthenticated).toBe(false);
    expect(useDriverStore.getState().isOnline).toBe(false);
    expect(useDriverStore.getState().accessToken).toBeNull();
  });
});

describe('driver.store — online/offline toggle', () => {
  it('sets shiftStartedAt when going online', () => {
    const before = new Date();
    useDriverStore.getState().setOnlineStatus(true);
    const after = new Date();

    expect(useDriverStore.getState().isOnline).toBe(true);
    const shift = useDriverStore.getState().shiftStartedAt!;
    expect(shift.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(shift.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('clears shiftStartedAt when going offline', () => {
    useDriverStore.getState().setOnlineStatus(true);
    useDriverStore.getState().setOnlineStatus(false);

    expect(useDriverStore.getState().isOnline).toBe(false);
    expect(useDriverStore.getState().shiftStartedAt).toBeNull();
  });
});

describe('driver.store — earnings', () => {
  it('initializes takeHome at zero', () => {
    expect(useDriverStore.getState().todayEarnings.takeHome).toBe(0);
  });

  it('updates partial earnings without overwriting other fields', () => {
    useDriverStore.getState().setTodayEarnings({ takeHome: 147.50, trips: 8 });
    const { takeHome, trips, hoursOnline, floorSupplements } = useDriverStore.getState().todayEarnings;

    expect(takeHome).toBe(147.50);
    expect(trips).toBe(8);
    expect(hoursOnline).toBe(0);
    expect(floorSupplements).toBe(0);
  });
});
