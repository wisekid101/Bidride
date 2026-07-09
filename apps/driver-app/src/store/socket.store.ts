import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

export interface IncomingBid {
  bidId: string;
  tripId: string;
  pickupAddress: string;
  dropoffAddress: string;
  bidAmount: number;
  standardFare: number;
  bidFloor: number;
  distanceMiles: number;
  durationMin: number;
  isAirportTrip: boolean;
  riderBadge: 'Verified' | 'Trusted' | 'Business' | 'VIP';
}

export interface IncomingRequest {
  tripId: string;
  pickupAddress: string;
  dropoffAddress: string;
  aiFare: number;
  distanceMiles: number;
  durationMin: number;
  isAirportTrip: boolean;
  riderBadge: 'Verified' | 'Trusted' | 'Business' | 'VIP';
}

interface CounterResult {
  bidId: string;
  tripId: string;
  finalFare: number;
  accepted: boolean;
}

interface DriverSocketStore {
  socket: Socket | null;
  incomingBid: IncomingBid | null;
  incomingRequest: IncomingRequest | null;
  counterResult: CounterResult | null;
  // Trip the rider cancelled post-accept — active trip screens watch this
  // and route the driver back Home.
  cancelledTripId: string | null;
  connect: (accessToken: string) => void;
  disconnect: () => void;
  clearIncomingBid: () => void;
  clearIncomingRequest: () => void;
  clearCounterResult: () => void;
  clearCancelledTrip: () => void;
  emitLocation: (lat: number, lng: number, heading?: number, tripId?: string) => void;
}

export const useDriverSocketStore = create<DriverSocketStore>((set, get) => ({
  socket: null,
  incomingBid: null,
  incomingRequest: null,
  counterResult: null,
  cancelledTripId: null,

  connect: (accessToken) => {
    const existing = get().socket;
    if (existing?.connected) return;
    if (existing) {
      // Dead or mid-handshake socket — tear it down fully so its built-in
      // auto-reconnect can't resurrect it as a phantom duplicate.
      existing.removeAllListeners();
      existing.disconnect();
    }

    const socket = io(WS_URL, {
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socket.on('bid:incoming', (data: IncomingBid) => {
      // Only store one bid at a time — first bid wins until cleared
      if (!get().incomingBid) {
        set({ incomingBid: data });
      }
    });

    socket.on('request:incoming', (data: IncomingRequest) => {
      set({ incomingRequest: data });
    });

    socket.on('bid:counterAccepted', (data: { bidId: string; tripId: string; finalFare: number }) => {
      set({ counterResult: { ...data, accepted: true }, incomingBid: null });
    });

    socket.on('bid:counterDeclined', (data: { bidId: string; tripId: string }) => {
      set({ counterResult: { bidId: data.bidId, tripId: data.tripId, finalFare: 0, accepted: false }, incomingBid: null });
    });

    socket.on('bid:counterExpired', (data: { bidId: string; tripId: string }) => {
      set({ counterResult: { bidId: data.bidId, tripId: data.tripId, finalFare: 0, accepted: false }, incomingBid: null });
    });

    socket.on('trip:cancelled', (data?: { tripId?: string }) => {
      set({
        incomingBid: null,
        incomingRequest: null,
        counterResult: null,
        ...(data?.tripId ? { cancelledTripId: data.tripId } : {}),
      });
    });

    // Keep the socket reference on transient disconnects: emitLocation already
    // guards on socket.connected, socket.io retries in the background, and the
    // AppState foreground handler reconnects through connect(). Nulling here
    // would orphan an instance that still auto-reconnects.

    set({ socket });
  },

  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null, incomingBid: null, incomingRequest: null, counterResult: null, cancelledTripId: null });
  },

  clearIncomingBid: () => set({ incomingBid: null }),
  clearIncomingRequest: () => set({ incomingRequest: null }),
  clearCounterResult: () => set({ counterResult: null }),
  clearCancelledTrip: () => set({ cancelledTripId: null }),

  emitLocation: (lat, lng, heading, tripId) => {
    const { socket } = get();
    if (!socket?.connected) return;
    socket.emit('driver:location', { lat, lng, heading, tripId });
  },
}));
