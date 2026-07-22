import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { useDriverSocketStore } from './socket.store';

interface TodayEarnings {
  takeHome: number;
  trips: number;
  hoursOnline: number;
  floorSupplements: number;
}

interface DriverStore {
  isOnline: boolean;
  shiftStartedAt: Date | null;
  todayEarnings: TodayEarnings;
  userId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  // Set when a token refresh fails and the session is force-cleared, so the
  // auth screen can show a friendly "your session expired" message on return.
  sessionExpired: boolean;

  setOnlineStatus: (online: boolean) => void;
  setTodayEarnings: (earnings: Partial<TodayEarnings>) => void;
  setTokens: (access: string, refresh: string, userId: string) => Promise<void>;
  clearTokens: () => Promise<void>;
  loadTokens: () => Promise<void>;
  setSessionExpired: (value: boolean) => void;
}

export const useDriverStore = create<DriverStore>((set, get) => ({
  isOnline: false,
  shiftStartedAt: null,
  todayEarnings: { takeHome: 0, trips: 0, hoursOnline: 0, floorSupplements: 0 },
  userId: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  sessionExpired: false,

  setSessionExpired: (value) => set({ sessionExpired: value }),

  setOnlineStatus: (online) =>
    set({
      isOnline: online,
      shiftStartedAt: online ? new Date() : null,
    }),

  setTodayEarnings: (earnings) =>
    set((state) => ({
      todayEarnings: { ...state.todayEarnings, ...earnings },
    })),

  setTokens: async (access, refresh, userId) => {
    await SecureStore.setItemAsync('driver_access_token', access);
    await SecureStore.setItemAsync('driver_refresh_token', refresh);
    await SecureStore.setItemAsync('driver_user_id', userId);
    set({ accessToken: access, refreshToken: refresh, userId, isAuthenticated: true, sessionExpired: false });

    // A socket created with an expired token fails its handshake and exhausts
    // socket.io's retry budget before any HTTP call can refresh the token.
    // Every fresh token lands here, so revive the dead socket with it.
    // connect() is idempotent; the guard keeps login (no socket yet) untouched.
    const { socket, connect } = useDriverSocketStore.getState();
    if (socket && !socket.connected) {
      connect(access);
    }
  },

  clearTokens: async () => {
    await SecureStore.deleteItemAsync('driver_access_token');
    await SecureStore.deleteItemAsync('driver_refresh_token');
    await SecureStore.deleteItemAsync('driver_user_id');
    set({ accessToken: null, refreshToken: null, userId: null, isAuthenticated: false, isOnline: false });
  },

  loadTokens: async () => {
    const access = await SecureStore.getItemAsync('driver_access_token');
    const refresh = await SecureStore.getItemAsync('driver_refresh_token');
    const userId = await SecureStore.getItemAsync('driver_user_id');
    if (access && refresh && userId) {
      set({ accessToken: access, refreshToken: refresh, userId, isAuthenticated: true });
    }
  },
}));
