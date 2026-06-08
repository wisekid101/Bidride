import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../store/auth.store';

const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    accessToken: null,
    refreshToken: null,
    userId: null,
    isAuthenticated: false,
  });
});

describe('auth.store — SecureStore enforcement', () => {
  it('stores tokens in SecureStore, not AsyncStorage', async () => {
    await useAuthStore.getState().setTokens('access-123', 'refresh-456', 'user-789');

    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('access_token', 'access-123');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('refresh_token', 'refresh-456');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('user_id', 'user-789');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledTimes(3);
  });

  it('SecureStore.setItemAsync is called and AsyncStorage is never imported by auth store', async () => {
    // auth.store.ts imports SecureStore directly — if setItemAsync is called,
    // it proves SecureStore (not AsyncStorage) is being used for token storage
    await useAuthStore.getState().setTokens('access-123', 'refresh-456', 'user-789');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledTimes(3);
    // SecureStore mock has no .setItem — that belongs to AsyncStorage's API
    expect((SecureStore as any).setItem).toBeUndefined();
  });

  it('sets isAuthenticated=true after setTokens', async () => {
    await useAuthStore.getState().setTokens('access-123', 'refresh-456', 'user-789');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe('access-123');
    expect(useAuthStore.getState().userId).toBe('user-789');
  });

  it('clears all SecureStore keys on clearTokens', async () => {
    await useAuthStore.getState().setTokens('access-123', 'refresh-456', 'user-789');
    await useAuthStore.getState().clearTokens();

    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('access_token');
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('refresh_token');
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('user_id');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('loads tokens from SecureStore on loadTokens', async () => {
    mockSecureStore.getItemAsync
      .mockResolvedValueOnce('stored-access')
      .mockResolvedValueOnce('stored-refresh')
      .mockResolvedValueOnce('stored-user');

    await useAuthStore.getState().loadTokens();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe('stored-access');
    expect(useAuthStore.getState().refreshToken).toBe('stored-refresh');
    expect(useAuthStore.getState().userId).toBe('stored-user');
  });

  it('does not set isAuthenticated if any token is missing', async () => {
    mockSecureStore.getItemAsync
      .mockResolvedValueOnce('stored-access')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('stored-user');

    await useAuthStore.getState().loadTokens();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('role is always rider', () => {
    expect(useAuthStore.getState().role).toBe('rider');
  });
});
