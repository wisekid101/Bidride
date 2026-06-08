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
  | 'cancelled';

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
  driverLocation?: DriverLocation | null;
}

interface TripStore {
  activeTrip: ActiveTrip | null;
  setActiveTrip: (trip: ActiveTrip | null) => void;
  updateTripStatus: (status: TripStatus) => void;
  updateDriverLocation: (location: DriverLocation) => void;
  completedTrip: ActiveTrip | null;
  clearCompletedTrip: () => void;
}

export const useTripStore = create<TripStore>((set, get) => ({
  activeTrip: null,
  completedTrip: null,

  setActiveTrip: (trip) => set({ activeTrip: trip }),

  updateTripStatus: (status) => {
    const trip = get().activeTrip;
    if (!trip) return;

    if (status === 'completed' || status === 'cancelled') {
      set({ completedTrip: { ...trip, status }, activeTrip: null });
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
}));
