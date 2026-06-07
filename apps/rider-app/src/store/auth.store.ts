import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  role: 'rider' | null;
  isAuthenticated: boolean;
  setTokens: (access: string, refresh: string, userId: string) => Promise<void>;
  clearTokens: () => Promise<void>;
  loadTokens: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  userId: null,
  role: 'rider',
  isAuthenticated: false,

  setTokens: async (access, refresh, userId) => {
    await SecureStore.setItemAsync('access_token', access);
    await SecureStore.setItemAsync('refresh_token', refresh);
    await SecureStore.setItemAsync('user_id', userId);
    set({ accessToken: access, refreshToken: refresh, userId, isAuthenticated: true });
  },

  clearTokens: async () => {
    await SecureStore.deleteItemAsync('access_token');
    await SecureStore.deleteItemAsync('refresh_token');
    await SecureStore.deleteItemAsync('user_id');
    set({ accessToken: null, refreshToken: null, userId: null, isAuthenticated: false });
  },

  loadTokens: async () => {
    const access = await SecureStore.getItemAsync('access_token');
    const refresh = await SecureStore.getItemAsync('refresh_token');
    const userId = await SecureStore.getItemAsync('user_id');
    if (access && refresh && userId) {
      set({ accessToken: access, refreshToken: refresh, userId, isAuthenticated: true });
    }
  },
}));
