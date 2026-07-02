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

interface CounterResult {
  bidId: string;
  tripId: string;
  finalFare: number;
  accepted: boolean;
}

interface DriverSocketStore {
  socket: Socket | null;
  incomingBid: IncomingBid | null;
  counterResult: CounterResult | null;
  connect: (accessToken: string) => void;
  disconnect: () => void;
  clearIncomingBid: () => void;
  clearCounterResult: () => void;
  emitLocation: (lat: number, lng: number, heading?: number, tripId?: string) => void;
}

export const useDriverSocketStore = create<DriverSocketStore>((set, get) => ({
  socket: null,
  incomingBid: null,
  counterResult: null,

  connect: (accessToken) => {
    const existing = get().socket;
    if (existing?.connected) return;

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

    socket.on('bid:counterAccepted', (data: { bidId: string; tripId: string; finalFare: number }) => {
      set({ counterResult: { ...data, accepted: true }, incomingBid: null });
    });

    socket.on('bid:counterDeclined', (data: { bidId: string; tripId: string }) => {
      set({ counterResult: { bidId: data.bidId, tripId: data.tripId, finalFare: 0, accepted: false }, incomingBid: null });
    });

    socket.on('bid:counterExpired', (data: { bidId: string; tripId: string }) => {
      set({ counterResult: { bidId: data.bidId, tripId: data.tripId, finalFare: 0, accepted: false }, incomingBid: null });
    });

    socket.on('trip:cancelled', () => {
      set({ incomingBid: null, counterResult: null });
    });

    socket.on('disconnect', () => {
      set({ socket: null });
    });

    set({ socket });
  },

  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null, incomingBid: null, counterResult: null });
  },

  clearIncomingBid: () => set({ incomingBid: null }),
  clearCounterResult: () => set({ counterResult: null }),

  emitLocation: (lat, lng, heading, tripId) => {
    const { socket } = get();
    if (!socket?.connected) return;
    socket.emit('driver:location', { lat, lng, heading, tripId });
  },
}));
