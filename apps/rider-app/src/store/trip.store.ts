import { create } from 'zustand';

export type TripStatus =
  | 'idle'
  | 'requesting'
  | 'searching'
  | 'accepted'
  | 'driver_en_route'
  | 'driver_arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_drivers';

interface DriverLocation {
  lat: number;
  lng: number;
  heading?: number;
}

interface ActiveTrip {
  id: string;
  status: TripStatus;
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  aiFare: number;
  finalFare?: number;
  driverId?: string;
  driverName?: string | null;
  driverBadge?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  licensePlate?: string;
  estimatedArrival?: string;
  driverPhotoUrl?: string;
  driverLocation?: DriverLocation | null;
  // Incremented on each server re-broadcast while searching
  searchingAttempt?: number;
}

export interface PendingCounter {
  bidId: string;
  counterAmount: number;
  riderOffer: number;
  aiFare: number;
  expiresAt: string;
  driverId?: string;
}

interface TripStore {
  activeTrip: ActiveTrip | null;
  setActiveTrip: (trip: ActiveTrip | null) => void;
  updateTripStatus: (status: TripStatus, finalFare?: number) => void;
  updateDriverLocation: (location: DriverLocation) => void;
  completedTrip: ActiveTrip | null;
  clearCompletedTrip: () => void;
  pendingCounter: PendingCounter | null;
  setPendingCounter: (counter: PendingCounter) => void;
  clearPendingCounter: () => void;
}

export const useTripStore = create<TripStore>((set, get) => ({
  activeTrip: null,
  completedTrip: null,
  pendingCounter: null,

  setActiveTrip: (trip) => set({ activeTrip: trip }),

  updateTripStatus: (status, finalFare) => {
    const trip = get().activeTrip;
    if (!trip) return;

    if (status === 'completed' || status === 'cancelled') {
      set({
        completedTrip: {
          ...trip,
          status,
          ...(finalFare !== undefined ? { finalFare } : {}),
        },
        activeTrip: null,
        pendingCounter: null,
      });
    } else {
      set({ activeTrip: { ...trip, status } });
    }
  },

  updateDriverLocation: (location) => {
    const trip = get().activeTrip;
    if (!trip) return;
    set({ activeTrip: { ...trip, driverLocation: location } });
  },

  clearCompletedTrip: () => set({ completedTrip: null }),

  setPendingCounter: (counter) => set({ pendingCounter: counter }),
  clearPendingCounter: () => set({ pendingCounter: null }),
}));
