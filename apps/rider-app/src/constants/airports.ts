export interface AirportTerminal {
  id: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
}

export const EWR_TERMINALS: AirportTerminal[] = [
  {
    id: 'EWR-A',
    name: 'Terminal A',
    description: 'Delta · American · Other carriers',
    lat: 40.6897,
    lng: -74.1756,
  },
  {
    id: 'EWR-B',
    name: 'Terminal B',
    description: 'United · International arrivals',
    lat: 40.6913,
    lng: -74.1746,
  },
  {
    id: 'EWR-C',
    name: 'Terminal C',
    description: 'United Express · Regional jets',
    lat: 40.6929,
    lng: -74.1764,
  },
];

const EWR_ADDRESS_PATTERNS = [
  /newark liberty international/i,
  /\bewr\b/i,
  /newark airport/i,
  /newark int['']?l/i,
];

export function detectEwrAddress(address: string): boolean {
  return EWR_ADDRESS_PATTERNS.some((p) => p.test(address));
}

// EWR geofence — the canonical airport-trip signal for fare quoting.
// 1930m ≈ 1.2mi: terminals ≤0.26mi and the cell lot 0.74mi inside; Port
// Newark Marine Terminal 1.59mi and "Terminal Ave" Elizabeth 2.19mi outside.
// MUST stay in lockstep with trip-service trips.service.ts
// (EWR_CENTER / AIRPORT_RADIUS_METERS) or quoted fares diverge from charges.
export const EWR_CENTER = { lat: 40.6895, lng: -74.1745 };
// Malformed env must fall back, never yield NaN (which would silently
// disable the geofence and quote EWR trips without the airport premium).
export const EWR_RADIUS_METERS = (() => {
  const parsed = Number(process.env.EXPO_PUBLIC_AIRPORT_RADIUS_METERS ?? 1930);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1930;
})();

export function isNearEwr(lat: number, lng: number): boolean {
  const R = 6371000;
  const dLat = ((lat - EWR_CENTER.lat) * Math.PI) / 180;
  const dLng = ((lng - EWR_CENTER.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((EWR_CENTER.lat * Math.PI) / 180) *
      Math.cos((lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= EWR_RADIUS_METERS;
}
