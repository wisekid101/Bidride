import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ResolvedAddress } from '../api/geocoding';

const MAX_RECENT = 5;

export interface SavedAddress extends ResolvedAddress {
  label: string;
}

interface AddressStore {
  recentAddresses: ResolvedAddress[];
  homeAddress: SavedAddress | null;
  workAddress: SavedAddress | null;
  addRecent: (address: ResolvedAddress) => void;
  clearRecent: () => void;
  setHome: (address: ResolvedAddress) => void;
  setWork: (address: ResolvedAddress) => void;
  clearHome: () => void;
  clearWork: () => void;
}

export const useAddressStore = create<AddressStore>()(
  persist(
    (set, get) => ({
      recentAddresses: [],
      homeAddress: null,
      workAddress: null,

      addRecent: (address) => {
        const deduped = get().recentAddresses.filter(
          (a) =>
            a.placeId !== address.placeId ||
            a.formattedAddress !== address.formattedAddress,
        );
        set({ recentAddresses: [address, ...deduped].slice(0, MAX_RECENT) });
      },

      clearRecent: () => set({ recentAddresses: [] }),

      setHome: (address) =>
        set({ homeAddress: { ...address, label: 'Home' } }),

      setWork: (address) =>
        set({ workAddress: { ...address, label: 'Work' } }),

      clearHome: () => set({ homeAddress: null }),
      clearWork: () => set({ workAddress: null }),
    }),
    {
      name: 'bidride:addresses',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
