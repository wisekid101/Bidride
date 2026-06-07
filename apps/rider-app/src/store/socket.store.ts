import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { useTripStore } from './trip.store';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

interface SocketStore {
  socket: Socket | null;
  connect: (accessToken: string) => void;
  disconnect: () => void;
}

export const useSocketStore = create<SocketStore>((set, get) => ({
  socket: null,

  connect: (accessToken) => {
    const existing = get().socket;
    if (existing?.connected) return;

    const socket = io(API_URL, {
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on('driver:assigned', (data: { driverId: string; driverName: string; vehicleInfo: string; eta: string }) => {
      useTripStore.getState().setActiveTrip({
        ...useTripStore.getState().activeTrip!,
        driverName: data.driverName,
        status: 'accepted',
      });
    });

    socket.on('driver:location', (data: { lat: number; lng: number; heading?: number }) => {
      useTripStore.getState().updateDriverLocation(data);
    });

    socket.on('driver:arrived', () => {
      useTripStore.getState().updateTripStatus('driver_arrived');
    });

    socket.on('trip:started', () => {
      useTripStore.getState().updateTripStatus('in_progress');
    });

    socket.on('trip:completed', () => {
      useTripStore.getState().updateTripStatus('completed');
    });

    socket.on('trip:cancelled', () => {
      useTripStore.getState().updateTripStatus('cancelled');
    });

    set({ socket });
  },

  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null });
  },
}));
