import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { useTripStore } from './trip.store';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

interface SocketStore {
  socket: Socket | null;
  connect: (accessToken: string) => void;
  disconnect: () => void;
  subscribeToTrip: (tripId: string) => void;
}

export const useSocketStore = create<SocketStore>((set, get) => ({
  socket: null,

  connect: (accessToken) => {
    const existing = get().socket;
    if (existing?.connected) return;
    if (existing) {
      // Dead or mid-handshake socket — tear it down fully so its built-in
      // auto-reconnect can't resurrect it as a phantom duplicate.
      existing.removeAllListeners();
      existing.disconnect();
    }

    const socket = io(API_URL, {
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    // Rooms do not survive socket.io reconnection — rejoin the active trip's
    // room on every (re)connect so live tracking survives dropped sockets.
    socket.on('connect', () => {
      const trip = useTripStore.getState().activeTrip;
      if (trip?.id) socket.emit('subscribe:trip', { tripId: trip.id });
    });

    socket.on('driver:assigned', (data: {
      driverId: string;
      driverName: string;
      driverBadge?: string;
      vehicleMake?: string;
      vehicleModel?: string;
      vehicleColor?: string;
      licensePlate?: string;
      driverPhotoUrl?: string;
      estimatedArrival?: string;
    }) => {
      const current = useTripStore.getState().activeTrip;
      if (!current) return;
      useTripStore.getState().setActiveTrip({
        ...current,
        driverId: data.driverId,
        driverName: data.driverName,
        driverBadge: data.driverBadge,
        vehicleMake: data.vehicleMake,
        vehicleModel: data.vehicleModel,
        vehicleColor: data.vehicleColor,
        licensePlate: data.licensePlate,
        driverPhotoUrl: data.driverPhotoUrl,
        estimatedArrival: data.estimatedArrival,
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

    socket.on('trip:accepted', () => {
      useTripStore.getState().updateTripStatus('accepted');
    });

    socket.on('trip:completed', (data?: { finalFare?: number }) => {
      useTripStore.getState().updateTripStatus('completed', data?.finalFare);
    });

    socket.on('trip:cancelled', () => {
      useTripStore.getState().updateTripStatus('cancelled');
    });

    // Standard-ride redispatch: server re-broadcast the request to drivers
    socket.on('trip:searchingUpdate', (data: { tripId: string; attempt: number }) => {
      const current = useTripStore.getState().activeTrip;
      if (!current || current.id !== data.tripId) return;
      useTripStore.getState().setActiveTrip({ ...current, searchingAttempt: data.attempt });
    });

    // Standard-ride timeout: no driver accepted after all re-broadcasts
    socket.on('trip:noDrivers', (data: { tripId: string }) => {
      const current = useTripStore.getState().activeTrip;
      if (!current || current.id !== data.tripId) return;
      useTripStore.getState().setActiveTrip({ ...current, status: 'no_drivers' });
    });

    socket.on('bid:countered', (data: {
      bidId: string;
      tripId: string;
      counterAmount: number;
      driverId: string;
      expiresAt: string;
    }) => {
      const trip = useTripStore.getState().activeTrip;
      if (!trip) return;
      useTripStore.getState().setPendingCounter({
        bidId: data.bidId,
        counterAmount: data.counterAmount,
        riderOffer: trip.finalFare ?? 0,
        aiFare: trip.aiFare,
        expiresAt: data.expiresAt,
        driverId: data.driverId,
      });
    });

    socket.on('bid:counterExpired', () => {
      useTripStore.getState().clearPendingCounter();
      useTripStore.getState().updateTripStatus('cancelled');
    });

    set({ socket });
  },

  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null });
  },

  subscribeToTrip: (tripId) => {
    // No connected-guard: socket.io buffers emits made before the handshake
    // completes, and a guard here silently drops the room join at cold start.
    get().socket?.emit('subscribe:trip', { tripId });
  },
}));
