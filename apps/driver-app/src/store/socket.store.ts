import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

// Heartbeat cadence while Online. The server's LOCATION_TTL_SECONDS must stay
// greater than 2× this value or parked drivers fall out of offer matching
// between beats (server default 180s / client default 60s).
// Malformed env must fall back, never yield NaN (setInterval(fn, NaN)
// coerces to ~0ms — a heartbeat flood).
const HEARTBEAT_SECONDS = (() => {
  const parsed = Number(process.env.EXPO_PUBLIC_LOCATION_HEARTBEAT_SECONDS ?? 60);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
})();

// Wire shape of the 'driver:location' event. lat/lng/heading/ts/source are
// live today. speed / available / rideEligibility / vehicleClass are PREPARED
// for future AI dispatch: the gateway stores whatever arrives (write-only) and
// nothing consumes them yet — do not build logic on them without approval.
export interface DriverLocationPayload {
  lat: number;
  lng: number;
  heading?: number;
  tripId?: string;
  ts: number;
  source: 'gps' | 'heartbeat';
  speed?: number | null;
  available?: boolean;
  rideEligibility?: string[];
  vehicleClass?: string;
}

interface LastFix {
  lat: number;
  lng: number;
  heading?: number;
  ts: number;
}

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
  // Last GPS fix emitted — the heartbeat re-sends this so a parked driver
  // stays visible to offer matching without any additional GPS polling.
  lastFix: LastFix | null;
  connect: (accessToken: string) => void;
  disconnect: () => void;
  clearIncomingBid: () => void;
  clearIncomingRequest: () => void;
  clearCounterResult: () => void;
  clearCancelledTrip: () => void;
  emitLocation: (lat: number, lng: number, heading?: number, tripId?: string) => void;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
}

// Module-level so hot reloads / repeated startHeartbeat calls can't stack
// intervals. Only one heartbeat may exist per JS runtime.
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export const useDriverSocketStore = create<DriverSocketStore>((set, get) => ({
  socket: null,
  incomingBid: null,
  incomingRequest: null,
  counterResult: null,
  cancelledTripId: null,
  lastFix: null,

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

    // After any (re)connect, push the cached fix immediately if a heartbeat
    // is active — the Redis location key was deleted on disconnect, and a
    // parked driver would otherwise stay invisible until the next interval.
    socket.on('connect', () => {
      if (heartbeatTimer) {
        get().stopHeartbeat();
        get().startHeartbeat();
      }
    });

    // Keep the socket reference on transient disconnects: emitLocation already
    // guards on socket.connected, socket.io retries in the background, and the
    // AppState foreground handler reconnects through connect(). Nulling here
    // would orphan an instance that still auto-reconnects.

    set({ socket });
  },

  disconnect: () => {
    get().stopHeartbeat();
    get().socket?.disconnect();
    set({ socket: null, incomingBid: null, incomingRequest: null, counterResult: null, cancelledTripId: null, lastFix: null });
  },

  clearIncomingBid: () => set({ incomingBid: null }),
  clearIncomingRequest: () => set({ incomingRequest: null }),
  clearCounterResult: () => set({ counterResult: null }),
  clearCancelledTrip: () => set({ cancelledTripId: null }),

  emitLocation: (lat, lng, heading, tripId) => {
    // Cache the fix even while offline/disconnected — the heartbeat re-sends
    // it once the socket is back.
    set({ lastFix: { lat, lng, heading, ts: Date.now() } });
    const { socket } = get();
    if (!socket?.connected) return;
    const payload: DriverLocationPayload = {
      lat, lng, heading, tripId,
      ts: Date.now(),
      source: 'gps',
    };
    socket.emit('driver:location', payload);
  },

  startHeartbeat: () => {
    get().stopHeartbeat();

    const beat = () => {
      const { socket, lastFix } = get();
      // Cached coordinates only — NEVER query GPS from here (battery rule).
      if (!socket?.connected || !lastFix) return;
      const payload: DriverLocationPayload = {
        lat: lastFix.lat,
        lng: lastFix.lng,
        heading: lastFix.heading,
        ts: Date.now(),
        source: 'heartbeat',
        // Prepared for future AI dispatch — stored by the gateway, consumed
        // by nothing yet. speed is unknown for a cached fix; a heartbeat only
        // fires while the driver is Online, so available is always true.
        speed: null,
        available: true,
      };
      socket.emit('driver:location', payload);
    };

    beat(); // immediate — covers the reconnect gap before the first interval
    heartbeatTimer = setInterval(beat, HEARTBEAT_SECONDS * 1000);
  },

  stopHeartbeat: () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  },
}));
