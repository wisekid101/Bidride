import { api } from './client';

export interface PlaceSuggestion {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlaceCoordinates {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export interface ResolvedAddress {
  placeId: string;
  formattedAddress: string;
  lat: number;
  lng: number;
}

export const geocodingApi = {
  autocomplete: (query: string, sessionToken?: string): Promise<PlaceSuggestion[]> => {
    const params = new URLSearchParams({ query });
    if (sessionToken) params.append('sessionToken', sessionToken);
    return api.get<PlaceSuggestion[]>(`/geocode/autocomplete?${params}`);
  },

  getPlaceCoordinates: (placeId: string): Promise<PlaceCoordinates> =>
    api.get<PlaceCoordinates>(`/geocode/place/${encodeURIComponent(placeId)}`),

  reverseGeocode: (lat: number, lng: number): Promise<{ formattedAddress: string }> =>
    api.get<{ formattedAddress: string }>(`/geocode/reverse?lat=${lat}&lng=${lng}`),
};
